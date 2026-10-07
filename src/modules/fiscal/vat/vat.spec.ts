import { TaxConditionEnum } from '../../../common/enums/afip.enum';
import {
  computeVatLine,
  findVatRate,
  formatCents,
  normalizeProductVat,
  resolveVatPolicy,
  resolveVoucherClass,
  summarizeVat,
  toCents,
  VatChargeMode,
  VatExemptionReason,
  VatTreatment,
  VoucherClass,
} from './vat';

const base = {
  unitPriceCents: 10_000n, // $100,00
  quantityMilli: 2_000n, // 2 unidades
  treatment: VatTreatment.TAXED,
  rateBasisPoints: 2_100n,
  priceIncludesVat: false,
  chargeMode: VatChargeMode.CHARGE,
};

describe('vat', () => {
  it('suma IVA cuando el precio es neto', () => {
    const line = computeVatLine(base);
    expect(formatCents(line.netCents)).toBe('200.00');
    expect(formatCents(line.vatCents)).toBe('42.00');
    expect(formatCents(line.totalCents)).toBe('242.00');
    expect(line.arcaVatRateId).toBe(5);
  });

  it('extrae el IVA contenido cuando el precio es final', () => {
    const line = computeVatLine({ ...base, unitPriceCents: 12_100n, priceIncludesVat: true });
    expect(formatCents(line.netCents)).toBe('200.00');
    expect(formatCents(line.vatCents)).toBe('42.00');
    expect(formatCents(line.totalCents)).toBe('242.00');
  });

  it('mantiene total = neto + IVA con redondeos difíciles', () => {
    const line = computeVatLine({
      ...base,
      unitPriceCents: 99n,
      quantityMilli: 3_333n,
      rateBasisPoints: 1_050n,
      priceIncludesVat: true,
    });
    expect(line.netCents + line.vatCents).toBe(line.totalCents);
    expect(line.arcaVatRateId).toBe(4);
  });

  it('no cobra IVA a productos exentos ni no gravados', () => {
    const exempt = computeVatLine({ ...base, treatment: VatTreatment.EXEMPT });
    expect(formatCents(exempt.exemptCents)).toBe('200.00');
    expect(exempt.vatCents).toBe(0n);
    const notTaxed = computeVatLine({ ...base, treatment: VatTreatment.NOT_TAXED });
    expect(formatCents(notTaxed.notTaxedCents)).toBe('200.00');
    expect(notTaxed.arcaVatRateId).toBe(null);
  });

  it('emisor monotributista no factura IVA (comprobante C)', () => {
    const line = computeVatLine({ ...base, chargeMode: VatChargeMode.ISSUER_NOT_REGISTERED });
    expect(formatCents(line.totalCents)).toBe('200.00');
    expect(line.vatCents).toBe(0n);
  });

  it('operación exenta quita el IVA incluido en el precio', () => {
    const line = computeVatLine({
      ...base,
      unitPriceCents: 12_100n,
      priceIncludesVat: true,
      chargeMode: VatChargeMode.EXEMPT_OPERATION,
    });
    expect(formatCents(line.exemptCents)).toBe('200.00');
    expect(formatCents(line.totalCents)).toBe('200.00');
  });

  it('rechaza alícuotas inexistentes', () => {
    expect(() => computeVatLine({ ...base, rateBasisPoints: 1_300n })).toThrow(RangeError);
    expect(() => findVatRate(13)).toThrow(RangeError);
    expect(() => normalizeProductVat(VatTreatment.TAXED, 19)).toThrow(RangeError);
  });

  it('fuerza alícuota 0 en exentos y aplica 21 % por defecto', () => {
    expect(normalizeProductVat(VatTreatment.EXEMPT, 21).percent).toBe(0);
    expect(normalizeProductVat(VatTreatment.TAXED, undefined).percent).toBe(21);
  });

  it('agrupa el desglose por alícuota', () => {
    const summary = summarizeVat([
      computeVatLine(base),
      computeVatLine({ ...base, rateBasisPoints: 1_050n }),
      computeVatLine(base),
      computeVatLine({ ...base, treatment: VatTreatment.EXEMPT }),
    ]);
    expect(summary.byRate.length).toBe(2);
    expect(summary.byRate[0].arcaVatRateId).toBe(4);
    expect(formatCents(summary.byRate[1].vatCents)).toBe('84.00');
    expect(formatCents(summary.exemptCents)).toBe('200.00');
    expect(summary.netCents + summary.vatCents + summary.exemptCents + summary.notTaxedCents).toBe(
      summary.totalCents,
    );
  });

  it('resuelve la clase de comprobante', () => {
    const RI = TaxConditionEnum.RESPONSABLE_INSCRIPTO;
    expect(resolveVoucherClass(RI, RI)).toBe(VoucherClass.A);
    expect(resolveVoucherClass(RI, TaxConditionEnum.MONOTRIBUTO)).toBe(VoucherClass.A);
    expect(resolveVoucherClass(RI, TaxConditionEnum.CONSUMIDOR_FINAL)).toBe(VoucherClass.B);
    expect(resolveVoucherClass(RI, TaxConditionEnum.EXENTO)).toBe(VoucherClass.B);
    expect(resolveVoucherClass(TaxConditionEnum.MONOTRIBUTO, RI)).toBe(VoucherClass.C);
    expect(resolveVoucherClass(RI, RI, true)).toBe(VoucherClass.E);
    expect(() => resolveVoucherClass(TaxConditionEnum.CONSUMIDOR_FINAL, RI)).toThrow(RangeError);
  });

  it('arma la política de IVA según emisor, receptor y exención', () => {
    const RI = TaxConditionEnum.RESPONSABLE_INSCRIPTO;
    const toMono = resolveVatPolicy(RI, TaxConditionEnum.MONOTRIBUTO);
    expect(toMono.requiresMonotributoLegend).toBe(true);
    expect(toMono.requiresCustomerCuit).toBe(true);
    const toConsumer = resolveVatPolicy(RI, TaxConditionEnum.CONSUMIDOR_FINAL);
    expect(toConsumer.showsVatContained).toBe(true);
    expect(toConsumer.discriminatesVat).toBe(false);
    const exported = resolveVatPolicy(RI, TaxConditionEnum.CONSUMIDOR_FINAL, VatExemptionReason.EXPORT);
    expect(exported.voucherClass).toBe(VoucherClass.E);
    expect(exported.chargeMode).toBe(VatChargeMode.EXEMPT_OPERATION);
    const mono = resolveVatPolicy(TaxConditionEnum.MONOTRIBUTO, RI);
    expect(mono.chargeMode).toBe(VatChargeMode.ISSUER_NOT_REGISTERED);
  });

  it('convierte importes a centavos sin errores de coma flotante', () => {
    expect(toCents(0.1 + 0.2)).toBe(30n);
    expect(toCents('1234.5')).toBe(123_450n);
    expect(() => toCents(-1)).toThrow(RangeError);
  });
});
