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
  /**
   * Es la lista de partida del cobro (la principal común; si la principal fuera de pago contado o no hubiera
   * principal, la primera lista común activa). Sobre ella se aplica el descuento de contado automático.
   */
  isChargeBase: boolean;
  /** Pago contado: medios de pago que reciben la lista (siempre incluye CASH). */
  cashMethods: string[];
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
  const base = await chargeBaseList(manager, tenantId);
  const list = priceListId ? await repository.findOne({ where: { id: priceListId, tenantId, isActive: true, deletedAt: IsNull() } }) : base;
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
    isChargeBase: list.paymentCondition === PriceListPaymentCondition.ANY && list.id === base?.id,
    cashMethods: cashMethodsOf(list.discountMethods),
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

/** Una lista de pago contado elegida para toda la venta exige que todos los pagos sean de sus medios (efectivo y los elegidos). */
export function assertPaymentCondition(list: ResolvedPriceList | null, payments: Array<{ method: string }>): void {
  if (list?.paymentCondition === PriceListPaymentCondition.CASH_ONLY && payments.some((payment) => !list.cashMethods.includes(payment.method))) {
    throw new BadRequestException(`La lista «${list.name}» se aplica solo si se paga todo en efectivo. Cambiá la lista o el medio de pago.`);
  }
}

/** "DEBIT_CARD,QR" → ["DEBIT_CARD", "QR"]. */
export function parseMethods(value: string | null | undefined): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter((item) => item && item !== 'CREDIT_CARD' && item !== 'CASH') : [];
}

/** Medios que reciben una lista de pago contado: efectivo más los configurados (nunca crédito). */
export function cashMethodsOf(discountMethods: string | null | undefined): string[] {
  return ['CASH', ...parseMethods(discountMethods)];
}

/** Datos de la lista que devuelve la cotización y se guardan en la venta. */
export function priceListSummary(list: ResolvedPriceList | null) {
  return list ? { id: list.id, name: list.name, percentage: list.percentage, paymentCondition: list.paymentCondition, methods: list.cashMethods } : null;
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
  return baseList === null || baseList.isChargeBase;
}

/**
 * Lista de partida del cobro: la principal si es común; si la principal es de pago contado (datos anteriores a la
 * regla) o no hay principal, la primera lista común activa. null si la empresa no tiene listas comunes.
 */
export async function chargeBaseList(manager: EntityManager, tenantId: string): Promise<PriceListEntity | null> {
  const repository = manager.getRepository(PriceListEntity);
  const where = { tenantId, paymentCondition: PriceListPaymentCondition.ANY, isActive: true, deletedAt: IsNull() };
  return (
    (await repository.findOne({ where: { ...where, isDefault: true } })) ??
    (await repository.findOne({ where, order: { sortOrder: 'ASC', name: 'ASC' } }))
  );
}
