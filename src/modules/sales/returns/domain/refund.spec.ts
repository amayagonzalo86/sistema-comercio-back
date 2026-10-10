import { refundForLine, totalOf } from './refund';

const original = { net: 10_000n, vat: 2_100n, exempt: 0n, notTaxed: 0n }; // 3 unidades por $121
const zero = { net: 0n, vat: 0n, exempt: 0n, notTaxed: 0n };

describe('refundForLine', () => {
  it('reintegra en proporción a la cantidad devuelta', () => {
    const refund = refundForLine({ soldMilli: 3_000n, returnedMilli: 0n, original, refunded: zero }, 1_000n);
    expect(refund.net).toBe(3_333n);
    expect(refund.vat).toBe(700n);
  });

  it('la última devolución cierra exacto contra lo cobrado', () => {
    const first = refundForLine({ soldMilli: 3_000n, returnedMilli: 0n, original, refunded: zero }, 1_000n);
    const second = refundForLine({ soldMilli: 3_000n, returnedMilli: 1_000n, original, refunded: first }, 1_000n);
    const accumulated = {
      net: first.net + second.net,
      vat: first.vat + second.vat,
      exempt: 0n,
      notTaxed: 0n,
    };
    const last = refundForLine({ soldMilli: 3_000n, returnedMilli: 2_000n, original, refunded: accumulated }, 1_000n);
    expect(totalOf(first) + totalOf(second) + totalOf(last)).toBe(totalOf(original));
  });

  it('no permite devolver más de lo vendido', () => {
    expect(() => refundForLine({ soldMilli: 3_000n, returnedMilli: 2_500n, original, refunded: zero }, 1_000n)).toThrow(RangeError);
    expect(() => refundForLine({ soldMilli: 3_000n, returnedMilli: 0n, original, refunded: zero }, 0n)).toThrow(RangeError);
  });
});
