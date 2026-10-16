import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { Paginated, paginated } from '../../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../../common/http/request-context';
import { userDisplayNames } from '../../../common/security/platform-operators';
import { hasAnyTenantRole } from '../../../common/security/tenant-roles';
import { nextSequence } from '../../../common/sequences/sequences';
import { loadPrintCustomer, PrintCustomer } from '../../fiscal/printable';
import { TenantEntity } from '../../platform/entities/tenant.entity';
import { SalesOrdersService, SalesOrderView } from '../orders/sales-orders.service';
import { SalesService } from '../sales.service';
import { CreateSalesQuoteDto, SalesQuoteQueryDto } from './dto/sales-quote.dto';
import { SalesQuoteEntity, SalesQuoteStatus } from './entities/sales-quote.entity';

/** Vigencia real de un presupuesto X en el sistema: pasado este plazo se borra de la base. */
export const QUOTE_VALIDITY_MS = 24 * 60 * 60 * 1000;
/** Validez que se informa al cliente en el presupuesto impreso (decisión comercial de la empresa). */
export const QUOTE_PRINTED_VALIDITY_HOURS = 72;
const EXPIRE_EVERY_MS = 60 * 60 * 1000;
/** Ven y descartan presupuestos de cualquier vendedor de su alcance (no los convierten: eso es solo de quien lo emitió). */
const SUPERVISOR_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER']);

export interface QuoteActor {
  id: string;
  branchId: string | null;
  tenantRole?: string;
  tenantRoles?: string[];
}

export interface SalesQuoteView extends Omit<SalesQuoteEntity, 'tenant' | 'branch'> {
  sellerName: string | null;
  customerName: string | null;
  branchName: string | null;
  /** Milisegundos hasta el vencimiento (para la cuenta regresiva). */
  remainingMs: number;
  /** Horas de validez que se imprimen en el presupuesto. */
  printedValidityHours: number;
}

export interface SalesQuoteDetailView extends SalesQuoteView {
  /** Datos completos del cliente para el bloque "Señor / Dirección / IVA / DNI". */
  customer: PrintCustomer | null;
}

/**
 * Presupuestos "X" (no válidos como factura). Reglas:
 * - Valen 24 horas desde su emisión; después quedan VENCIDOS (no se borran: forman el historial).
 * - Solo quien lo emitió puede pasarlo a pedido de venta, y solo mientras está vigente.
 *   Al pasarlo a pedido queda CONVERTIDO con el pedido asociado; el pedido lo cobra la caja con los precios del momento.
 * - Un vendedor ve solo sus presupuestos; encargado/administración ven los de su alcance.
 */
@Injectable()
export class SalesQuotesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SalesQuotesService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly salesService: SalesService,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.expireDue().catch((error: unknown) => this.logger.warn(`No se pudieron marcar presupuestos vencidos: ${String(error)}`));
    }, EXPIRE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Marca como vencidos los presupuestos vigentes que pasaron las 24 h (de todas las empresas). No borra nada. */
  async expireDue(manager: EntityManager = this.dataSource.manager): Promise<number> {
    const now = new Date();
    const result = await manager
      .createQueryBuilder()
      .update(SalesQuoteEntity)
      .set({ status: SalesQuoteStatus.EXPIRED, closedAt: now })
      .where('status = :active', { active: SalesQuoteStatus.ACTIVE })
      .andWhere('expires_at <= :now', { now })
      .execute();
    return result.affected ?? 0;
  }

  async create(tenantId: string, actor: QuoteActor, idempotencyKey: string, dto: CreateSalesQuoteDto, context: RequestAuditContext): Promise<SalesQuoteView> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    if (actor.branchId && actor.branchId !== dto.branchId) throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    const notes = dto.notes ? dto.notes.trim() || null : null;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({
        branchId: dto.branchId,
        customerPersonId: dto.customerPersonId ?? null,
        lines: [...dto.lines]
          .map((line) => ({ productId: line.productId, quantity: Number(line.quantity).toFixed(3) }))
          .sort((a, b) => a.productId.localeCompare(b.productId)),
        notes,
        priceListId: dto.priceListId ?? null,
      }))
      .digest('hex');

    await this.expireDue();
    const prior = await this.dataSource.getRepository(SalesQuoteEntity).findOne({ where: { tenantId, idempotencyKey: key } });
    if (prior) {
      if (prior.requestFingerprint !== fingerprint) throw new ConflictException('Idempotency-Key ya fue utilizado para otro presupuesto.');
      return this.view(prior);
    }

    // Mismas reglas de precio, promociones e IVA que la venta.
    const quote = await this.salesService.quote(
      tenantId,
      { branchId: dto.branchId, customerPersonId: dto.customerPersonId, lines: dto.lines, priceListId: dto.priceListId },
      actor.branchId,
    );
    const saved = await this.dataSource.transaction(async (manager) => {
      const tenant = await manager.findOne(TenantEntity, { where: { id: tenantId }, select: { id: true, currencyCode: true } });
      if (!tenant) throw new NotFoundException('La empresa no existe.');
      const number = await nextSequence(manager, tenantId, 'SALES_QUOTE');
      const entity = await manager.save(
        SalesQuoteEntity,
        manager.create(SalesQuoteEntity, {
          tenantId,
          branchId: dto.branchId,
          number,
          sellerUserId: actor.id,
          customerPersonId: dto.customerPersonId ?? null,
          notes,
          currency: tenant.currencyCode,
          voucherClass: quote.voucherClass,
          vatRegime: quote.vatRegime,
          priceListId: quote.priceList?.id ?? null,
          subtotal: quote.subtotal,
          taxTotal: quote.taxTotal,
          discountTotal: quote.discountTotal,
          total: quote.total,
          lines: quote.lines.map((line) => ({
            productId: line.productId,
            sku: line.sku,
            name: line.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            total: line.total,
          })),
          expiresAt: new Date(Date.now() + QUOTE_VALIDITY_MS),
          idempotencyKey: key,
          requestFingerprint: fingerprint,
        }),
      );
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: 'SALES_QUOTE_CREATED',
        aggregateType: 'SALES_QUOTE',
        aggregateId: entity.id,
        metadata: { number, branchId: dto.branchId, total: quote.total, lines: quote.lines.length, expiresAt: entity.expiresAt.toISOString() },
        context,
      });
      return entity;
    });
    return this.view(saved);
  }

  async list(tenantId: string, actor: QuoteActor, query: SalesQuoteQueryDto): Promise<Paginated<SalesQuoteView>> {
    await this.expireDue();
    if (actor.branchId && query.branchId && query.branchId !== actor.branchId) throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    const branchId = actor.branchId ?? query.branchId;
    const supervisor = hasAnyTenantRole(actor, SUPERVISOR_ROLES);
    const [items, total] = await this.dataSource.getRepository(SalesQuoteEntity).findAndCount({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
        // Un vendedor (o cajero) ve solo los presupuestos que emitió.
        ...(supervisor ? {} : { sellerUserId: actor.id }),
        ...(query.status === 'ALL' ? {} : { status: query.status as SalesQuoteStatus }),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginated(await this.views(items), total, query.page, query.limit);
  }

  async findOne(tenantId: string, actor: QuoteActor, quoteId: string): Promise<SalesQuoteDetailView> {
    const quote = await this.visibleQuote(tenantId, actor, { id: quoteId });
    const [view, customer] = await Promise.all([this.view(quote), loadPrintCustomer(this.dataSource.manager, tenantId, quote.customerPersonId)]);
    return { ...view, customer };
  }

  async findByNumber(tenantId: string, actor: QuoteActor, number: number): Promise<SalesQuoteView> {
    return this.view(await this.visibleQuote(tenantId, actor, { number }));
  }

  /**
   * Pasa el presupuesto a pedido de venta. Solo quien lo emitió y solo si está vigente.
   * El pedido se crea con una clave idempotente derivada del presupuesto: un doble clic no crea dos pedidos.
   */
  async convert(tenantId: string, actor: QuoteActor, quoteId: string, context: RequestAuditContext): Promise<SalesOrderView> {
    await this.expireDue();
    const quote = await this.dataSource.getRepository(SalesQuoteEntity).findOne({ where: { id: quoteId, tenantId } });
    if (!quote) {
      throw new NotFoundException('El presupuesto no existe.');
    }
    if (quote.sellerUserId !== actor.id) {
      throw new ForbiddenException('Solo quien emitió el presupuesto puede pasarlo a pedido.');
    }
    assertActive(quote);
    if (actor.branchId && actor.branchId !== quote.branchId) throw new ForbiddenException('No tiene acceso a la sucursal del presupuesto.');

    const order = await this.salesOrders.create(
      tenantId,
      { id: actor.id, branchId: actor.branchId, tenantRole: actor.tenantRole, tenantRoles: actor.tenantRoles },
      `quote:${quote.id}`,
      {
        branchId: quote.branchId,
        customerPersonId: quote.customerPersonId ?? undefined,
        lines: quote.lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
        notes: [`Presupuesto X N.º ${quote.number}`, quote.notes].filter(Boolean).join(' · ').slice(0, 300),
        priceListId: quote.priceListId ?? undefined,
      },
      context,
    );

    await this.dataSource.transaction(async (manager) => {
      const converted = await manager.update(
        SalesQuoteEntity,
        { id: quote.id, tenantId, status: SalesQuoteStatus.ACTIVE },
        { status: SalesQuoteStatus.CONVERTED, convertedOrderId: order.id, closedAt: new Date(), closedByUserId: actor.id },
      );
      if (converted.affected) {
        await recordAudit(manager, {
          tenantId,
          actorUserId: actor.id,
          eventType: 'SALES_QUOTE_CONVERTED',
          aggregateType: 'SALES_QUOTE',
          aggregateId: quote.id,
          metadata: { number: quote.number, salesOrderId: order.id, salesOrderNumber: order.number, quotedTotal: quote.total, orderTotal: order.estimatedTotal },
          context,
        });
      }
    });
    return order;
  }

  /** Descarta un presupuesto vigente (queda en el historial como DESCARTADO): quien lo emitió o un supervisor. */
  async remove(tenantId: string, actor: QuoteActor, quoteId: string, context: RequestAuditContext): Promise<{ message: string }> {
    const quote = await this.visibleQuote(tenantId, actor, { id: quoteId });
    assertActive(quote);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        SalesQuoteEntity,
        { id: quote.id, tenantId, status: SalesQuoteStatus.ACTIVE },
        { status: SalesQuoteStatus.DISCARDED, closedAt: new Date(), closedByUserId: actor.id },
      );
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: 'SALES_QUOTE_DISCARDED',
        aggregateType: 'SALES_QUOTE',
        aggregateId: quote.id,
        metadata: { number: quote.number },
        context,
      });
    });
    return { message: `Presupuesto N.º ${quote.number} descartado.` };
  }

  private async visibleQuote(tenantId: string, actor: QuoteActor, where: { id: string } | { number: number }): Promise<SalesQuoteEntity> {
    await this.expireDue();
    const quote = await this.dataSource.getRepository(SalesQuoteEntity).findOne({ where: { ...where, tenantId } });
    const visible =
      quote &&
      (!actor.branchId || actor.branchId === quote.branchId) &&
      (quote.sellerUserId === actor.id || hasAnyTenantRole(actor, SUPERVISOR_ROLES));
    if (!quote || !visible) {
      throw new NotFoundException('El presupuesto no existe.');
    }
    return quote;
  }

  private async view(quote: SalesQuoteEntity): Promise<SalesQuoteView> {
    const [view] = await this.views([quote]);
    return view;
  }

  private async views(quotes: SalesQuoteEntity[]): Promise<SalesQuoteView[]> {
    if (quotes.length === 0) return [];
    const branchIds = [...new Set(quotes.map((quote) => quote.branchId))];
    const customerIds = [...new Set(quotes.map((quote) => quote.customerPersonId).filter((id): id is string => Boolean(id)))];
    const placeholders = (values: string[]) => values.map(() => '?').join(', ');
    const [sellers, branches, customers] = await Promise.all([
      userDisplayNames(this.dataSource.manager, quotes.map((quote) => quote.sellerUserId)),
      this.dataSource.query(`SELECT id, name FROM branches WHERE id IN (${placeholders(branchIds)})`, branchIds) as Promise<Array<{ id: string; name: string }>>,
      customerIds.length
        ? (this.dataSource.query(
            `SELECT id, TRIM(CONCAT_WS(' ', first_name, NULLIF(last_name, '-'))) AS name FROM persons WHERE id IN (${placeholders(customerIds)})`,
            customerIds,
          ) as Promise<Array<{ id: string; name: string }>>)
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);
    const branchName = new Map(branches.map((row) => [String(row.id), String(row.name)]));
    const customerName = new Map(customers.map((row) => [String(row.id), String(row.name)]));
    const now = Date.now();
    return quotes.map(({ tenant: _tenant, branch: _branch, ...quote }) => ({
      ...quote,
      sellerName: sellers.get(quote.sellerUserId) ?? null,
      customerName: quote.customerPersonId ? customerName.get(quote.customerPersonId) ?? null : null,
      branchName: branchName.get(quote.branchId) ?? null,
      remainingMs: quote.status === SalesQuoteStatus.ACTIVE ? Math.max(0, new Date(quote.expiresAt).getTime() - now) : 0,
      printedValidityHours: QUOTE_PRINTED_VALIDITY_HOURS,
    }));
  }
}

/** Solo un presupuesto vigente se puede pasar a pedido o descartar. */
function assertActive(quote: SalesQuoteEntity): void {
  if (quote.status === SalesQuoteStatus.EXPIRED) {
    throw new ConflictException(`El presupuesto N.º ${quote.number} venció (vale 24 horas). Armá uno nuevo.`);
  }
  if (quote.status === SalesQuoteStatus.CONVERTED) {
    throw new ConflictException(`El presupuesto N.º ${quote.number} ya se pasó a pedido.`);
  }
  if (quote.status === SalesQuoteStatus.DISCARDED) {
    throw new ConflictException(`El presupuesto N.º ${quote.number} fue descartado.`);
  }
}
