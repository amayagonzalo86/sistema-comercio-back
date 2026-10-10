import { TaxConditionEnum } from '../../../common/enums/afip.enum';

/**
 * Núcleo de IVA para Argentina.
 *
 * Todo el cálculo usa enteros (`bigint`) en centavos y milésimas de cantidad para
 * evitar errores de punto flotante. Este archivo no depende de NestJS ni de TypeORM,
 * por eso se puede probar en forma aislada y reutilizar en ventas, compras y facturación.
 */

/** Tratamiento del producto frente al IVA (Ley de IVA, arts. 1, 3 y 7). */
export enum VatTreatment {
  /** Gravado: lleva alícuota (0 %, 2,5 %, 5 %, 10,5 %, 21 % o 27 %). */
  TAXED = 'TAXED',
  /** Exento por ley (art. 7 Ley de IVA): no lleva IVA y se informa como importe exento. */
  EXEMPT = 'EXEMPT',
  /** No gravado (fuera del objeto del impuesto): se informa como importe no gravado. */
  NOT_TAXED = 'NOT_TAXED',
}

/**
 * Cómo se aplica el IVA en una operación concreta.
 * - CHARGE: el emisor es Responsable Inscripto y la operación está gravada.
 * - ISSUER_NOT_REGISTERED: el emisor es Monotributo/Exento (comprobante C): no factura IVA.
 * - EXEMPT_OPERATION: operación exenta (exportación, Tierra del Fuego, etc.): se quita el IVA.
 */
export enum VatChargeMode {
  CHARGE = 'CHARGE',
  ISSUER_NOT_REGISTERED = 'ISSUER_NOT_REGISTERED',
  EXEMPT_OPERATION = 'EXEMPT_OPERATION',
}

/** Motivos admitidos para quitar el IVA de una venta completa. Quedan auditados. */
export enum VatExemptionReason {
  EXPORT = 'EXPORT',
  TIERRA_DEL_FUEGO = 'TIERRA_DEL_FUEGO',
  DIPLOMATIC = 'DIPLOMATIC',
  OTHER_LEGAL = 'OTHER_LEGAL',
}

/** Clase de comprobante según condición del emisor y del receptor. */
export enum VoucherClass {
  A = 'A',
  B = 'B',
  C = 'C',
  E = 'E',
}

export interface VatRateDefinition {
  readonly percent: number;
  readonly basisPoints: number;
  /** Id de alícuota de WSFEv1 (FEParamGetTiposIva). */
  readonly arcaId: number;
}

/** Alícuotas vigentes y sus códigos ARCA (WSFEv1). */
export const VAT_RATES: readonly VatRateDefinition[] = Object.freeze([
  { percent: 0, basisPoints: 0, arcaId: 3 },
  { percent: 2.5, basisPoints: 250, arcaId: 9 },
  { percent: 5, basisPoints: 500, arcaId: 8 },
  { percent: 10.5, basisPoints: 1050, arcaId: 4 },
  { percent: 21, basisPoints: 2100, arcaId: 5 },
  { percent: 27, basisPoints: 2700, arcaId: 6 },
]);

export const ALLOWED_VAT_PERCENTAGES: readonly number[] = Object.freeze(
  VAT_RATES.map((rate) => rate.percent),
);

export const DEFAULT_VAT_PERCENT = 21;

/** Leyenda exigida por la RG 5003/2021 en comprobantes A emitidos a monotributistas. */
export const MONOTRIBUTO_CREDIT_LEGEND =
  'El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618';

/** Título del apartado exigido por el Régimen de Transparencia Fiscal al Consumidor. */
export const FISCAL_TRANSPARENCY_TITLE = 'Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)';

export function isAllowedVatPercent(percent: number): boolean {
  return VAT_RATES.some((rate) => rate.percent === Number(percent));
}

export function findVatRate(percent: number): VatRateDefinition {
  const rate = VAT_RATES.find((item) => item.percent === Number(percent));
  if (!rate) {
    throw new RangeError(
      `Alícuota de IVA no admitida: ${percent}. Valores válidos: ${ALLOWED_VAT_PERCENTAGES.join(', ')}.`,
    );
  }
  return rate;
}

/**
 * Normaliza la combinación tratamiento/alícuota de un producto.
 * Un producto exento o no gravado siempre queda con alícuota 0.
 */
export function normalizeProductVat(
  treatment: VatTreatment,
  percent: number | undefined,
): { treatment: VatTreatment; percent: number } {
  if (treatment !== VatTreatment.TAXED) {
    return { treatment, percent: 0 };
  }
  const effective = percent ?? DEFAULT_VAT_PERCENT;
  findVatRate(effective);
  return { treatment, percent: Number(effective) };
}

/**
 * Determina la clase de comprobante.
 * - Exportación: E.
 * - Emisor Monotributo, Exento o No Responsable: C.
 * - Emisor Responsable Inscripto: A si el receptor es RI o Monotributo (RG 5003/2021); B en el resto.
 */
export function resolveVoucherClass(
  issuer: TaxConditionEnum,
  customer: TaxConditionEnum,
  isExport = false,
): VoucherClass {
  if (isExport) {
    return VoucherClass.E;
  }
  switch (issuer) {
    case TaxConditionEnum.RESPONSABLE_INSCRIPTO:
      return customer === TaxConditionEnum.RESPONSABLE_INSCRIPTO ||
        customer === TaxConditionEnum.MONOTRIBUTO
        ? VoucherClass.A
        : VoucherClass.B;
    case TaxConditionEnum.MONOTRIBUTO:
    case TaxConditionEnum.EXENTO:
    case TaxConditionEnum.NO_RESPONSABLE:
      return VoucherClass.C;
    default:
      throw new RangeError(`La condición frente al IVA "${issuer}" no puede emitir comprobantes.`);
  }
}

export interface VatPolicy {
  readonly voucherClass: VoucherClass;
  readonly chargeMode: VatChargeMode;
  /** El IVA se muestra como renglón separado (comprobante A). */
  readonly discriminatesVat: boolean;
  /** Se informa el "IVA contenido" del Régimen de Transparencia Fiscal (comprobante B). */
  readonly showsVatContained: boolean;
  /** El comprobante debe incluir la leyenda de la RG 5003/2021. */
  readonly requiresMonotributoLegend: boolean;
  /** El receptor debe estar identificado con CUIT válida. */
  readonly requiresCustomerCuit: boolean;
}

export function resolveVatPolicy(
  issuer: TaxConditionEnum,
  customer: TaxConditionEnum,
  exemptionReason: VatExemptionReason | null = null,
): VatPolicy {
  const voucherClass = resolveVoucherClass(issuer, customer, exemptionReason === VatExemptionReason.EXPORT);
  const issuerRegistered = issuer === TaxConditionEnum.RESPONSABLE_INSCRIPTO;
  let chargeMode: VatChargeMode;
  if (!issuerRegistered) {
    chargeMode = VatChargeMode.ISSUER_NOT_REGISTERED;
  } else if (exemptionReason) {
    chargeMode = VatChargeMode.EXEMPT_OPERATION;
  } else {
    chargeMode = VatChargeMode.CHARGE;
  }
  return {
    voucherClass,
    chargeMode,
    discriminatesVat: voucherClass === VoucherClass.A,
    showsVatContained: voucherClass === VoucherClass.B && chargeMode === VatChargeMode.CHARGE,
    requiresMonotributoLegend:
      voucherClass === VoucherClass.A && customer === TaxConditionEnum.MONOTRIBUTO,
    requiresCustomerCuit: voucherClass === VoucherClass.A,
  };
}

export interface VatLineInput {
  /** Precio unitario en centavos tal como está cargado en el catálogo. */
  readonly unitPriceCents: bigint;
  /** Cantidad en milésimas (1 unidad = 1000n). */
  readonly quantityMilli: bigint;
  readonly treatment: VatTreatment;
  /** Alícuota en puntos básicos (21 % = 2100n). */
  readonly rateBasisPoints: bigint;
  /** true si el precio de catálogo ya incluye IVA (precio final al consumidor). */
  readonly priceIncludesVat: boolean;
  readonly chargeMode: VatChargeMode;
  /**
   * Descuento de la línea en centavos (promociones). Se resta del importe al mismo nivel que el precio:
   * si el precio incluye IVA, el descuento también; el IVA se calcula sobre el importe descontado.
   */
  readonly discountCents?: bigint;
}

export interface VatLineResult {
  /** Base imponible gravada (neto gravado). */
  readonly netCents: bigint;
  readonly vatCents: bigint;
  readonly exemptCents: bigint;
  readonly notTaxedCents: bigint;
  readonly totalCents: bigint;
  /** Alícuota efectivamente aplicada (0 si no se cobró IVA). */
  readonly appliedRateBasisPoints: bigint;
  /** Id ARCA de la alícuota cuando hay neto gravado; null en otro caso. */
  readonly arcaVatRateId: number | null;
}

const BASIS = 10_000n;

export function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError('El divisor debe ser positivo.');
  }
  if (numerator < 0n) {
    return -roundDivide(-numerator, denominator);
  }
  return (numerator + denominator / 2n) / denominator;
}

function arcaIdForBasisPoints(basisPoints: bigint): number {
  const rate = VAT_RATES.find((item) => BigInt(item.basisPoints) === basisPoints);
  if (!rate) {
    throw new RangeError(`Alícuota de IVA no admitida: ${basisPoints} puntos básicos.`);
  }
  return rate.arcaId;
}

/**
 * Calcula neto, IVA, exento, no gravado y total de una línea.
 * Invariante: total = neto + IVA + exento + no gravado.
 */
export function computeVatLine(input: VatLineInput): VatLineResult {
  if (input.unitPriceCents < 0n || input.quantityMilli <= 0n) {
    throw new RangeError('Precio y cantidad deben ser positivos.');
  }
  const rate = input.treatment === VatTreatment.TAXED ? input.rateBasisPoints : 0n;
  if (input.treatment === VatTreatment.TAXED) {
    arcaIdForBasisPoints(rate);
  }
  const grossAmountCents = roundDivide(input.unitPriceCents * input.quantityMilli, 1000n);
  const discountCents = input.discountCents ?? 0n;
  if (discountCents < 0n || discountCents > grossAmountCents) {
    throw new RangeError('El descuento debe estar entre cero y el importe de la línea.');
  }
  const amountCents = grossAmountCents - discountCents;
  const zero = { netCents: 0n, vatCents: 0n, exemptCents: 0n, notTaxedCents: 0n };

  // Emisor no inscripto (comprobante C): el precio es el importe final, sin IVA facturado.
  if (input.chargeMode === VatChargeMode.ISSUER_NOT_REGISTERED) {
    return {
      ...zero,
      netCents: amountCents,
      totalCents: amountCents,
      appliedRateBasisPoints: 0n,
      arcaVatRateId: null,
    };
  }

  // Operación exenta: si el precio incluía IVA se lo quita; el resultado se informa como exento.
  if (input.chargeMode === VatChargeMode.EXEMPT_OPERATION) {
    const base =
      input.priceIncludesVat && rate > 0n
        ? roundDivide(amountCents * BASIS, BASIS + rate)
        : amountCents;
    return {
      ...zero,
      exemptCents: base,
      totalCents: base,
      appliedRateBasisPoints: 0n,
      arcaVatRateId: null,
    };
  }

  if (input.treatment === VatTreatment.EXEMPT) {
    return { ...zero, exemptCents: amountCents, totalCents: amountCents, appliedRateBasisPoints: 0n, arcaVatRateId: null };
  }
  if (input.treatment === VatTreatment.NOT_TAXED) {
    return { ...zero, notTaxedCents: amountCents, totalCents: amountCents, appliedRateBasisPoints: 0n, arcaVatRateId: null };
  }

  if (input.priceIncludesVat) {
    const netCents = roundDivide(amountCents * BASIS, BASIS + rate);
    return {
      ...zero,
      netCents,
      vatCents: amountCents - netCents,
      totalCents: amountCents,
      appliedRateBasisPoints: rate,
      arcaVatRateId: arcaIdForBasisPoints(rate),
    };
  }

  const vatCents = roundDivide(amountCents * rate, BASIS);
  return {
    ...zero,
    netCents: amountCents,
    vatCents,
    totalCents: amountCents + vatCents,
    appliedRateBasisPoints: rate,
    arcaVatRateId: arcaIdForBasisPoints(rate),
  };
}

export interface VatRateBreakdown {
  readonly arcaVatRateId: number;
  readonly rateBasisPoints: bigint;
  readonly baseCents: bigint;
  readonly vatCents: bigint;
}

export interface VatSummary {
  readonly netCents: bigint;
  readonly vatCents: bigint;
  readonly exemptCents: bigint;
  readonly notTaxedCents: bigint;
  readonly totalCents: bigint;
  /** Desglose por alícuota (equivale al arreglo AlicIva de WSFEv1). */
  readonly byRate: readonly VatRateBreakdown[];
}

export function summarizeVat(lines: readonly VatLineResult[]): VatSummary {
  const byRate = new Map<number, { rateBasisPoints: bigint; baseCents: bigint; vatCents: bigint }>();
  let netCents = 0n;
  let vatCents = 0n;
  let exemptCents = 0n;
  let notTaxedCents = 0n;
  let totalCents = 0n;
  for (const line of lines) {
    netCents += line.netCents;
    vatCents += line.vatCents;
    exemptCents += line.exemptCents;
    notTaxedCents += line.notTaxedCents;
    totalCents += line.totalCents;
    if (line.arcaVatRateId !== null) {
      const bucket = byRate.get(line.arcaVatRateId) ?? {
        rateBasisPoints: line.appliedRateBasisPoints,
        baseCents: 0n,
        vatCents: 0n,
      };
      bucket.baseCents += line.netCents;
      bucket.vatCents += line.vatCents;
      byRate.set(line.arcaVatRateId, bucket);
    }
  }
  return {
    netCents,
    vatCents,
    exemptCents,
    notTaxedCents,
    totalCents,
    byRate: [...byRate.entries()]
      .sort(([a], [b]) => a - b)
      .map(([arcaVatRateId, bucket]) => ({ arcaVatRateId, ...bucket })),
  };
}

export function toCents(value: number | string): bigint {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new RangeError('Los importes deben ser números finitos no negativos.');
  }
  const [whole, fraction = ''] = numeric.toFixed(2).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function percentToBasisPoints(percent: number | string): bigint {
  return toCents(percent);
}

export function formatCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
