import {
  adjustPrices,
  applyPercentage,
  marginBasisPoints,
  PriceRounding,
  PriceTarget,
  roundUpTo,
} from './pricing';

describe('pricing', () => {
  it('aplica aumentos y descuentos porcentuales', () => {
    expect(applyPercentage(100_000n, 1_250n, PriceRounding.NONE)).toBe(112_500n);
    expect(applyPercentage(100_000n, -1_000n, PriceRounding.NONE)).toBe(90_000n);
    expect(() => applyPercentage(100_000n, -10_000n, PriceRounding.NONE)).toThrow(RangeError);
  });

  it('redondea hacia arriba al múltiplo pedido', () => {
    expect(roundUpTo(123_401n, PriceRounding.UNIT)).toBe(123_500n);
    expect(roundUpTo(123_401n, PriceRounding.TEN)).toBe(124_000n);
    expect(roundUpTo(123_401n, PriceRounding.HUNDRED)).toBe(130_000n);
    expect(roundUpTo(130_000n, PriceRounding.HUNDRED)).toBe(130_000n);
  });

  it('calcula el margen sobre el costo', () => {
    expect(marginBasisPoints(10_000n, 13_000n)).toBe(3_000n);
    expect(marginBasisPoints(0n, 13_000n)).toBe(null);
    expect(marginBasisPoints(10_000n, 9_000n)).toBe(0n);
  });

  it('ajusta precio de venta y recalcula margen', () => {
    const result = adjustPrices(
      { costCents: 10_000n, sellingCents: 13_000n, marginBp: 3_000n },
      PriceTarget.SELLING_PRICE,
      1_000n,
      PriceRounding.NONE,
    );
    expect(result.sellingCents).toBe(14_300n);
    expect(result.marginBp).toBe(4_300n);
  });

  it('nueva lista de proveedor: sube el costo y mantiene el margen', () => {
    const result = adjustPrices(
      { costCents: 10_000n, sellingCents: 13_000n, marginBp: 3_000n },
      PriceTarget.COST_KEEP_MARGIN,
      2_000n,
      PriceRounding.UNIT,
    );
    expect(result.costCents).toBe(12_000n);
    expect(result.sellingCents).toBe(15_600n);
    expect(result.marginBp).toBe(3_000n);
  });

  it('solo costo: el precio queda igual y baja el margen', () => {
    const result = adjustPrices(
      { costCents: 10_000n, sellingCents: 13_000n, marginBp: 3_000n },
      PriceTarget.COST_ONLY,
      1_000n,
      PriceRounding.NONE,
    );
    expect(result.sellingCents).toBe(13_000n);
    expect(result.marginBp).toBe(1_818n);
  });
});
