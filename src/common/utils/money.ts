/**
 * Utilidades de importes en enteros: centavos (2 decimales) y milésimas (cantidades, 3 decimales).
 * Evitan errores de coma flotante en precios, stock y totales.
 */

export function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError('El divisor debe ser positivo.');
  }
  if (numerator < 0n) {
    return -roundDivide(-numerator, denominator);
  }
  return (numerator + denominator / 2n) / denominator;
}

function toScaled(value: number | string, decimals: number, allowNegative: boolean): bigint {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || (!allowNegative && numeric < 0)) {
    throw new RangeError('El valor debe ser un número finito' + (allowNegative ? '.' : ' no negativo.'));
  }
  const negative = numeric < 0;
  const [whole, fraction = ''] = Math.abs(numeric).toFixed(decimals).split('.');
  const scaled = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return negative ? -scaled : scaled;
}

function formatScaled(value: bigint, decimals: number): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const base = 10n ** BigInt(decimals);
  return `${sign}${absolute / base}.${(absolute % base).toString().padStart(decimals, '0')}`;
}

/** 12.5 -> 1250n */
export function cents(value: number | string, allowNegative = false): bigint {
  return toScaled(value, 2, allowNegative);
}

/** 1250n -> "12.50" */
export function formatMoney(value: bigint): string {
  return formatScaled(value, 2);
}

/** 1.5 -> 1500n */
export function milli(value: number | string, allowNegative = false): bigint {
  return toScaled(value, 3, allowNegative);
}

/** 1500n -> "1.500" */
export function formatQuantity(value: bigint): string {
  return formatScaled(value, 3);
}

/** Importe de una cantidad a un precio unitario: (precio en centavos × cantidad en milésimas) / 1000. */
export function lineAmount(unitPriceCents: bigint, quantityMilli: bigint): bigint {
  return roundDivide(unitPriceCents * quantityMilli, 1000n);
}
