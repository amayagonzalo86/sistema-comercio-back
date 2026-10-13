import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { Paginated, paginated } from '../../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../../common/http/request-context';
import { hasAnyTenantRole } from '../../../common/security/tenant-roles';
import { nextSequence } from '../../../common/sequences/sequences';
import { TenantEntity } from '../../platform/entities/tenant.entity';
import { SalesService } from '../sales.service';
import { CancelSalesOrderDto, CreateSalesOrderDto, SalesOrderQueryDto } from './dto/sales-order.dto';
import { SalesOrderItemEntity } from './entities/sales-order-item.entity';
import { SalesOrderEntity, SalesOrderStatus } from './entities/sales-order.entity';
import { lockSalesOrder } from './sales-order-lock';

/** Roles de la empresa que pueden anular cualquier pedido de su alcance. El vendedor solo anula los propios. */
const CANCEL_ANY_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']);

export interface SalesOrderActor {
  id: string;
  branchId: string | null;
  tenantRole?: string;
  tenantRoles?: string[];
}

export interface SalesOrderView extends Omit<SalesOrderEntity, 'items' | 'tenant' | 'branch'> {
  branchName: string | null;
  sellerName: string | null;
  customerName: string | null;
  items?: SalesOrderItemEntity[];
}

type NameRow = { id: string; name: string | null };

/**
 * Preventa: el vendedor arma el pedido, el cliente lo paga en caja con el número y el cajero lo cobra
 * (POST /sales con salesOrderId). El pedido no reserva stock: la disponibilidad se valida al cobrar.
 */
@Injectable()
export class SalesOrdersService {
  private readonly logger = new Logger(SalesOrdersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly salesService: SalesService,
  ) {}

  async create(
    tenantId: string,
    actor: SalesOrderActor,
    idempotencyKey: string,
    dto: CreateSalesOrderDto,
    context: RequestAuditContext,
  ): Promise<SalesOrderView> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 100) {
      throw new BadRequestException('Idempotency-Key es obligatorio y debe tener hasta 100 caracteres.');
    }
    if (actor.branchId && actor.branchId !== dto.branchId) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
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

    const prior = await this.findByKey(tenantId, key);
    if (prior) return this.replay(tenantId, prior, fingerprint, actor.branchId);

    // Mismas reglas que la venta: precio de la sucursal, promociones, IVA y clase de comprobante.
    const quote = await this.salesService.quote(
      tenantId,
      { branchId: dto.branchId, customerPersonId: dto.customerPersonId, lines: dto.lines },
      actor.branchId,
    );

    try {
      const orderId = await this.dataSource.transaction(async (manager) => {
        const tenant = await manager.findOne(TenantEntity, { where: { id: tenantId }, select: { id: true, currencyCode: true } });
        if (!tenant) throw new NotFoundException('La empresa no existe.');
        const number = await nextSequence(manager, tenantId, 'SALES_ORDER');
        const order = await manager.save(
          SalesOrderEntity,
          manager.create(SalesOrderEntity, {
            tenantId,
            branchId: dto.branchId,
            number,
            customerPersonId: dto.customerPersonId ?? null,
            sellerUserId: actor.id,
            status: SalesOrderStatus.PENDING,
            notes,
            currency: tenant.currencyCode,
            voucherClass: quote.voucherClass,
            estimatedTotal: quote.total,
            itemsCount: quote.lines.length,
            idempotencyKey: key,
            requestFingerprint: fingerprint,
          }),
        );
        await manager.save(
          SalesOrderItemEntity,
          quote.lines.map((line) =>
            manager.create(SalesOrderItemEntity, {
              tenantId,
              salesOrderId: order.id,
              productId: line.productId,
              skuSnapshot: line.sku.slice(0, 50),
              nameSnapshot: line.name.slice(0, 150),
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discount,
              total: line.total,
            }),
          ),
        );
        await recordAudit(manager, {
          tenantId,
          actorUserId: actor.id,
          eventType: 'SALES_ORDER_CREATED',
          aggregateType: 'SALES_ORDER',
          aggregateId: order.id,
          metadata: {
            number,
            branchId: dto.branchId,
            customerPersonId: dto.customerPersonId ?? null,
            lines: quote.lines.length,
            estimatedTotal: quote.total,
          },
          context,
        });
        return order.id;
      });
      return this.findOne(tenantId, orderId, actor.branchId);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        const concurrent = await this.findByKey(tenantId, key);
        if (concurrent) return this.replay(tenantId, concurrent, fingerprint, actor.branchId);
      }
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error('Error al registrar el pedido de venta', error);
      throw new InternalServerErrorException('No se pudo registrar el pedido.');
    }
  }

  async list(tenantId: string, query: SalesOrderQueryDto, branchScope: string | null): Promise<Paginated<SalesOrderView>> {
    if (branchScope && query.branchId && query.branchId !== branchScope) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const branchId = branchScope ?? query.branchId;
    const pendingQueue = query.status === SalesOrderStatus.PENDING;
    const [orders, total] = await this.dataSource.getRepository(SalesOrderEntity).findAndCount({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.sellerUserId ? { sellerUserId: query.sellerUserId } : {}),
        ...(query.number ? { number: query.number } : {}),
      },
      // La cola de caja se atiende por orden de llegada; el historial, del más nuevo al más viejo.
      order: pendingQueue ? { createdAt: 'ASC', id: 'ASC' } : { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginated(await this.decorate(orders), total, query.page, query.limit);
  }

  async findOne(tenantId: string, orderId: string, branchScope: string | null): Promise<SalesOrderView> {
    const order = await this.dataSource.getRepository(SalesOrderEntity).findOne({
      where: { id: orderId, tenantId, ...(branchScope ? { branchId: branchScope } : {}) },
    });
    if (!order) throw new NotFoundException('Pedido de venta no encontrado.');
    return this.withItems(tenantId, order);
  }

  /** Búsqueda del cajero por el número que trae el cliente. */
  async findByNumber(tenantId: string, number: number, branchScope: string | null): Promise<SalesOrderView> {
    const order = await this.dataSource.getRepository(SalesOrderEntity).findOne({
      where: { number, tenantId, ...(branchScope ? { branchId: branchScope } : {}) },
    });
    if (!order) throw new NotFoundException(`No existe el pedido N° ${number}${branchScope ? ' en su sucursal' : ''}.`);
    return this.withItems(tenantId, order);
  }

  async cancel(
    tenantId: string,
    actor: SalesOrderActor,
    orderId: string,
    dto: CancelSalesOrderDto,
    context: RequestAuditContext,
  ): Promise<SalesOrderView> {
    await this.dataSource.transaction(async (manager) => {
      const order = await lockSalesOrder(manager, tenantId, orderId);
      if (actor.branchId && actor.branchId !== order.branchId) {
        throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
      }
      if (!hasAnyTenantRole(actor, CANCEL_ANY_ROLES) && order.sellerUserId !== actor.id) {
        throw new ForbiddenException('Solo podés anular tus propios pedidos.');
      }
      if (order.status !== SalesOrderStatus.PENDING) {
        throw new ConflictException(
          order.status === SalesOrderStatus.CHARGED
            ? 'El pedido ya fue cobrado: para revertirlo registrá una devolución de la venta.'
            : 'El pedido ya está anulado.',
        );
      }
      order.status = SalesOrderStatus.CANCELLED;
      order.cancelReason = dto.reason.trim();
      order.cancelledAt = new Date();
      order.cancelledByUserId = actor.id;
      await manager.save(SalesOrderEntity, order);
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: 'SALES_ORDER_CANCELLED',
        aggregateType: 'SALES_ORDER',
        aggregateId: order.id,
        metadata: { number: order.number, reason: order.cancelReason, sellerUserId: order.sellerUserId },
        context,
      });
    });
    return this.findOne(tenantId, orderId, actor.branchId);
  }

  private async findByKey(tenantId: string, key: string): Promise<SalesOrderEntity | null> {
    return this.dataSource.getRepository(SalesOrderEntity).findOne({ where: { tenantId, idempotencyKey: key } });
  }

  private async replay(
    tenantId: string,
    order: SalesOrderEntity,
    fingerprint: string,
    branchScope: string | null,
  ): Promise<SalesOrderView> {
    if (order.requestFingerprint !== fingerprint) {
      throw new ConflictException('Idempotency-Key ya fue utilizado para otro pedido.');
    }
    return this.findOne(tenantId, order.id, branchScope);
  }

  private async withItems(tenantId: string, order: SalesOrderEntity): Promise<SalesOrderView> {
    const items = await this.dataSource.getRepository(SalesOrderItemEntity).find({
      where: { tenantId, salesOrderId: order.id },
      order: { nameSnapshot: 'ASC', id: 'ASC' },
    });
    const [view] = await this.decorate([order]);
    return { ...view, items };
  }

  /** Agrega nombres legibles (sucursal, vendedor, cliente) con tres consultas por página, sin N+1. */
  private async decorate(orders: SalesOrderEntity[]): Promise<SalesOrderView[]> {
    if (orders.length === 0) return [];
    const branchIds = [...new Set(orders.map((order) => order.branchId))];
    const sellerIds = [...new Set(orders.map((order) => order.sellerUserId))];
    const customerIds = [...new Set(orders.map((order) => order.customerPersonId).filter((id): id is string => Boolean(id)))];
    const placeholders = (values: string[]) => values.map(() => '?').join(', ');

    const [branches, sellers, customers] = await Promise.all([
      this.dataSource.query(
        `SELECT id, name FROM branches WHERE id IN (${placeholders(branchIds)})`,
        branchIds,
      ) as Promise<NameRow[]>,
      this.dataSource.query(
        `SELECT u.id AS id,
                COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), u.username) AS name
           FROM users u LEFT JOIN persons p ON p.id = u.person_id
          WHERE u.id IN (${placeholders(sellerIds)})`,
        sellerIds,
      ) as Promise<NameRow[]>,
      customerIds.length
        ? (this.dataSource.query(
            `SELECT id, NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '') AS name
               FROM persons WHERE id IN (${placeholders(customerIds)})`,
            customerIds,
          ) as Promise<NameRow[]>)
        : Promise.resolve([] as NameRow[]),
    ]);
    const toMap = (rows: NameRow[]) => new Map(rows.map((row) => [String(row.id), row.name ? String(row.name) : null]));
    const branchNames = toMap(branches);
    const sellerNames = toMap(sellers);
    const customerNames = toMap(customers);

    return orders.map(({ items: _items, tenant: _tenant, branch: _branch, ...order }) => ({
      ...order,
      branchName: branchNames.get(order.branchId) ?? null,
      sellerName: sellerNames.get(order.sellerUserId) ?? null,
      customerName: order.customerPersonId ? customerNames.get(order.customerPersonId) ?? null : null,
    }));
  }
}
