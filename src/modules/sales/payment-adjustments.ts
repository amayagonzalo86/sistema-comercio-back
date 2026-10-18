import { BadRequestException } from '@nestjs/common';
import { roundDivide, VatLineResult } from '../fiscal/vat/vat';

/**
 * Descuentos y recargos por medio de pago.
 *
 * La venta se cotiza con su lista base (por ejemplo, "Precio de lista"). Cada pago cubre una parte de ese total:
 * - Efectivo con descuento: esa parte se cobra con la lista de efectivo (ej.: −5 %). Si se paga mitad en
 *   efectivo y mitad con tarjeta, el descuento se aplica solo a la mitad pagada en efectivo.
 * - Plan de tarjeta: esa parte lleva el recargo del plan (0 % = cuotas sin interés).
 * - Otros medios: sin ajuste.
 *
 * El importe de cada pago es lo que efectivamente se cobra; la parte de la venta que cubre es
 * importe ÷ factor (factor de efectivo = total con lista de efectivo ÷ total base; de plan = 1 + recargo).
 * La suma de las partes cubiertas tiene que igualar el total base (con hasta 1 centavo de redondeo por pago ajustado).
 */

const SCALE = 1_000_000n;
const BASIS = 10_000n;

export type PaymentAdjustmentKind = 'NONE' | 'CASH_LIST' | 'PLAN';

export interface AdjustablePayment {
  amountCents: bigint;
  kind: PaymentAdjustmentKind;
  /** Solo para PLAN: recargo en puntos básicos (1500 = 15 %). */
  surchargeBasisPoints: bigint;
}

export interface PaymentSettlement {
  /** true si algún pago tiene descuento o recargo. */
  adjusted: boolean;
  /** Total que se cobra (suma de los pagos). */
  totalCents: bigint;
  /** Total cobrado − total base (negativo = descuento). */
  adjustmentTotalCents: bigint;
  /** Parte del total base que cubre cada pago (redondeada al centavo). */
  coveredCents: bigint[];
  /** Pagos con el tipo de ajuste efectivo (un plan al 0 % o una lista que no cambia el total pasan a NONE). */
  payments: AdjustablePayment[];
}

const MISMATCH = 'La suma de los medios de pago debe coincidir con el total de la venta.';

function normalize(payment: AdjustablePayment, baseTotal: bigint, cashTotal: bigint | null): AdjustablePayment {
  if (payment.kind === 'CASH_LIST' && (cashTotal === null || cashTotal <= 0n || cashTotal === baseTotal)) {
    return { ...payment, kind: 'NONE', surchargeBasisPoints: 0n };
  }
  if (payment.kind === 'PLAN' && payment.surchargeBasisPoints === 0n) {
    return { ...payment, kind: 'NONE' };
  }
  if (payment.kind === 'PLAN' && BASIS + payment.surchargeBasisPoints <= 0n) {
    throw new BadRequestException('El recargo del plan de tarjeta es inválido.');
  }
  return payment;
}

function coveredMicro(payment: AdjustablePayment, baseTotal: bigint, cashTotal: bigint | null): bigint {
  if (payment.kind === 'CASH_LIST' && cashTotal) return (payment.amountCents * baseTotal * SCALE) / cashTotal;
  if (payment.kind === 'PLAN') return (payment.amountCents * BASIS * SCALE) / (BASIS + payment.surchargeBasisPoints);
  return payment.amountCents * SCALE;
}

/** Valida que los pagos cubran el total base y calcula el total cobrado y el ajuste. */
export function settlePayments(baseTotalCents: bigint, cashTotalCents: bigint | null, input: AdjustablePayment[]): PaymentSettlement {
  const payments = input.map((payment) => normalize(payment, baseTotalCents, cashTotalCents));
  const totalCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0n);
  const adjustedCount = BigInt(payments.filter((payment) => payment.kind !== 'NONE').length);
  if (adjustedCount === 0n) {
    if (totalCents !== baseTotalCents) throw new BadRequestException(MISMATCH);
    return { adjusted: false, totalCents, adjustmentTotalCents: 0n, coveredCents: payments.map((payment) => payment.amountCents), payments };
  }
  const micro = payments.map((payment) => coveredMicro(payment, baseTotalCents, cashTotalCents));
  const covered = micro.reduce((sum, value) => sum + value, 0n);
  const gap = covered - baseTotalCents * SCALE;
  if ((gap < 0n ? -gap : gap) > adjustedCount * SCALE) {
    throw new BadRequestException(
      `${MISMATCH} Con descuentos o recargos por medio de pago, cada pago cubre su parte del total con su propio precio: revisá los importes.`,
    );
  }
  return {
    adjusted: true,
    totalCents,
    adjustmentTotalCents: totalCents - baseTotalCents,
    coveredCents: micro.map((value) => roundDivide(value, SCALE)),
    payments,
  };
}

export interface AdjustableLine {
  /** Total de la línea con la lista base. */
  baseTotalCents: bigint;
  /** Total de la línea con la lista de efectivo (igual al base si no hay lista de efectivo). */
  cashTotalCents: bigint;
}

/**
 * Total final de cada línea: la parte pagada en efectivo toma el precio de la lista de efectivo de cada producto
 * (respeta los porcentajes propios de productos y las promociones) y la parte pagada con plan lleva su recargo.
 * Los centavos de redondeo se reparten para que la suma sea exactamente el total cobrado.
 */
export function distributeLineTotals(
  lines: AdjustableLine[],
  baseTotalCents: bigint,
  cashTotalCents: bigint | null,
  payments: AdjustablePayment[],
  targetSumCents: bigint,
): bigint[] {
  const scaled = lines.map((line) => {
    let value = line.baseTotalCents * SCALE;
    for (const payment of payments) {
      if (payment.kind === 'CASH_LIST' && cashTotalCents) {
        value += (payment.amountCents * (line.cashTotalCents - line.baseTotalCents) * SCALE) / cashTotalCents;
      } else if (payment.kind === 'PLAN' && baseTotalCents > 0n) {
        value += (payment.amountCents * payment.surchargeBasisPoints * line.baseTotalCents * SCALE) / ((BASIS + payment.surchargeBasisPoints) * baseTotalCents);
      }
    }
    return value < 0n ? 0n : value;
  });
  const totals = scaled.map((value) => value / SCALE);
  const fractions = scaled.map((value) => value % SCALE);
  let diff = targetSumCents - totals.reduce((sum, value) => sum + value, 0n);
  const eligible = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.baseTotalCents > 0n || line.cashTotalCents > 0n).map(({ index }) => index);
  if (eligible.length === 0) return totals;
  if (diff > 0n) {
    const order = [...eligible].sort((a, b) => (fractions[b] > fractions[a] ? 1 : fractions[b] < fractions[a] ? -1 : a - b));
    for (let step = 0; diff > 0n; step += 1) {
      totals[order[step % order.length]] += 1n;
      diff -= 1n;
    }
  } else if (diff < 0n) {
    const order = [...eligible].sort((a, b) => (fractions[a] > fractions[b] ? 1 : fractions[a] < fractions[b] ? -1 : a - b));
    let guard = 0;
    for (let step = 0; diff < 0n; step += 1) {
      const index = order[step % order.length];
      if (totals[index] > 0n) {
        totals[index] -= 1n;
        diff += 1n;
        guard = 0;
      } else if ((guard += 1) > order.length) {
        throw new BadRequestException(MISMATCH);
      }
    }
  }
  return totals;
}

/**
 * Recalcula los importes de IVA de una línea para un total final dado (con IVA incluido en el total):
 * con alícuota, neto = total ÷ (1 + alícuota) e IVA = total − neto; sin IVA, el total va al mismo concepto
 * (neto, exento o no gravado) que la línea original.
 */
export function vatForTotal(primary: VatLineResult, fallback: VatLineResult, targetCents: bigint): VatLineResult {
  if (targetCents === primary.totalCents) return primary;
  const reference = primary.totalCents > 0n ? primary : fallback;
  const zero = { netCents: 0n, vatCents: 0n, exemptCents: 0n, notTaxedCents: 0n };
  const rate = reference.appliedRateBasisPoints;
  if (rate > 0n) {
    const netCents = roundDivide(targetCents * BASIS, BASIS + rate);
    return { ...reference, ...zero, netCents, vatCents: targetCents - netCents, totalCents: targetCents };
  }
  if (reference.exemptCents > 0n) return { ...reference, ...zero, exemptCents: targetCents, totalCents: targetCents };
  if (reference.notTaxedCents > 0n) return { ...reference, ...zero, notTaxedCents: targetCents, totalCents: targetCents };
  return { ...reference, ...zero, netCents: targetCents, totalCents: targetCents };
}
