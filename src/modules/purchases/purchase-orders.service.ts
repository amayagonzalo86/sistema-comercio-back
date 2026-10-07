import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { Paginated, paginated } from '../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../common/http/request-context';
import { nextSequence } from '../../common/sequences/sequences';
import { cents, formatMoney, formatQuantity, lineAmount, milli, roundDivide } from '../../common/utils/money';
import { BranchEntity } from '../branches/entities/branch.entity';
import { planReplenishment } from '../inventory/ops/domain/replenishment';
import { ProductBranchEntity } from '../inventory/product/entities/product-branch.entity';
import { PersonEntity, PersonType } from '../persons/entities/person.entity';
import { TenantEntity } from '../platform/entities/tenant.entity';
import {
  CancelPurchaseOrderDto,
  CreatePurchaseOrderDto,
  PurchaseOrderFromReplenishmentDto,
  PurchaseOrderLineDto,
  PurchaseOrderQueryDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import { PurchaseOrderItemEntity } from './entities/purchase-order-item.entity';
import { PurchaseOrderEntity, PurchaseOrderStatus } from './entities/purchase-order.entity';

export interface ReceivedLine {
  productId: string;
  quantityMilli: bigint;
}

/**
 * Imputa una recepción de mercadería a su pedido de compra (misma transacción que la recepción).
 * Actualiza cantidades recibidas y pasa el pedido a PARCIAL o RECIBIDO.
 */
export async function applyReceiptToOrder(
  manager: EntityManager,
  tenantId: string,
  orderId: string,
  supplierPersonId: string,
  branchId: string,
  lines: ReceivedLine[],
): Promise<PurchaseOrderEntity> {
  const order = await manager
    .createQueryBuilder(PurchaseOrderEntity, 'o')
    .setLock('pessimistic_write')
    .where('o.id = :orderId', { orderId })
    .andWhere('o.tenantId = :tenantId', { tenantId })
    .getOne();
  if (!order) throw new NotFoundException('El pedido de compra no existe.');
  if (order.supplierPersonId !== supplierPersonId || order.branchId !== branchId) {
    throw new BadRequestException('La recepción no coincide con el proveedor o la sucursal del pedido.');
  }
  if (![PurchaseOrderStatus.SENT, PurchaseOrderStatus.PARTIALLY_RECEIVED].includes(order.status)) {
    throw new ConflictException('Solo se reciben pedidos enviados y pendientes.');
  }
  const items = await manager.find(PurchaseOrderItemEntity, { where: { tenantId, purchaseOrderId: orderId } });
  const byProduct = new Map(items.map((item) => [item.productId, item]));
  for (const line of lines) {
    const item = byProduct.get(line.productId);
    if (!item) {
      throw new BadRequestException(`El producto ${line.productId} no forma parte del pedido de compra.`);
    }
    item.quantityReceived = formatQuantity(milli(item.quantityReceived) + line.quantityMilli);
  }
  await manager.save(PurchaseOrderItemEntity, items);
  const complete = items.every((item) => milli(item.quantityReceived) >= milli(item.quantityOrdered));
  order.status = complete ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED;
  if (complete) order.closedAt = new Date();
  return manager.save(PurchaseOrderEntity, order);
}

interface OrderActor {
  id: string;
  branchId: string | null;
}

/** Pedidos de compra a proveedores: borrador, envío, recepción (vía recepciones) y cancelación. */
@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly dataSource: DataSource) {}

  async create(tenantId: string, actor: OrderActor, dto: CreatePurchaseOrderDto, context: RequestAuditContext): Promise<PurchaseOrderEntity> {
    this.assertBranch(actor, dto.branchId);
    const orderId = await this.dataSource.transaction(async (manager) => {
      const [tenant] = await Promise.all([
        manager.findOne(TenantEntity, { where: { id: tenantId }, select: { id: true, currencyCode: true } }),
        this.assertSupplierAndBranch(manager, tenantId, dto.supplierPersonId, dto.branchId),
      ]);
      const number = await nextSequence(manager, tenantId, 'PURCHASE_ORDER');
      const order = await manager.save(
        PurchaseOrderEntity,
        manager.create(PurchaseOrderEntity, {
          tenantId,
          number,
          supplierPersonId: dto.supplierPersonId,
          branchId: dto.branchId,
          status: PurchaseOrderStatus.DRAFT,
          expectedDate: dto.expectedDate ?? null,
          notes: dto.notes || null,
          currency: tenant?.currencyCode ?? 'ARS',
          createdByUserId: actor.id,
        }),
      );
      await this.replaceLines(manager, tenantId, order, dto.lines);
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: 'PURCHASE_ORDER_CREATED',
        aggregateType: 'PURCHASE_ORDER',
        aggregateId: order.id,
        metadata: { number, supplierPersonId: dto.supplierPersonId, branchId: dto.branchId, lines: dto.lines.length },
        context,
      });
      return order.id;
    });
    return this.findOne(tenantId, orderId, actor.branchId);
  }

  async update(tenantId: string, actor: OrderActor, orderId: string, dto: UpdatePurchaseOrderDto, context: RequestAuditContext): Promise<PurchaseOrderEntity> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, tenantId, orderId);
      this.assertBranch(actor, order.branchId);
      if (order.status !== PurchaseOrderStatus.DRAFT) {
        throw new ConflictException('Solo se pueden editar pedidos en borrador.');
      }
      if (dto.expectedDate !== undefined) order.expectedDate = dto.expectedDate || null;
      if (dto.notes !== undefined) order.notes = dto.notes || null;
      await manager.save(PurchaseOrderEntity, order);
      if (dto.lines) await this.replaceLines(manager, tenantId, order, dto.lines);
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: 'PURCHASE_ORDER_UPDATED',
        aggregateType: 'PURCHASE_ORDER',
        aggregateId: order.id,
        metadata: { number: order.number, linesReplaced: Boolean(dto.lines) },
        context,
      });
    });
    return this.findOne(tenantId, orderId, actor.branchId);
  }

  async send(tenantId: string, actor: OrderActor, orderId: string, context: RequestAuditContext): Promise<PurchaseOrderEntity> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, tenantId, orderId);
      this.assertBranch(actor, order.branchId);
      if (order.status !== PurchaseOrderStatus.DRAFT) {
        throw new ConflictException('El pedido ya fue enviado o cerrado.');
      }
      order.status = PurchaseOrderStatus.SENT;
      order.sentAt = new Date();
      await manager.save(PurchaseOrderEntity, order);
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: 'PURCHASE_ORDER_SENT',
        aggregateType: 'PURCHASE_ORDER',
        aggregateId: order.id,
        metadata: { number: order.number, estimatedTotal: order.estimatedTotal },
        context,
      });
    });
    return this.findOne(tenantId, orderId, actor.branchId);
  }

  /** Cancela un pedido; si estaba parcialmente recibido, cierra el saldo pendiente. */
  async cancel(tenantId: string, actor: OrderActor, orderId: string, dto: CancelPurchaseOrderDto, context: RequestAuditContext): Promise<PurchaseOrderEntity> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, tenantId, orderId);
      this.assertBranch(actor, order.branchId);
      if ([PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CANCELLED].includes(order.status)) {
        throw new ConflictException('El pedido ya está cerrado.');
      }
      order.status = PurchaseOrderStatus.CANCELLED;
      order.cancelReason = dto.reason.trim();
      order.closedAt = new Date();
      await manager.save(PurchaseOrderEntity, order);
      await recordAudit(manager, {
        tenantId,
        actorUserId: actor.id,
        eventType: 'PURCHASE_ORDER_CANCELLED',
        aggregateType: 'PURCHASE_ORDER',
        aggregateId: order.id,
        metadata: { number: order.number, reason: order.cancelReason },
        context,
      });
    });
    return this.findOne(tenantId, orderId, actor.branchId);
  }

  /** Genera un borrador con lo que falta comprar en una sucursal (descontando lo que pueden enviar otras). */
  async fromReplenishment(
    tenantId: string,
    actor: OrderActor,
    dto: PurchaseOrderFromReplenishmentDto,
    context: RequestAuditContext,
  ): Promise<PurchaseOrderEntity> {
    this.assertBranch(actor, dto.branchId);
    const qb = this.dataSource
      .getRepository(ProductBranchEntity)
      .createQueryBuilder('pb')
      .innerJoin('pb.product', 'p')
      .where('pb.tenantId = :tenantId', { tenantId })
      .andWhere('pb.isActive = true')
      .andWhere('p.status = true')
      .andWhere(
        'pb.productId IN (SELECT low.product_id FROM product_branches low WHERE low.tenant_id = :tenantId AND low.branch_id = :branchId AND low.is_active = 1 AND low.min_stock > 0 AND low.stock <= low.min_stock)',
        { branchId: dto.branchId },
      );
    if (dto.productIds?.length) qb.andWhere('pb.productId IN (:...productIds)', { productIds: dto.productIds });
    if (dto.category) qb.andWhere('p.category = :category', { category: dto.category });
    if (dto.brand) qb.andWhere('p.brand = :brand', { brand: dto.brand });
    const rows = await qb.limit(20000).getMany();

    const plan = planReplenishment(
      rows.map((row) => ({ productId: row.productId, branchId: row.branchId, stockMilli: milli(row.stock, true), minMilli: milli(row.minStock) })),
      dto.targetPercent,
    );
    const lines: PurchaseOrderLineDto[] = plan.purchases
      .filter((item) => item.branchId === dto.branchId)
      .slice(0, 300)
      .map((item) => ({ productId: item.productId, quantity: Number(formatQuantity(item.quantityMilli)) }));
    if (lines.length === 0) {
      throw new BadRequestException('No hay faltantes para comprar en esa sucursal con el filtro indicado.');
    }
    return this.create(tenantId, actor, { supplierPersonId: dto.supplierPersonId, branchId: dto.branchId, lines, notes: 'Generado desde reposición sugerida' }, context);
  }

  async list(tenantId: string, query: PurchaseOrderQueryDto, branchScope: string | null): Promise<Paginated<PurchaseOrderEntity>> {
    if (branchScope && query.branchId && query.branchId !== branchScope) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    const branchId = branchScope ?? query.branchId;
    const [items, total] = await this.dataSource.getRepository(PurchaseOrderEntity).findAndCount({
      where: {
        tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.supplierPersonId ? { supplierPersonId: query.supplierPersonId } : {}),
        ...(branchId ? { branchId } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return paginated(items, total, query.page, query.limit);
  }

  async findOne(tenantId: string, orderId: string, branchScope: string | null): Promise<PurchaseOrderEntity> {
    const order = await this.dataSource.getRepository(PurchaseOrderEntity).findOne({
      where: { id: orderId, tenantId, ...(branchScope ? { branchId: branchScope } : {}) },
      relations: { items: true },
    });
    if (!order) throw new NotFoundException('Pedido de compra no encontrado.');
    return order;
  }

  private async replaceLines(manager: EntityManager, tenantId: string, order: PurchaseOrderEntity, lines: PurchaseOrderLineDto[]): Promise<void> {
    if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
      throw new BadRequestException('Cada producto debe aparecer una sola vez en el pedido.');
    }
    const rows = await manager.find(ProductBranchEntity, {
      where: { tenantId, branchId: order.branchId, productId: In(lines.map((line) => line.productId)) },
      relations: { product: true },
    });
    const byProduct = new Map(rows.map((row) => [row.productId, row]));
    await manager.delete(PurchaseOrderItemEntity, { tenantId, purchaseOrderId: order.id });

    let totalCents = 0n;
    const items = lines.map((line) => {
      const row = byProduct.get(line.productId);
      if (!row?.product || !row.product.status) {
        throw new NotFoundException(`El producto ${line.productId} no está habilitado en la sucursal del pedido.`);
      }
      const unitCostCents = line.unitCost !== undefined ? cents(line.unitCost) : cents(row.costPrice);
      const taxRateBp = cents(line.taxRate ?? Number(row.product.taxRate));
      const quantityMilli = milli(line.quantity);
      const net = lineAmount(unitCostCents, quantityMilli);
      totalCents += net + roundDivide(net * taxRateBp, 10_000n);
      return manager.create(PurchaseOrderItemEntity, {
        tenantId,
        purchaseOrderId: order.id,
        productId: line.productId,
        skuSnapshot: row.product.sku,
        nameSnapshot: row.product.name,
        quantityOrdered: formatQuantity(quantityMilli),
        quantityReceived: '0.000',
        unitCost: formatMoney(unitCostCents),
        taxRate: formatMoney(taxRateBp),
      });
    });
    await manager.save(PurchaseOrderItemEntity, items);
    order.estimatedTotal = formatMoney(totalCents);
    await manager.save(PurchaseOrderEntity, order);
  }

  private async assertSupplierAndBranch(manager: EntityManager, tenantId: string, supplierId: string, branchId: string): Promise<void> {
    const [supplier, branch] = await Promise.all([
      manager.findOne(PersonEntity, { where: { id: supplierId, tenantId, isActive: true }, select: { id: true, personType: true } }),
      manager.findOne(BranchEntity, { where: { id: branchId, tenantId, status: true }, select: { id: true } }),
    ]);
    if (!supplier || supplier.personType === PersonType.CUSTOMER) {
      throw new NotFoundException('El proveedor no existe o no está habilitado para compras.');
    }
    if (!branch) throw new NotFoundException('La sucursal no existe o no está activa.');
  }

  private assertBranch(actor: OrderActor, branchId: string): void {
    if (actor.branchId && actor.branchId !== branchId) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
  }

  private async lockOrder(manager: EntityManager, tenantId: string, orderId: string): Promise<PurchaseOrderEntity> {
    const order = await manager
      .createQueryBuilder(PurchaseOrderEntity, 'o')
      .setLock('pessimistic_write')
      .where('o.id = :orderId', { orderId })
      .andWhere('o.tenantId = :tenantId', { tenantId })
      .getOne();
    if (!order) throw new NotFoundException('Pedido de compra no encontrado.');
    return order;
  }
}
