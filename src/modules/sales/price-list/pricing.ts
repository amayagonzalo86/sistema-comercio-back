import { BadRequestException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { PriceListEntity, PriceListPaymentCondition } from './entities/price-list.entity';
import { ProductPriceListEntity } from './entities/product-price-list.entity';

/** Lista de precios lista para aplicar (porcentajes en puntos básicos: −500 = −5 %). */
export interface ResolvedPriceList {
  id: string;
  name: string;
  /** Porcentaje como texto decimal ("−5.00"), tal como se guarda en la venta. */
  percentage: string;
  percentageBasisPoints: bigint;
  paymentCondition: PriceListPaymentCondition;
  /** Es la lista principal de la empresa. */
  isDefault: boolean;
  /** Porcentaje propio de algunos productos dentro de esta lista. */
  overrides: Map<string, bigint>;
}

/** Recargo máximo admitido (1000 %) y descuento máximo (99,99 %). */
export const MAX_PRICE_LIST_PERCENTAGE = 1000;
export const MIN_PRICE_LIST_PERCENTAGE = -99.99;

function toBasisPoints(value: string | number): bigint {
  return BigInt(Math.round(Number(value) * 100));
}

/**
 * Lista a aplicar en una operación: la indicada (activa y de la empresa) o, si no se indica, la principal.
 * Sin listas configuradas devuelve null y se usa el precio de la sucursal tal cual.
 */
export async function resolvePriceList(
  manager: EntityManager,
  tenantId: string,
  priceListId: string | null | undefined,
): Promise<ResolvedPriceList | null> {
  const repository = manager.getRepository(PriceListEntity);
  const list = priceListId
    ? await repository.findOne({ where: { id: priceListId, tenantId, isActive: true, deletedAt: IsNull() } })
    : await repository.findOne({ where: { tenantId, isDefault: true, isActive: true, deletedAt: IsNull() } });
  if (priceListId && !list) {
    throw new BadRequestException('La lista de precios no existe o está desactivada.');
  }
  if (!list) return null;
  const overrides = await manager.getRepository(ProductPriceListEntity).find({
    where: { tenantId, priceListId: list.id },
    select: { productId: true, appliedPercentage: true },
  });
  return {
    id: list.id,
    name: list.name,
    percentage: Number(list.percentage).toFixed(2),
    percentageBasisPoints: toBasisPoints(list.percentage),
    paymentCondition: list.paymentCondition,
    isDefault: list.isDefault,
    overrides: new Map(overrides.map((override) => [override.productId, toBasisPoints(override.appliedPercentage)])),
  };
}

/**
 * Precio unitario en centavos con la lista aplicada, redondeado al centavo (mitad hacia arriba).
 * Ej.: $1.000 con −5 % = $950; con +300 % = $4.000.
 */
export function applyPriceList(baseCents: bigint, list: ResolvedPriceList | null, productId: string): bigint {
  if (!list) return baseCents;
  const basisPoints = list.overrides.get(productId) ?? list.percentageBasisPoints;
  if (basisPoints === 0n) return baseCents;
  const factor = 10_000n + basisPoints;
  if (factor <= 0n) return 0n;
  return (baseCents * factor + 5_000n) / 10_000n;
}

/** Una lista "solo efectivo" no se puede usar si algún pago no es en efectivo. */
export function assertPaymentCondition(list: ResolvedPriceList | null, payments: Array<{ method: string }>): void {
  if (list?.paymentCondition === PriceListPaymentCondition.CASH_ONLY && payments.some((payment) => payment.method !== 'CASH')) {
    throw new BadRequestException(`La lista «${list.name}» se aplica solo si se paga todo en efectivo. Cambiá la lista o el medio de pago.`);
  }
}

/** Datos de la lista que devuelve la cotización y se guardan en la venta. */
export function priceListSummary(list: ResolvedPriceList | null) {
  return list ? { id: list.id, name: list.name, percentage: list.percentage, paymentCondition: list.paymentCondition } : null;
}

/**
 * Lista de efectivo de la empresa: la primera lista activa "solo efectivo" (ej.: "Ventas en efectivo" −5 %).
 * Se aplica sola a la parte de la venta que se paga en efectivo. null si la empresa no tiene una.
 */
export async function resolveCashPriceList(manager: EntityManager, tenantId: string): Promise<ResolvedPriceList | null> {
  const list = await manager.getRepository(PriceListEntity).findOne({
    where: { tenantId, paymentCondition: PriceListPaymentCondition.CASH_ONLY, isActive: true, deletedAt: IsNull() },
    order: { sortOrder: 'ASC', name: 'ASC' },
    select: { id: true },
  });
  return list ? resolvePriceList(manager, tenantId, list.id) : null;
}

/**
 * El descuento de efectivo automático se aplica sobre la lista principal (o sin listas). Con una lista elegida a
 * propósito (cliente con lista propia, gobierno, mayorista) o con una lista "solo efectivo" no se suma otro descuento.
 */
export function cashDiscountApplies(baseList: ResolvedPriceList | null): boolean {
  return baseList === null || (baseList.isDefault && baseList.paymentCondition === PriceListPaymentCondition.ANY);
}
