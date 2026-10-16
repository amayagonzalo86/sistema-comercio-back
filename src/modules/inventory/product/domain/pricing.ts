import { roundDivide } from '../../../../common/utils/money';

/** Redondeo hacia arriba del precio resultante (habitual en comercios para evitar centavos). */
export enum PriceRounding {
  NONE = 'NONE',
  UNIT = 'UNIT',
  TEN = 'TEN',
  HUNDRED = 'HUNDRED',
}

/** Qué precio modifica un ajuste masivo. */
export enum PriceTarget {
  /** Solo el precio de venta; el margen se recalcula. */
  SELLING_PRICE = 'SELLING_PRICE',
  /** El costo (nueva lista del proveedor) y el precio de venta acompaña manteniendo el margen. */
  COST_KEEP_MARGIN = 'COST_KEEP_MARGIN',
  /** Solo el costo; el precio de venta no cambia y el margen se recalcula. */
  COST_ONLY = 'COST_ONLY',
}

const ROUNDING_STEP: Record<PriceRounding, bigint> = {
  [PriceRounding.NONE]: 1n,
  [PriceRounding.UNIT]: 100n,
  [PriceRounding.TEN]: 1_000n,
  [PriceRounding.HUNDRED]: 10_000n,
};

const BASIS = 10_000n;
export const MAX_PRICE_CENTS = 999_999_999_999n; // DECIMAL(12,2)
export const MAX_MARGIN_BASIS_POINTS = 99_999n; // DECIMAL(5,2) => 999.99 %

export function roundUpTo(valueCents: bigint, rounding: PriceRounding): bigint {
  const step = ROUNDING_STEP[rounding];
  if (step === 1n || valueCents <= 0n) {
    return valueCents;
  }
  return ((valueCents + step - 1n) / step) * step;
}

/** Aplica un porcentaje (en puntos básicos: 12,5 % = 1250n; puede ser negativo) y redondea. */
export function applyPercentage(valueCents: bigint, percentBasisPoints: bigint, rounding: PriceRounding): bigint {
  if (percentBasisPoints <= -BASIS) {
    throw new RangeError('El porcentaje no puede llevar el precio a cero o menos.');
  }
  const raw = roundDivide(valueCents * (BASIS + percentBasisPoints), BASIS);
  const result = roundUpTo(raw, rounding);
  if (result > MAX_PRICE_CENTS) {
    throw new RangeError('El precio resultante excede el máximo admitido.');
  }
  return result;
}

/** Margen de ganancia sobre el costo, en puntos básicos. Sin costo cargado devuelve null. */
export function marginBasisPoints(costCents: bigint, sellingCents: bigint): bigint | null {
  if (costCents <= 0n) {
    return null;
  }
  const margin = roundDivide((sellingCents - costCents) * BASIS, costCents);
  if (margin < 0n) return 0n;
  return margin > MAX_MARGIN_BASIS_POINTS ? MAX_MARGIN_BASIS_POINTS : margin;
}

/** Precio de venta que mantiene un margen dado sobre el costo. */
export function priceFromMargin(costCents: bigint, marginBp: bigint, rounding: PriceRounding): bigint {
  return roundUpTo(roundDivide(costCents * (BASIS + marginBp), BASIS), rounding);
}

export interface PriceSnapshot {
  costCents: bigint;
  sellingCents: bigint;
  /** Margen sobre el costo total (costo + flete). */
  marginBp: bigint;
  /** Flete en puntos básicos del costo (5 % = 500n). */
  freightBp?: bigint;
  /** Flete fijo por unidad, en centavos. */
  freightCents?: bigint;
}

export const MAX_FREIGHT_BASIS_POINTS = 30_000n; // 300 %

/** Costo total = costo + flete % + flete $. Es la base del margen de ganancia. */
export function totalCost(costCents: bigint, freightBp = 0n, freightCents = 0n): bigint {
  return roundDivide(costCents * (BASIS + freightBp), BASIS) + freightCents;
}

function snapshotTotalCost(snapshot: PriceSnapshot, costCents = snapshot.costCents): bigint {
  return totalCost(costCents, snapshot.freightBp ?? 0n, snapshot.freightCents ?? 0n);
}

/**
 * Fija el flete (porcentaje sobre el costo) y recalcula el precio de venta manteniendo el margen.
 * Ej.: costo $1000, margen 50 %, flete 0 % → $1500; con flete 10 % → costo total $1100 → $1650.
 */
export function applyFreight(current: PriceSnapshot, freightBp: bigint, rounding: PriceRounding): PriceSnapshot {
  if (freightBp < 0n || freightBp > MAX_FREIGHT_BASIS_POINTS) throw new RangeError('El flete debe estar entre 0 % y 300 %.');
  const marginBp = marginBasisPoints(snapshotTotalCost(current), current.sellingCents) ?? current.marginBp;
  const next: PriceSnapshot = { ...current, freightBp, marginBp };
  const base = snapshotTotalCost(next);
  const sellingCents = base > 0n ? priceFromMargin(base, marginBp, rounding) : current.sellingCents;
  if (sellingCents > MAX_PRICE_CENTS) throw new RangeError('El precio resultante excede el máximo admitido.');
  return { ...next, sellingCents };
}

/**
 * Suma (o resta) un importe fijo al costo o al precio de venta. Sirve cuando el proveedor sube "$ 500 por unidad":
 * el porcentaje equivalente de cada producto se informa en la vista previa.
 */
export function addAmount(current: PriceSnapshot, target: PriceTarget, amountCents: bigint, rounding: PriceRounding): PriceSnapshot {
  switch (target) {
    case PriceTarget.SELLING_PRICE: {
      const sellingCents = roundUpTo(current.sellingCents + amountCents, rounding);
      if (sellingCents <= 0n) throw new RangeError('El precio resultante quedaría en cero o menos.');
      if (sellingCents > MAX_PRICE_CENTS) throw new RangeError('El precio resultante excede el máximo admitido.');
      return { ...current, sellingCents, marginBp: marginBasisPoints(snapshotTotalCost(current), sellingCents) ?? current.marginBp };
    }
    case PriceTarget.COST_KEEP_MARGIN: {
      const costCents = current.costCents + amountCents;
      if (costCents < 0n) throw new RangeError('El costo resultante quedaría negativo.');
      const marginBp = marginBasisPoints(snapshotTotalCost(current), current.sellingCents) ?? current.marginBp;
      const base = snapshotTotalCost(current, costCents);
      const sellingCents = base > 0n ? priceFromMargin(base, marginBp, rounding) : roundUpTo(current.sellingCents + amountCents, rounding);
      if (sellingCents <= 0n) throw new RangeError('El precio resultante quedaría en cero o menos.');
      if (sellingCents > MAX_PRICE_CENTS) throw new RangeError('El precio resultante excede el máximo admitido.');
      return { ...current, costCents, sellingCents, marginBp };
    }
    case PriceTarget.COST_ONLY: {
      const costCents = current.costCents + amountCents;
      if (costCents < 0n) throw new RangeError('El costo resultante quedaría negativo.');
      return { ...current, costCents, marginBp: marginBasisPoints(snapshotTotalCost(current, costCents), current.sellingCents) ?? current.marginBp };
    }
    default:
      throw new RangeError('Objetivo de ajuste de precio inválido.');
  }
}

/** Variación del precio de venta en puntos básicos (para mostrar el % equivalente de un aumento en $). */
export function changeBasisPoints(beforeCents: bigint, afterCents: bigint): bigint | null {
  if (beforeCents <= 0n) return null;
  return roundDivide((afterCents - beforeCents) * BASIS, beforeCents);
}

/** Calcula el nuevo par costo/precio/margen de una fila según el objetivo del ajuste. */
export function adjustPrices(
  current: PriceSnapshot,
  target: PriceTarget,
  percentBasisPoints: bigint,
  rounding: PriceRounding,
): PriceSnapshot {
  switch (target) {
    case PriceTarget.SELLING_PRICE: {
      const sellingCents = applyPercentage(current.sellingCents, percentBasisPoints, rounding);
      return {
        ...current,
        sellingCents,
        marginBp: marginBasisPoints(snapshotTotalCost(current), sellingCents) ?? current.marginBp,
      };
    }
    case PriceTarget.COST_KEEP_MARGIN: {
      const costCents = applyPercentage(current.costCents, percentBasisPoints, PriceRounding.NONE);
      const marginBp = marginBasisPoints(snapshotTotalCost(current), current.sellingCents) ?? current.marginBp;
      const base = snapshotTotalCost(current, costCents);
      const sellingCents =
        base > 0n
          ? priceFromMargin(base, marginBp, rounding)
          : applyPercentage(current.sellingCents, percentBasisPoints, rounding);
      if (sellingCents > MAX_PRICE_CENTS) {
        throw new RangeError('El precio resultante excede el máximo admitido.');
      }
      return { ...current, costCents, sellingCents, marginBp };
    }
    case PriceTarget.COST_ONLY: {
      const costCents = applyPercentage(current.costCents, percentBasisPoints, PriceRounding.NONE);
      return {
        ...current,
        costCents,
        sellingCents: current.sellingCents,
        marginBp: marginBasisPoints(snapshotTotalCost(current, costCents), current.sellingCents) ?? current.marginBp,
      };
    }
    default:
      throw new RangeError('Objetivo de ajuste de precio inválido.');
  }
}
