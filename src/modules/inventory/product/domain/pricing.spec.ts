import {
  addAmount,
  adjustPrices,
  applyFreight,
  changeBasisPoints,
  totalCost,
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

  it('flete: el costo total incluye % y $ y el margen se calcula sobre él', () => {
    expect(totalCost(100_000n, 1_000n, 5_000n)).toBe(115_000n); // $1000 + 10 % + $50
    const result = applyFreight({ costCents: 100_000n, sellingCents: 150_000n, marginBp: 5_000n }, 1_000n, PriceRounding.NONE);
    expect(result.freightBp).toBe(1_000n);
    expect(result.marginBp).toBe(5_000n); // mantiene el 50 %
    expect(result.sellingCents).toBe(165_000n); // ($1000 + 10 %) × 1,5
  });

  it('cambiar el flete de 10 % a 0 % vuelve al precio original', () => {
    const withFreight = applyFreight({ costCents: 100_000n, sellingCents: 150_000n, marginBp: 5_000n }, 1_000n, PriceRounding.NONE);
    expect(applyFreight(withFreight, 0n, PriceRounding.NONE).sellingCents).toBe(150_000n);
  });

  it('aumento en pesos: suma al costo, mantiene el margen e informa el % equivalente', () => {
    const before = { costCents: 100_000n, sellingCents: 150_000n, marginBp: 5_000n };
    const result = addAmount(before, PriceTarget.COST_KEEP_MARGIN, 20_000n, PriceRounding.NONE);
    expect(result.costCents).toBe(120_000n);
    expect(result.sellingCents).toBe(180_000n);
    expect(changeBasisPoints(before.sellingCents, result.sellingCents)).toBe(2_000n); // +20 %
  });

  it('aumento en pesos sobre el precio de venta recalcula el margen', () => {
    const result = addAmount({ costCents: 100_000n, sellingCents: 150_000n, marginBp: 5_000n }, PriceTarget.SELLING_PRICE, 10_000n, PriceRounding.NONE);
    expect(result.sellingCents).toBe(160_000n);
    expect(result.marginBp).toBe(6_000n);
  });

  it('no permite precios en cero ni flete fuera de rango', () => {
    expect(() => addAmount({ costCents: 0n, sellingCents: 1_000n, marginBp: 0n }, PriceTarget.SELLING_PRICE, -1_000n, PriceRounding.NONE)).toThrow(RangeError);
    expect(() => applyFreight({ costCents: 1_000n, sellingCents: 2_000n, marginBp: 10_000n }, 40_000n, PriceRounding.NONE)).toThrow(RangeError);
  });
});
