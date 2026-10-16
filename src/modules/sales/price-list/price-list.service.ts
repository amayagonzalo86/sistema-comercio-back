import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { RequestAuditContext } from '../../../common/http/request-context';
import { ProductBranchEntity } from '../../inventory/product/entities/product-branch.entity';
import { ProductEntity } from '../../inventory/product/entities/product.entity';
import { CreatePriceListDto, ProductPriceOverrideDto, UpdatePriceListDto } from './dto/price-list.dto';
import { PriceListEntity, PriceListPaymentCondition } from './entities/price-list.entity';
import { ProductPriceListEntity } from './entities/product-price-list.entity';
import { applyPriceList, resolvePriceList } from './pricing';

export interface PriceListView {
  id: string;
  name: string;
  description: string | null;
  percentage: string;
  paymentCondition: PriceListPaymentCondition;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Productos con porcentaje propio dentro de la lista. */
  overridesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalculatedPriceResponse {
  productId: string;
  branchId: string;
  priceListId: string;
  basePrice: string;
  appliedPercentage: string;
  finalPrice: string;
  isCustomOverride: boolean;
}

/**
 * Listas de precios de la empresa. Reglas:
 * - Siempre hay como mucho una lista principal (se usa cuando la venta no indica otra).
 * - No se puede eliminar ni desactivar la principal: primero se elige otra.
 * - Eliminar es una baja lógica: las ventas conservan el nombre y el porcentaje con que se cobraron.
 */
@Injectable()
export class PriceListService {
  constructor(private readonly dataSource: DataSource) {}

  async list(tenantId: string, includeInactive: boolean): Promise<PriceListView[]> {
    const lists = await this.dataSource.getRepository(PriceListEntity).find({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return this.views(tenantId, lists);
  }

  async findOne(tenantId: string, id: string): Promise<PriceListView & { productOverrides: Array<{ productId: string; appliedPercentage: string }> }> {
    const list = await this.requireList(this.dataSource.manager, tenantId, id);
    const [view] = await this.views(tenantId, [list]);
    const overrides = await this.dataSource.getRepository(ProductPriceListEntity).find({
      where: { tenantId, priceListId: id },
      select: { productId: true, appliedPercentage: true },
    });
    return { ...view, productOverrides: overrides.map((item) => ({ productId: item.productId, appliedPercentage: Number(item.appliedPercentage).toFixed(2) })) };
  }

  async create(tenantId: string, actorUserId: string, dto: CreatePriceListDto, context: RequestAuditContext): Promise<PriceListView> {
    const saved = await this.dataSource.transaction(async (manager) => {
      await this.assertUniqueName(manager, tenantId, dto.name);
      if (dto.productOverrides?.length) await this.assertProducts(manager, tenantId, dto.productOverrides);
      const existing = await manager.count(PriceListEntity, { where: { tenantId } });
      // La primera lista de la empresa es la principal.
      const isDefault = dto.isDefault === true || existing === 0;
      if (isDefault && dto.isActive === false) throw new BadRequestException('La lista principal tiene que estar activa.');
      if (isDefault) await manager.update(PriceListEntity, { tenantId, isDefault: true }, { isDefault: false });
      const list = await manager.save(
        PriceListEntity,
        manager.create(PriceListEntity, {
          tenantId,
          name: dto.name,
          description: dto.description || null,
          percentage: dto.percentage.toFixed(2),
          paymentCondition: dto.paymentCondition ?? PriceListPaymentCondition.ANY,
          isDefault,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? (existing + 1) * 10,
        }),
      );
      if (dto.productOverrides?.length) await this.replaceOverrides(manager, tenantId, list.id, dto.productOverrides);
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'PRICE_LIST_CREATED',
        aggregateType: 'PRICE_LIST',
        aggregateId: list.id,
        metadata: { name: list.name, percentage: list.percentage, paymentCondition: list.paymentCondition, isDefault: list.isDefault },
        context,
      });
      return list;
    });
    const [view] = await this.views(tenantId, [saved]);
    return view;
  }

  async update(tenantId: string, actorUserId: string, id: string, dto: UpdatePriceListDto, context: RequestAuditContext): Promise<PriceListView> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const list = await this.requireList(manager, tenantId, id, true);
      const before = { name: list.name, percentage: list.percentage, paymentCondition: list.paymentCondition, isDefault: list.isDefault, isActive: list.isActive };
      if (dto.name !== undefined && dto.name.toLowerCase() !== list.name.toLowerCase()) await this.assertUniqueName(manager, tenantId, dto.name, id);
      if (dto.isDefault === false && list.isDefault) {
        throw new BadRequestException('Para quitarle la marca de principal, elegí otra lista como principal.');
      }
      const willBeDefault = dto.isDefault === true || list.isDefault;
      if (dto.isActive === false && willBeDefault) throw new BadRequestException('La lista principal no se puede desactivar: elegí otra como principal.');
      if (dto.isDefault === true && !list.isDefault) {
        await manager.update(PriceListEntity, { tenantId, isDefault: true }, { isDefault: false });
      }
      if (dto.productOverrides) {
        await this.assertProducts(manager, tenantId, dto.productOverrides);
        await this.replaceOverrides(manager, tenantId, id, dto.productOverrides);
      }
      Object.assign(list, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.percentage !== undefined ? { percentage: dto.percentage.toFixed(2) } : {}),
        ...(dto.paymentCondition !== undefined ? { paymentCondition: dto.paymentCondition } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        isDefault: willBeDefault,
      });
      const updated = await manager.save(PriceListEntity, list);
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'PRICE_LIST_UPDATED',
        aggregateType: 'PRICE_LIST',
        aggregateId: id,
        metadata: {
          before,
          after: { name: updated.name, percentage: updated.percentage, paymentCondition: updated.paymentCondition, isDefault: updated.isDefault, isActive: updated.isActive },
          overridesReplaced: dto.productOverrides ? dto.productOverrides.length : null,
        },
        context,
      });
      return updated;
    });
    const [view] = await this.views(tenantId, [saved]);
    return view;
  }

  /** Baja lógica: la lista deja de ofrecerse; las ventas ya hechas conservan su nombre y porcentaje. */
  async remove(tenantId: string, actorUserId: string, id: string, context: RequestAuditContext): Promise<{ message: string }> {
    return this.dataSource.transaction(async (manager) => {
      const list = await this.requireList(manager, tenantId, id, true);
      if (list.isDefault) throw new BadRequestException('No se puede eliminar la lista principal: primero elegí otra como principal.');
      await manager.softDelete(PriceListEntity, { id, tenantId });
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'PRICE_LIST_DELETED',
        aggregateType: 'PRICE_LIST',
        aggregateId: id,
        metadata: { name: list.name, percentage: list.percentage },
        context,
      });
      return { message: `Lista «${list.name}» eliminada.` };
    });
  }

  /** Precio de un producto en una sucursal con la lista aplicada (incluye el porcentaje propio del producto). */
  async getCalculatedProductPrice(tenantId: string, productId: string, branchId: string, priceListId: string): Promise<CalculatedPriceResponse> {
    const list = await resolvePriceList(this.dataSource.manager, tenantId, priceListId);
    if (!list) throw new NotFoundException('La lista de precios no existe o está desactivada.');
    const productBranch = await this.dataSource.getRepository(ProductBranchEntity).findOne({ where: { productId, branchId, tenantId } });
    if (!productBranch) throw new NotFoundException('El producto no está habilitado en esa sucursal.');
    const baseCents = BigInt(Math.round(Number(productBranch.sellingPrice ?? 0) * 100));
    const finalCents = applyPriceList(baseCents, list, productId);
    const override = list.overrides.get(productId);
    return {
      productId,
      branchId,
      priceListId,
      basePrice: (Number(baseCents) / 100).toFixed(2),
      appliedPercentage: (Number(override ?? list.percentageBasisPoints) / 100).toFixed(2),
      finalPrice: (Number(finalCents) / 100).toFixed(2),
      isCustomOverride: override !== undefined,
    };
  }

  private async views(tenantId: string, lists: PriceListEntity[]): Promise<PriceListView[]> {
    if (lists.length === 0) return [];
    const counts = (await this.dataSource
      .getRepository(ProductPriceListEntity)
      .createQueryBuilder('o')
      .select('o.priceListId', 'priceListId')
      .addSelect('COUNT(*)', 'total')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.priceListId IN (:...ids)', { ids: lists.map((list) => list.id) })
      .groupBy('o.priceListId')
      .getRawMany()) as Array<{ priceListId: string; total: string }>;
    const byList = new Map(counts.map((row) => [row.priceListId, Number(row.total)]));
    return lists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description ?? null,
      percentage: Number(list.percentage).toFixed(2),
      paymentCondition: list.paymentCondition,
      isDefault: list.isDefault,
      isActive: list.isActive,
      sortOrder: list.sortOrder,
      overridesCount: byList.get(list.id) ?? 0,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    }));
  }

  private async requireList(manager: EntityManager, tenantId: string, id: string, lock = false): Promise<PriceListEntity> {
    const list = lock
      ? await manager.createQueryBuilder(PriceListEntity, 'l').setLock('pessimistic_write').where('l.id = :id AND l.tenantId = :tenantId', { id, tenantId }).getOne()
      : await manager.findOne(PriceListEntity, { where: { id, tenantId } });
    if (!list) throw new NotFoundException('La lista de precios no existe.');
    return list;
  }

  private async assertUniqueName(manager: EntityManager, tenantId: string, name: string, exceptId?: string): Promise<void> {
    const clash = await manager.findOne(PriceListEntity, {
      where: { tenantId, name, deletedAt: IsNull(), ...(exceptId ? { id: Not(exceptId) } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`Ya existe una lista llamada «${name}».`);
  }

  private async assertProducts(manager: EntityManager, tenantId: string, overrides: ProductPriceOverrideDto[]): Promise<void> {
    const ids = [...new Set(overrides.map((item) => item.productId))];
    if (ids.length !== overrides.length) throw new BadRequestException('Cada producto puede aparecer una sola vez en la lista.');
    if (ids.length === 0) return;
    const found = await manager.find(ProductEntity, { where: { id: In(ids), tenantId }, select: { id: true } });
    if (found.length !== ids.length) throw new BadRequestException('Algún producto no existe en esta empresa.');
  }

  private async replaceOverrides(manager: EntityManager, tenantId: string, priceListId: string, overrides: ProductPriceOverrideDto[]): Promise<void> {
    await manager.delete(ProductPriceListEntity, { tenantId, priceListId });
    if (overrides.length === 0) return;
    await manager.save(
      ProductPriceListEntity,
      overrides.map((item) => manager.create(ProductPriceListEntity, { tenantId, priceListId, productId: item.productId, appliedPercentage: item.appliedPercentage })),
    );
  }
}
