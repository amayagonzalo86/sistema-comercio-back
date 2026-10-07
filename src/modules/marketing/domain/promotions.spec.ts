import { bestPromotion, discountFor, PromotionType, ruleApplies } from './promotions';

const line = {
  productId: 'p1',
  category: 'Bebidas',
  brand: 'Marca',
  branchId: 'b1',
  quantityMilli: 3_000n,
  unitPriceCents: 10_000n,
};

describe('promotions', () => {
  it('aplica descuento porcentual', () => {
    expect(discountFor({ id: 'a', name: '10%', type: PromotionType.PERCENTAGE, percentBasisPoints: 1_000 }, line)).toBe(3_000n);
  });

  it('aplica 3x2 por grupos completos', () => {
    const rule = { id: 'b', name: '3x2', type: PromotionType.BUY_X_PAY_Y, buyQuantity: 3, payQuantity: 2 };
    expect(discountFor(rule, line)).toBe(10_000n);
    expect(discountFor(rule, { ...line, quantityMilli: 5_000n })).toBe(10_000n);
    expect(discountFor(rule, { ...line, quantityMilli: 6_000n })).toBe(20_000n);
    expect(discountFor(rule, { ...line, quantityMilli: 2_000n })).toBe(0n);
  });

  it('respeta categoría, sucursal, día y cantidad mínima', () => {
    const base = { id: 'c', name: 'x', type: PromotionType.PERCENTAGE, percentBasisPoints: 500 };
    expect(ruleApplies({ ...base, categories: ['Lácteos'] }, line, 1)).toBe(false);
    expect(ruleApplies({ ...base, branchIds: ['b2'] }, line, 1)).toBe(false);
    expect(ruleApplies({ ...base, weekdays: [3] }, line, 1)).toBe(false);
    expect(ruleApplies({ ...base, weekdays: [3] }, line, 3)).toBe(true);
    expect(ruleApplies({ ...base, minQuantityMilli: 6_000n }, line, 1)).toBe(false);
  });

  it('elige la mejor promoción sin acumular', () => {
    const best = bestPromotion(
      [
        { id: 'a', name: '10%', type: PromotionType.PERCENTAGE, percentBasisPoints: 1_000 },
        { id: 'b', name: '3x2', type: PromotionType.BUY_X_PAY_Y, buyQuantity: 3, payQuantity: 2 },
      ],
      line,
      1,
    );
    expect(best?.promotionId).toBe('b');
    expect(best?.discountCents).toBe(10_000n);
  });

  it('nunca descuenta más que el importe de la línea', () => {
    expect(discountFor({ id: 'd', name: 'x', type: PromotionType.PERCENTAGE, percentBasisPoints: 20_000 }, line)).toBe(30_000n);
    expect(bestPromotion([], line, 1)).toBe(null);
  });
});
