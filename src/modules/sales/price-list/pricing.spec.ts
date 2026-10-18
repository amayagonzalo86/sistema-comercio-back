import { BadRequestException } from '@nestjs/common';
import { PriceListPaymentCondition } from './entities/price-list.entity';
import { applyPriceList, assertPaymentCondition, ResolvedPriceList } from './pricing';

const list = (percentage: number, paymentCondition = PriceListPaymentCondition.ANY, overrides: Array<[string, number]> = []): ResolvedPriceList => ({
  id: 'list',
  name: 'Lista',
  percentage: percentage.toFixed(2),
  percentageBasisPoints: BigInt(Math.round(percentage * 100)),
  paymentCondition,
  isDefault: false,
  cashMethods: ['CASH'],
  overrides: new Map(overrides.map(([productId, value]) => [productId, BigInt(Math.round(value * 100))])),
});

describe('listas de precios', () => {
  it('Ventas en efectivo: 5 % de descuento', () => {
    expect(applyPriceList(100_000n, list(-5), 'p')).toBe(95_000n);
  });

  it('Precio de lista: sin cambios', () => {
    expect(applyPriceList(123_456n, list(0), 'p')).toBe(123_456n);
  });

  it('Lista gobierno: 300 % de recargo (precio × 4)', () => {
    expect(applyPriceList(100_000n, list(300), 'p')).toBe(400_000n);
  });

  it('redondea al centavo', () => {
    expect(applyPriceList(999n, list(-5), 'p')).toBe(949n); // 9,99 × 0,95 = 9,4905 → 9,49
    expect(applyPriceList(1_001n, list(10.5), 'p')).toBe(1_106n); // 10,01 × 1,105 = 11,061 → 11,06
  });

  it('un producto puede tener su propio porcentaje dentro de la lista', () => {
    const withOverride = list(300, PriceListPaymentCondition.ANY, [['especial', 50]]);
    expect(applyPriceList(100_000n, withOverride, 'especial')).toBe(150_000n);
    expect(applyPriceList(100_000n, withOverride, 'otro')).toBe(400_000n);
  });

  it('sin lista se usa el precio de la sucursal', () => {
    expect(applyPriceList(50_000n, null, 'p')).toBe(50_000n);
  });

  it('una lista solo efectivo rechaza otros medios de pago', () => {
    const cash = list(-5, PriceListPaymentCondition.CASH_ONLY);
    expect(() => assertPaymentCondition(cash, [{ method: 'CASH' }])).not.toThrow();
    expect(() => assertPaymentCondition(cash, [{ method: 'CASH' }, { method: 'DEBIT_CARD' }])).toThrow(BadRequestException);
    expect(() => assertPaymentCondition(list(0), [{ method: 'CREDIT_CARD' }])).not.toThrow();
  });
});
