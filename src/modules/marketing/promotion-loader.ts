import { EntityManager } from 'typeorm';
import { milli } from '../../common/utils/money';
import { PromotionRule } from './domain/promotions';
import { PromotionEntity } from './entities/promotion.entity';

/** Promociones activas y vigentes en la fecha local indicada (el filtro por sucursal/producto lo hace el motor). */
export async function loadActivePromotions(manager: EntityManager, tenantId: string, localDate: string): Promise<PromotionRule[]> {
  const rows = await manager
    .createQueryBuilder(PromotionEntity, 'promo')
    .where('promo.tenantId = :tenantId', { tenantId })
    .andWhere('promo.isActive = true')
    .andWhere('(promo.startsAt IS NULL OR promo.startsAt <= :date)', { date: localDate })
    .andWhere('(promo.endsAt IS NULL OR promo.endsAt >= :date)', { date: localDate })
    .getMany();
  return (rows ?? []).map(toRule);
}

export function toRule(row: PromotionEntity): PromotionRule {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    percentBasisPoints: row.percentBasisPoints ?? null,
    buyQuantity: row.buyQuantity ?? null,
    payQuantity: row.payQuantity ?? null,
    productIds: row.productIds ?? null,
    categories: row.categories ?? null,
    brands: row.brands ?? null,
    branchIds: row.branchIds ?? null,
    weekdays: row.weekdays ?? null,
    minQuantityMilli: row.minQuantity ? milli(row.minQuantity) : null,
  };
}
