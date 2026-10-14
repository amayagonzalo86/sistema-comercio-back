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
import { TenantEntity } from '../../platform/entities/tenant.entity';
import { SalesOrdersService, SalesOrderView } from '../orders/sales-orders.service';
import { SalesService } from '../sales.service';
import { CreateSalesQuoteDto, SalesQuoteQueryDto } from './dto/sales-quote.dto';
import { SalesQuoteEntity } from './entities/sales-quote.entity';

/** Vigencia de un presupuesto X. */
export const QUOTE_VALIDITY_MS = 24 * 60 * 60 * 1000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
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
}

/**
 * Presupuestos "X" (no válidos como factura). Reglas:
 * - Valen 24 horas desde su emisión; vencidos se borran de la base (al consultarlos y cada hora).
 * - Solo quien lo emitió puede pasarlo a pedido de venta, y solo mientras está vigente.
 *   Al pasarlo a pedido se borra: el pedido lo cobra la caja con los precios del momento.
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
      this.purgeExpired().catch((error: unknown) => this.logger.warn(`No se pudieron borrar presupuestos vencidos: ${String(error)}`));
    }, PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Borra los presupuestos vencidos (de todas las empresas). Devuelve cuántos borró. */
  async purgeExpired(manager: EntityManager = this.dataSource.manager): Promise<number> {
    const result = await manager
      .createQueryBuilder()
      .delete()
      .from(SalesQuoteEntity)
      .where('expires_at <= :now', { now: new Date() })
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
      }))
      .digest('hex');

    await this.purgeExpired();
    const prior = await this.dataSource.getRepository(SalesQuoteEntity).findOne({ where: { tenantId, idempotencyKey: key } });
    if (prior) {
      if (prior.requestFingerprint !== fingerprint) throw new ConflictException('Idempotency-Key ya fue utilizado para otro presupuesto.');
      return this.view(prior);
    }

    // Mismas reglas de precio, promociones e IVA que la venta.
    const quote = await this.salesService.quote(tenantId, { branchId: dto.branchId, customerPersonId: dto.customerPersonId, lines: dto.lines }, actor.branchId);
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
    await this.purgeExpired();
    if (actor.branchId && query.branchId && query.branchId !== actor.branchId) throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    const branchId = actor.branchId ?? query.branchId;
    const supervisor = hasAnyTenantRole(actor, SUPERVISOR_ROLES);
    const [items, total] = await this.dataSource.getRepository(SalesQuoteEntity).findAndCount({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
        // Un vendedor (o cajero) ve solo los presupuestos que emitió.
        ...(supervisor ? {} : { sellerUserId: actor.id }),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginated(await this.views(items), total, query.page, query.limit);
  }

  async findOne(tenantId: string, actor: QuoteActor, quoteId: string): Promise<SalesQuoteView> {
    return this.view(await this.visibleQuote(tenantId, actor, { id: quoteId }));
  }

  async findByNumber(tenantId: string, actor: QuoteActor, number: number): Promise<SalesQuoteView> {
    return this.view(await this.visibleQuote(tenantId, actor, { number }));
  }

  /**
   * Pasa el presupuesto a pedido de venta. Solo quien lo emitió y solo si está vigente.
   * El pedido se crea con una clave idempotente derivada del presupuesto: un doble clic no crea dos pedidos.
   */
  async convert(tenantId: string, actor: QuoteActor, quoteId: string, context: RequestAuditContext): Promise<SalesOrderView> {
    await this.purgeExpired();
    const quote = await this.dataSource.getRepository(SalesQuoteEntity).findOne({ where: { id: quoteId, tenantId } });
    if (!quote) {
      throw new NotFoundException('El presupuesto no existe o venció (los presupuestos valen 24 horas). Armá uno nuevo.');
    }
    if (quote.sellerUserId !== actor.id) {
      throw new ForbiddenException('Solo quien emitió el presupuesto puede pasarlo a pedido.');
    }
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
      },
      context,
    );

    await this.dataSource.transaction(async (manager) => {
      const deleted = await manager.delete(SalesQuoteEntity, { id: quote.id, tenantId });
      if (deleted.affected) {
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

  /** Descarta un presupuesto antes de que venza: quien lo emitió o un supervisor. */
  async remove(tenantId: string, actor: QuoteActor, quoteId: string, context: RequestAuditContext): Promise<{ message: string }> {
    const quote = await this.visibleQuote(tenantId, actor, { id: quoteId });
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(SalesQuoteEntity, { id: quote.id, tenantId });
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
    await this.purgeExpired();
    const quote = await this.dataSource.getRepository(SalesQuoteEntity).findOne({ where: { ...where, tenantId } });
    const visible =
      quote &&
      (!actor.branchId || actor.branchId === quote.branchId) &&
      (quote.sellerUserId === actor.id || hasAnyTenantRole(actor, SUPERVISOR_ROLES));
    if (!quote || !visible) {
      throw new NotFoundException('El presupuesto no existe o venció (los presupuestos valen 24 horas).');
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
      remainingMs: Math.max(0, new Date(quote.expiresAt).getTime() - now),
    }));
  }
}
