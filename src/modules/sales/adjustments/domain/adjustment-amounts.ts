import { findVatRate, roundDivide } from '../../../fiscal/vat/vat';

/** Cómo se discrimina el importe de una nota de crédito o débito por importe. */
export type AdjustmentVatMode =
  /** Con IVA: el importe final incluye la alícuota elegida (comprobantes A y B de un Responsable Inscripto). */
  | 'TAXED'
  /** Exento: venta sin IVA (Tierra del Fuego, exportación u otra causa legal) o alícuota 0 %. */
  | 'EXEMPT'
  /** Clase C (emisor monotributista o exento): todo el importe va como neto, sin IVA. */
  | 'NET_ONLY';

export interface AdjustmentAmounts {
  netCents: bigint;
  vatCents: bigint;
  exemptCents: bigint;
  totalCents: bigint;
  /** Alícuota aplicada en puntos básicos (2100 = 21 %); 0 si no lleva IVA. */
  rateBasisPoints: bigint;
  /** Id ARCA de la alícuota (5 = 21 %); null si no lleva IVA. */
  arcaVatRateId: number | null;
}

/**
 * Discrimina el importe final de la nota. Ej.: $1.210 al 21 % → neto $1.000 + IVA $210.
 * Lanza RangeError si la alícuota no es una de las vigentes.
 */
export function adjustmentAmounts(totalCents: bigint, ratePercent: number, mode: AdjustmentVatMode): AdjustmentAmounts {
  if (totalCents <= 0n) throw new RangeError('El importe debe ser mayor a cero.');
  if (mode === 'NET_ONLY') {
    return { netCents: totalCents, vatCents: 0n, exemptCents: 0n, totalCents, rateBasisPoints: 0n, arcaVatRateId: null };
  }
  const rate = findVatRate(ratePercent);
  if (mode === 'EXEMPT' || rate.basisPoints === 0) {
    return { netCents: 0n, vatCents: 0n, exemptCents: totalCents, totalCents, rateBasisPoints: 0n, arcaVatRateId: null };
  }
  const basis = BigInt(rate.basisPoints);
  const netCents = roundDivide(totalCents * 10_000n, 10_000n + basis);
  return { netCents, vatCents: totalCents - netCents, exemptCents: 0n, totalCents, rateBasisPoints: basis, arcaVatRateId: rate.arcaId };
}
