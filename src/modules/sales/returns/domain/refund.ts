import { roundDivide } from '../../../../common/utils/money';

/** Importes de una línea de venta (en centavos). total = net + vat + exempt + notTaxed. */
export interface LineAmounts {
  net: bigint;
  vat: bigint;
  exempt: bigint;
  notTaxed: bigint;
}

export interface LineReturnState {
  /** Cantidad vendida originalmente (milésimas). */
  soldMilli: bigint;
  /** Cantidad ya devuelta en devoluciones anteriores (milésimas). */
  returnedMilli: bigint;
  /** Importes de la línea original. */
  original: LineAmounts;
  /** Importes ya reintegrados en devoluciones anteriores. */
  refunded: LineAmounts;
}

export function totalOf(amounts: LineAmounts): bigint {
  return amounts.net + amounts.vat + amounts.exempt + amounts.notTaxed;
}

/**
 * Importes a reintegrar al devolver `quantityMilli` de una línea.
 * Proporcional a lo vendido; si la devolución completa la cantidad vendida, devuelve exactamente
 * el saldo pendiente para que la suma de reintegros nunca difiera del importe cobrado.
 */
export function refundForLine(state: LineReturnState, quantityMilli: bigint): LineAmounts {
  if (quantityMilli <= 0n) {
    throw new RangeError('La cantidad a devolver debe ser positiva.');
  }
  const pending = state.soldMilli - state.returnedMilli;
  if (quantityMilli > pending) {
    throw new RangeError('La cantidad a devolver supera lo pendiente de esa línea.');
  }
  const completes = quantityMilli === pending;
  const share = (original: bigint, refunded: bigint): bigint =>
    completes ? original - refunded : roundDivide(original * quantityMilli, state.soldMilli);
  return {
    net: share(state.original.net, state.refunded.net),
    vat: share(state.original.vat, state.refunded.vat),
    exempt: share(state.original.exempt, state.refunded.exempt),
    notTaxed: share(state.original.notTaxed, state.refunded.notTaxed),
  };
}
