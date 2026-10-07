import { planReplenishment } from './replenishment';

const p = (branchId: string, stock: number, min: number, productId = 'prod-1') => ({
  productId,
  branchId,
  stockMilli: BigInt(stock * 1000),
  minMilli: BigInt(min * 1000),
});

describe('planReplenishment', () => {
  it('cubre faltantes con el excedente de otra sucursal', () => {
    const plan = planReplenishment([p('A', 2, 10), p('B', 50, 10)]);
    expect(plan.transfers.length).toBe(1);
    expect(plan.transfers[0].fromBranchId).toBe('B');
    expect(plan.transfers[0].toBranchId).toBe('A');
    expect(plan.transfers[0].quantityMilli).toBe(18_000n);
    expect(plan.purchases.length).toBe(0);
  });

  it('sugiere comprar lo que el excedente no cubre', () => {
    const plan = planReplenishment([p('A', 0, 10), p('B', 25, 10)]);
    expect(plan.transfers[0].quantityMilli).toBe(5_000n);
    expect(plan.purchases[0].quantityMilli).toBe(15_000n);
    expect(plan.purchases[0].branchId).toBe('A');
  });

  it('no toma stock de sucursales que también están en falta', () => {
    const plan = planReplenishment([p('A', 1, 10), p('B', 3, 10)]);
    expect(plan.transfers.length).toBe(0);
    expect(plan.purchases.length).toBe(2);
  });

  it('ignora productos sin mínimo configurado', () => {
    const plan = planReplenishment([p('A', 0, 0), p('B', 100, 0)]);
    expect(plan.transfers.length).toBe(0);
    expect(plan.purchases.length).toBe(0);
  });

  it('rechaza objetivos menores al mínimo', () => {
    expect(() => planReplenishment([], 50)).toThrow(RangeError);
  });
});
