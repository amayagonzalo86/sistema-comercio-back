import { roundDivide } from '../../../common/utils/money';

export enum PromotionType {
  /** Descuento porcentual sobre el importe de la línea. */
  PERCENTAGE = 'PERCENTAGE',
  /** Llevá X, pagá Y (3x2, 2x1): por cada grupo completo de X unidades se bonifican X−Y. */
  BUY_X_PAY_Y = 'BUY_X_PAY_Y',
}

export interface PromotionRule {
  id: string;
  name: string;
  type: PromotionType;
  /** Puntos básicos: 15 % = 1500. Solo PERCENTAGE. */
  percentBasisPoints?: number | null;
  buyQuantity?: number | null;
  payQuantity?: number | null;
  /** Vacíos o null = sin restricción. */
  productIds?: readonly string[] | null;
  categories?: readonly string[] | null;
  brands?: readonly string[] | null;
  branchIds?: readonly string[] | null;
  /** Días de la semana locales (0 = domingo ... 6 = sábado). */
  weekdays?: readonly number[] | null;
  /** Cantidad mínima de la línea para aplicar (milésimas). */
  minQuantityMilli?: bigint | null;
}

export interface PricedLineContext {
  productId: string;
  category: string | null;
  brand: string | null;
  branchId: string;
  quantityMilli: bigint;
  unitPriceCents: bigint;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  discountCents: bigint;
}

const matches = (list: readonly string[] | null | undefined, value: string | null): boolean =>
  !list || list.length === 0 || (value !== null && list.includes(value));

export function ruleApplies(rule: PromotionRule, line: PricedLineContext, weekday: number): boolean {
  if (rule.weekdays && rule.weekdays.length > 0 && !rule.weekdays.includes(weekday)) return false;
  if (!matches(rule.branchIds, line.branchId)) return false;
  if (!matches(rule.productIds, line.productId)) return false;
  if (!matches(rule.categories, line.category)) return false;
  if (!matches(rule.brands, line.brand)) return false;
  if (rule.minQuantityMilli && line.quantityMilli < rule.minQuantityMilli) return false;
  return true;
}

/** Descuento (en centavos) que una regla otorga a una línea. Nunca supera el importe de la línea. */
export function discountFor(rule: PromotionRule, line: PricedLineContext): bigint {
  const lineAmount = roundDivide(line.unitPriceCents * line.quantityMilli, 1000n);
  let discount = 0n;
  if (rule.type === PromotionType.PERCENTAGE) {
    const bp = BigInt(rule.percentBasisPoints ?? 0);
    if (bp <= 0n) return 0n;
    discount = roundDivide(lineAmount * bp, 10_000n);
  } else if (rule.type === PromotionType.BUY_X_PAY_Y) {
    const buy = BigInt(rule.buyQuantity ?? 0);
    const pay = BigInt(rule.payQuantity ?? 0);
    if (buy <= 0n || pay < 0n || pay >= buy) return 0n;
    const groups = line.quantityMilli / (buy * 1000n);
    discount = groups * (buy - pay) * line.unitPriceCents;
  }
  if (discount < 0n) return 0n;
  return discount > lineAmount ? lineAmount : discount;
}

/**
 * Elige la mejor promoción para la línea (las promociones no se acumulan entre sí).
 * Ante igual descuento gana la de id menor, para que el resultado sea determinístico.
 */
export function bestPromotion(rules: readonly PromotionRule[], line: PricedLineContext, weekday: number): AppliedPromotion | null {
  let best: AppliedPromotion | null = null;
  for (const rule of [...rules].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!ruleApplies(rule, line, weekday)) continue;
    const discountCents = discountFor(rule, line);
    if (discountCents > 0n && (!best || discountCents > best.discountCents)) {
      best = { promotionId: rule.id, name: rule.name, discountCents };
    }
  }
  return best;
}
