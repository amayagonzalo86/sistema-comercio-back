import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { cents, formatMoney, roundDivide } from '../../../common/utils/money';
import { IdentificationTypeEnum } from '../../../common/enums/afip.enum';
import { tenantTimeZone } from '../../../common/time/local-day-range';
import { ProductBranchEntity } from '../../inventory/product/entities/product-branch.entity';
import { loadActivePromotions } from '../../marketing/promotion-loader';
import { PromotionType } from '../../marketing/domain/promotions';
import { localToday, localWeekday } from '../../reports/domain/period';
import { PersonEntity, PersonType } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/persons.service';
import { CardPlansService } from '../../sales/card-plans/card-plans.service';
import { SalesOrdersService } from '../../sales/orders/sales-orders.service';
import { SaleQuote, SalesService } from '../../sales/sales.service';
import { AiConversationChannel, AiConversationEntity, AiConversationStatus, AiSalesSettingsEntity } from '../entities/ai-sales.entities';
import { AiToolCall, AiToolDefinition } from '../providers/ai-provider.types';

/** Medios de pago que el vendedor IA puede acordar (se cobran en caja con el número de pedido). */
export const AI_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'QR', 'ACCOUNT'] as const;
export type AiPaymentMethod = (typeof AI_PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<AiPaymentMethod, string> = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia bancaria',
  DEBIT_CARD: 'Tarjeta de débito',
  CREDIT_CARD: 'Tarjeta de crédito',
  QR: 'QR / billetera virtual',
  ACCOUNT: 'Cuenta corriente',
};

export interface ToolContext {
  tenantId: string;
  settings: AiSalesSettingsEntity;
  conversation: AiConversationEntity;
}

export interface ToolOutcome {
  /** Lo que ve el modelo (JSON). */
  result: Record<string, unknown>;
  /** La herramienta cambió el estado de la conversación (pedido confirmado o derivación). */
  conversationChanged?: boolean;
}

const MAX_SEARCH_RESULTS = 8;
const MAX_ORDER_LINES = 30;

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);
const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** $ 12.345,67 (formato argentino, para que el modelo lo repita tal cual). */
export function ars(value: bigint | string): string {
  const amount = typeof value === 'bigint' ? value : cents(value, true);
  const negative = amount < 0n;
  const [whole, fraction] = formatMoney(negative ? -amount : amount).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}$ ${grouped},${fraction}`;
}

export function enabledPaymentMethods(settings: Pick<AiSalesSettingsEntity, 'paymentMethods'>): AiPaymentMethod[] {
  const allowed = new Set<string>(AI_PAYMENT_METHODS);
  return settings.paymentMethods
    .split(',')
    .map((method) => method.trim())
    .filter((method): method is AiPaymentMethod => allowed.has(method));
}

interface OrderItemInput {
  productId: string;
  quantity: number;
}

/** Valida los ítems que manda el modelo (ids existentes de buscar_productos y cantidades positivas). */
export function parseItems(raw: unknown): OrderItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('Indicá al menos un producto con su cantidad.');
  if (raw.length > MAX_ORDER_LINES) throw new BadRequestException(`Hasta ${MAX_ORDER_LINES} productos distintos por pedido.`);
  const merged = new Map<string, number>();
  for (const item of raw) {
    const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const productId = str(record.productoId ?? record.productId, 36);
    const quantity = Number(record.cantidad ?? record.quantity);
    if (!/^[0-9a-f-]{36}$/i.test(productId)) throw new BadRequestException('productoId inválido: usá el id que devolvió buscar_productos.');
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000) throw new BadRequestException('Cantidad inválida.');
    merged.set(productId, Math.round(((merged.get(productId) ?? 0) + quantity) * 1000) / 1000);
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Herramientas del vendedor IA. Todos los precios salen del mismo motor que la caja (lista de precios,
 * promociones vigentes, IVA): el modelo nunca calcula ni inventa precios ni descuentos.
 */
@Injectable()
export class AiSalesToolbox {
  private readonly logger = new Logger(AiSalesToolbox.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly salesService: SalesService,
    private readonly salesOrders: SalesOrdersService,
    private readonly cardPlans: CardPlansService,
    private readonly persons: PersonsService,
  ) {}

  definitions(settings: AiSalesSettingsEntity): AiToolDefinition[] {
    const methods = enabledPaymentMethods(settings);
    return [
      {
        name: 'buscar_productos',
        description:
          'Busca productos del catálogo por nombre, marca, rubro o código. Devuelve el id, el precio vigente (con promociones) y si hay stock. Usala siempre antes de mencionar un precio.',
        parameters: {
          type: 'object',
          properties: { texto: { type: 'string', description: 'Lo que busca el cliente, p. ej. "yerba 1kg" o "taladro bosch".' } },
          required: ['texto'],
        },
      },
      {
        name: 'promociones_vigentes',
        description: 'Lista las promociones activas hoy en la sucursal (descuentos y 2x1/3x2). Son las únicas que se pueden ofrecer.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'cotizar_pedido',
        description:
          'Calcula el total exacto de un pedido con precios y promociones vigentes, el total pagando en efectivo y las cuotas con tarjeta disponibles hoy. Usala antes de decir un total.',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              description: 'Productos del pedido.',
              items: {
                type: 'object',
                properties: {
                  productoId: { type: 'string', description: 'id devuelto por buscar_productos' },
                  cantidad: { type: 'number' },
                },
                required: ['productoId', 'cantidad'],
              },
            },
          },
          required: ['items'],
        },
      },
      {
        name: 'registrar_cliente',
        description:
          'Registra o identifica al cliente con sus datos (obligatorio antes de confirmar el pedido). Si ya existe con ese DNI, lo vincula sin modificarlo.',
        parameters: {
          type: 'object',
          properties: {
            nombre: { type: 'string' },
            apellido: { type: 'string' },
            dni: { type: 'string', description: 'DNI sin puntos (7 u 8 dígitos). Opcional si el cliente no quiere darlo.' },
            direccion: { type: 'string', description: 'Calle y número (para envíos).' },
            localidad: { type: 'string' },
            email: { type: 'string' },
          },
          required: ['nombre', 'apellido'],
        },
      },
      {
        name: 'confirmar_pedido',
        description:
          'Registra el pedido para que el cliente lo pague en caja (o al recibirlo). Solo después de mostrarle el resumen con el total y que el cliente responda que sí.',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: { productoId: { type: 'string' }, cantidad: { type: 'number' } },
                required: ['productoId', 'cantidad'],
              },
            },
            formaPago: { type: 'string', enum: methods, description: 'Medio de pago acordado.' },
            cuotas: { type: 'integer', description: 'Cantidad de cuotas si paga con tarjeta de crédito (1 = un pago).' },
            entrega: { type: 'string', enum: ['RETIRO', 'ENVIO'], description: 'Retira en el local o se envía.' },
            direccionEntrega: { type: 'string', description: 'Dirección completa si es envío.' },
            comentarios: { type: 'string', description: 'Horario, referencias, flete u otras indicaciones para el local.' },
            clienteConfirmo: { type: 'boolean', description: 'true solo si el cliente aceptó explícitamente el resumen.' },
          },
          required: ['items', 'formaPago', 'entrega', 'clienteConfirmo'],
        },
      },
      {
        name: 'derivar_a_humano',
        description:
          'Pasa la conversación a una persona del local: reclamos, pedidos de descuento especial, consultas que no podés resolver o si el cliente pide hablar con alguien.',
        parameters: {
          type: 'object',
          properties: { motivo: { type: 'string' } },
          required: ['motivo'],
        },
      },
    ];
  }

  /** Ejecuta una herramienta; los errores esperables vuelven al modelo como { error } para que se corrija. */
  async execute(context: ToolContext, call: AiToolCall): Promise<ToolOutcome> {
    try {
      switch (call.name) {
        case 'buscar_productos':
          return { result: await this.searchProducts(context, str(call.arguments.texto, 80)) };
        case 'promociones_vigentes':
          return { result: await this.currentPromotions(context) };
        case 'cotizar_pedido':
          return { result: await this.quoteOrder(context, parseItems(call.arguments.items)) };
        case 'registrar_cliente':
          return await this.registerCustomer(context, call.arguments);
        case 'confirmar_pedido':
          return await this.confirmOrder(context, call.arguments);
        case 'derivar_a_humano':
          return await this.handoff(context, str(call.arguments.motivo, 300) || 'El asistente pidió ayuda.');
        default:
          return { result: { error: `La herramienta ${call.name} no existe.` } };
      }
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ConflictException || error instanceof ForbiddenException) {
        return { result: { error: error.message } };
      }
      this.logger.error(`Falló la herramienta ${call.name}`, error);
      return { result: { error: 'No se pudo completar la consulta. Probá de nuevo o derivá a una persona.' } };
    }
  }

  private requireBranch(settings: AiSalesSettingsEntity): string {
    if (!settings.branchId) throw new BadRequestException('El asistente no tiene una sucursal configurada.');
    return settings.branchId;
  }

  private async searchProducts(context: ToolContext, text: string): Promise<Record<string, unknown>> {
    const branchId = this.requireBranch(context.settings);
    const words = text.split(/\s+/).filter((word) => word.length >= 2).slice(0, 5);
    if (words.length === 0) return { error: 'Indicá qué producto busca el cliente.' };
    const query = this.dataSource
      .getRepository(ProductBranchEntity)
      .createQueryBuilder('pb')
      .innerJoinAndSelect('pb.product', 'product')
      .where('pb.tenantId = :tenantId', { tenantId: context.tenantId })
      .andWhere('pb.branchId = :branchId', { branchId })
      .andWhere('pb.isActive = true')
      .andWhere('product.status = true')
      .andWhere('product.deletedAt IS NULL');
    words.forEach((word, index) => {
      query.andWhere(
        `(product.name LIKE :w${index} OR product.brand LIKE :w${index} OR product.category LIKE :w${index} OR product.sku LIKE :w${index} OR product.barcode = :exact${index})`,
        { [`w${index}`]: `%${escapeLike(word)}%`, [`exact${index}`]: word },
      );
    });
    const rows = await query
      .orderBy('CASE WHEN pb.stock > 0 THEN 0 ELSE 1 END', 'ASC')
      .addOrderBy('product.name', 'ASC')
      .limit(MAX_SEARCH_RESULTS)
      .getMany();
    if (rows.length === 0) return { productos: [], nota: 'No hay productos con esa búsqueda. Probá con otras palabras o ofrecé alternativas.' };
    const quote = await this.salesService.quote(
      context.tenantId,
      {
        branchId,
        customerPersonId: context.conversation.customerPersonId ?? undefined,
        lines: rows.map((row) => ({ productId: row.productId, quantity: 1 })),
      },
      null,
    );
    const byProduct = new Map(quote.lines.map((line) => [line.productId, line]));
    return {
      productos: rows.map((row) => {
        const line = byProduct.get(row.productId);
        const stock = Number(row.stock);
        const minStock = Number(row.minStock);
        return {
          productoId: row.productId,
          nombre: row.product.name,
          marca: row.product.brand ?? null,
          rubro: row.product.category ?? null,
          unidad: row.product.unitOfMeasure,
          precio: line ? ars(line.total) : null,
          precioSinPromocion: line?.promotion ? ars(line.unitPrice) : null,
          promocion: line?.promotion?.name ?? null,
          disponibilidad: stock <= 0 ? 'sin stock' : stock <= Math.max(minStock, 3) ? 'pocas unidades' : 'disponible',
        };
      }),
      nota: 'Precio por unidad con IVA. Las promociones por cantidad (2x1, 3x2) se ven al cotizar el pedido.',
    };
  }

  private async currentPromotions(context: ToolContext): Promise<Record<string, unknown>> {
    const branchId = this.requireBranch(context.settings);
    const timeZone = await tenantTimeZone(this.dataSource.manager, context.tenantId);
    const weekday = localWeekday(timeZone);
    const rules = await loadActivePromotions(this.dataSource.manager, context.tenantId, localToday(timeZone));
    const promotions = rules
      .filter((rule) => !rule.branchIds?.length || rule.branchIds.includes(branchId))
      .filter((rule) => !rule.weekdays?.length || rule.weekdays.includes(weekday))
      .slice(0, 20)
      .map((rule) => ({
        nombre: rule.name,
        tipo:
          rule.type === PromotionType.PERCENTAGE
            ? `${(Number(rule.percentBasisPoints ?? 0) / 100).toLocaleString('es-AR')} % de descuento`
            : `Llevá ${rule.buyQuantity ?? '?'}, pagá ${rule.payQuantity ?? '?'}`,
        aplicaA: [
          rule.categories?.length ? `rubros: ${rule.categories.join(', ')}` : null,
          rule.brands?.length ? `marcas: ${rule.brands.join(', ')}` : null,
          rule.productIds?.length ? `${rule.productIds.length} productos seleccionados` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'todos los productos',
        cantidadMinima: rule.minQuantityMilli ? Number(rule.minQuantityMilli) / 1000 : null,
      }));
    return { promociones: promotions, nota: promotions.length ? 'El descuento se aplica solo al cotizar si el producto califica.' : 'Hoy no hay promociones vigentes.' };
  }

  private async quote(context: ToolContext, items: OrderItemInput[]): Promise<SaleQuote> {
    return this.salesService.quote(
      context.tenantId,
      {
        branchId: this.requireBranch(context.settings),
        customerPersonId: context.conversation.customerPersonId ?? undefined,
        lines: items,
      },
      null,
    );
  }

  private async quoteOrder(context: ToolContext, items: OrderItemInput[]): Promise<Record<string, unknown>> {
    const quote = await this.quote(context, items);
    const methods = enabledPaymentMethods(context.settings);
    const totalCents = cents(quote.total);
    const installments = methods.includes('CREDIT_CARD') || methods.includes('DEBIT_CARD')
      ? (await this.cardPlans.available(context.tenantId))
          .filter((plan) => methods.includes(String(plan.paymentMethod) as AiPaymentMethod))
          .slice(0, 12)
          .map((plan) => {
            const surchargeBp = cents(plan.surchargePercentage);
            const planTotal = roundDivide(totalCents * (10_000n + surchargeBp), 10_000n);
            const count = BigInt(Math.max(1, plan.installments));
            return {
              plan: plan.label,
              medio: PAYMENT_LABELS[String(plan.paymentMethod) as AiPaymentMethod] ?? String(plan.paymentMethod),
              cuotas: plan.installments,
              recargo: `${Number(plan.surchargePercentage).toLocaleString('es-AR')} %`,
              total: ars(planTotal),
              valorCuota: ars(roundDivide(planTotal, count)),
            };
          })
      : [];
    const account = quote.customerAccount;
    return {
      items: quote.lines.map((line) => ({
        productoId: line.productId,
        nombre: line.name,
        cantidad: Number(line.quantity),
        precioUnitario: ars(line.unitPrice),
        descuento: cents(line.discount) > 0n ? ars(line.discount) : null,
        promocion: line.promotion?.name ?? null,
        subtotal: ars(line.total),
        hayStock: line.stockSufficient,
      })),
      total: ars(quote.total),
      totalPagandoEnEfectivo: quote.cashDiscount && methods.includes('CASH') && quote.cashDiscount.total !== quote.total ? ars(quote.cashDiscount.total) : null,
      cuotasConTarjeta: installments,
      mediosDePago: methods
        .filter((method) => method !== 'ACCOUNT' || Boolean(account?.creditEnabled))
        .map((method) => PAYMENT_LABELS[method]),
      faltaStock: quote.lines.filter((line) => !line.stockSufficient).map((line) => line.name),
      nota: 'Montos finales con IVA. No ofrezcas otros descuentos.',
    };
  }

  private async registerCustomer(context: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome> {
    const firstName = str(args.nombre, 100);
    const lastName = str(args.apellido, 100);
    if (firstName.length < 2 || lastName.length < 2) return { result: { error: 'Necesito nombre y apellido del cliente.' } };
    const dni = str(args.dni, 20).replace(/\D/g, '');
    if (dni && !/^\d{7,8}$/.test(dni)) return { result: { error: 'El DNI debe tener 7 u 8 dígitos.' } };
    const email = str(args.email, 150);
    const address = str(args.direccion, 200);
    const city = str(args.localidad, 100);
    const phone = context.conversation.contactPhone;

    const repo = this.dataSource.getRepository(PersonEntity);
    let person: PersonEntity | null = null;
    if (dni) {
      person = await repo
        .createQueryBuilder('p')
        .where('p.tenantId = :tenantId', { tenantId: context.tenantId })
        .andWhere("(p.nationalId = :dni OR (CHAR_LENGTH(p.nationalId) = 11 AND SUBSTRING(p.nationalId, 3, 8) = LPAD(:dni, 8, '0')))", { dni })
        .getOne();
    }
    if (!person && !dni && context.conversation.channel === AiConversationChannel.WHATSAPP) {
      person = await repo.findOne({ where: { tenantId: context.tenantId, phone } });
    }
    let existing = Boolean(person);
    if (person && (!person.isActive || person.personType === PersonType.SUPPLIER)) {
      return { result: { error: 'Ese documento no se puede usar para ventas. Derivá a una persona del local.' } };
    }
    if (!person) {
      try {
        person = await this.persons.create(context.tenantId, {
          firstName,
          lastName,
          personType: PersonType.CUSTOMER,
          documentType: dni ? IdentificationTypeEnum.DNI : IdentificationTypeEnum.CONSUMIDOR_FINAL,
          nationalId: dni || null,
          phone,
          email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
          address: address || null,
          city: city || null,
        });
      } catch (error) {
        if (error instanceof ConflictException) {
          existing = true;
          person = dni ? await repo.findOne({ where: { tenantId: context.tenantId, nationalId: dni } }) : null;
          if (!person) throw error;
        } else {
          throw error;
        }
      }
    }
    context.conversation.customerPersonId = person.id;
    context.conversation.contactName = `${lastName}, ${firstName}`.slice(0, 150);
    await this.dataSource.getRepository(AiConversationEntity).update(
      { id: context.conversation.id, tenantId: context.tenantId },
      { customerPersonId: person.id, contactName: context.conversation.contactName },
    );
    // Por privacidad no se devuelven datos de un cliente existente (dirección, deuda…): solo que quedó vinculado.
    return {
      result: {
        ok: true,
        clienteExistente: existing,
        nota: existing
          ? 'Cliente ya registrado: quedó vinculado. Si es envío, confirmá la dirección de entrega con el cliente.'
          : 'Cliente registrado.',
      },
    };
  }

  private async confirmOrder(context: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome> {
    const { settings, conversation, tenantId } = context;
    if (args.clienteConfirmo !== true) {
      return { result: { error: 'Primero mostrale el resumen al cliente y esperá que confirme.' } };
    }
    if (!conversation.customerPersonId) {
      return { result: { error: 'Antes de confirmar registrá al cliente con registrar_cliente (nombre, apellido y DNI).' } };
    }
    if (!settings.orderUserId) throw new BadRequestException('El asistente no tiene un usuario de pedidos configurado.');
    const branchId = this.requireBranch(settings);
    const items = parseItems(args.items);
    const methods = enabledPaymentMethods(settings);
    const method = str(args.formaPago, 20) as AiPaymentMethod;
    if (!methods.includes(method)) return { result: { error: `Medio de pago no habilitado. Opciones: ${methods.map((m) => PAYMENT_LABELS[m]).join(', ')}.` } };
    const delivery = args.entrega === 'ENVIO' ? 'ENVIO' : args.entrega === 'RETIRO' ? 'RETIRO' : null;
    if (!delivery) return { result: { error: 'Indicá si retira en el local (RETIRO) o se envía (ENVIO).' } };
    const address = str(args.direccionEntrega, 250);
    if (delivery === 'ENVIO' && address.length < 5) return { result: { error: 'Para envío necesito la dirección completa.' } };
    const comments = str(args.comentarios, 220);
    const installments = Number.isInteger(args.cuotas) && Number(args.cuotas) > 1 && Number(args.cuotas) <= 48 ? Number(args.cuotas) : null;

    const quote = await this.quote(context, items);
    if (method === 'ACCOUNT' && !quote.customerAccount?.creditEnabled) {
      return { result: { error: 'El cliente no tiene cuenta corriente habilitada. Ofrecé otro medio de pago.' } };
    }
    const missing = quote.lines.filter((line) => !line.stockSufficient).map((line) => line.name);
    if (missing.length > 0) {
      return { result: { error: `No hay stock suficiente de: ${missing.join(', ')}. Ofrecé otra cantidad o una alternativa.` } };
    }

    const paymentPreference = `${PAYMENT_LABELS[method]}${installments ? ` en ${installments} cuotas` : ''}`;
    const deliveryNotes = [delivery === 'ENVIO' ? `ENVÍO a ${address}` : 'RETIRA en el local', comments].filter(Boolean).join(' · ');
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ items: [...items].sort((a, b) => a.productId.localeCompare(b.productId)), method, installments, delivery, address, comments }))
      .digest('hex')
      .slice(0, 40);
    const order = await this.salesOrders.create(
      tenantId,
      { id: settings.orderUserId, branchId: null },
      `wa:${conversation.id}:${fingerprint}`,
      {
        branchId,
        customerPersonId: conversation.customerPersonId,
        lines: items,
        notes: `Pedido por WhatsApp (asistente ${settings.assistantName}). Cliente: ${conversation.contactName ?? conversation.contactPhone}.`.slice(0, 300),
      },
      { requestId: null, ipAddress: null, userAgent: 'vendedor-ia-whatsapp' },
      { source: 'WHATSAPP_AI', deliveryNotes, paymentPreference, contactPhone: conversation.contactPhone },
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        AiConversationEntity,
        { id: conversation.id, tenantId },
        { status: AiConversationStatus.ORDER_PLACED, salesOrderId: order.id },
      );
      await recordAudit(manager, {
        tenantId,
        actorUserId: null,
        eventType: 'AI_ORDER_CREATED',
        aggregateType: 'SALES_ORDER',
        aggregateId: order.id,
        metadata: {
          number: order.number,
          conversationId: conversation.id,
          channel: conversation.channel,
          contactPhone: conversation.contactPhone,
          estimatedTotal: order.estimatedTotal,
          paymentPreference,
          deliveryNotes,
        },
        context: { userAgent: 'vendedor-ia-whatsapp' },
      });
    });
    conversation.status = AiConversationStatus.ORDER_PLACED;
    conversation.salesOrderId = order.id;
    return {
      conversationChanged: true,
      result: {
        ok: true,
        pedidoNumero: order.number,
        total: ars(order.estimatedTotal),
        formaPago: paymentPreference,
        entrega: deliveryNotes,
        nota:
          delivery === 'ENVIO'
            ? 'Decile al cliente el número de pedido; el local coordina el envío y el cobro.'
            : 'Decile al cliente el número de pedido para pagar y retirar en caja.',
      },
    };
  }

  private async handoff(context: ToolContext, reason: string): Promise<ToolOutcome> {
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        AiConversationEntity,
        { id: context.conversation.id, tenantId: context.tenantId },
        { status: AiConversationStatus.HANDOFF, handoffReason: reason },
      );
      await recordAudit(manager, {
        tenantId: context.tenantId,
        actorUserId: null,
        eventType: 'AI_HANDOFF',
        aggregateType: 'AI_CONVERSATION',
        aggregateId: context.conversation.id,
        metadata: { reason, contactPhone: context.conversation.contactPhone, by: 'ASSISTANT' },
        context: { userAgent: 'vendedor-ia-whatsapp' },
      });
    });
    context.conversation.status = AiConversationStatus.HANDOFF;
    context.conversation.handoffReason = reason;
    return { conversationChanged: true, result: { ok: true, nota: 'Avisale al cliente que en breve lo atiende una persona del local.' } };
  }
}
