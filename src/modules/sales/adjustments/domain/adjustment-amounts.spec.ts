import { adjustmentAmounts } from './adjustment-amounts';

describe('notas por importe', () => {
  it('discrimina el IVA del importe final', () => {
    expect(adjustmentAmounts(121_000n, 21, 'TAXED')).toEqual({ netCents: 100_000n, vatCents: 21_000n, exemptCents: 0n, totalCents: 121_000n, rateBasisPoints: 2_100n, arcaVatRateId: 5 });
    expect(adjustmentAmounts(110_50n, 10.5, 'TAXED')).toMatchObject({ netCents: 100_00n, vatCents: 10_50n, arcaVatRateId: 4 });
  });

  it('venta sin IVA o alícuota 0 % va como exento; clase C, todo neto', () => {
    expect(adjustmentAmounts(50_000n, 21, 'EXEMPT')).toMatchObject({ exemptCents: 50_000n, vatCents: 0n, arcaVatRateId: null });
    expect(adjustmentAmounts(50_000n, 0, 'TAXED')).toMatchObject({ exemptCents: 50_000n, netCents: 0n });
    expect(adjustmentAmounts(50_000n, 21, 'NET_ONLY')).toMatchObject({ netCents: 50_000n, vatCents: 0n, exemptCents: 0n });
  });

  it('rechaza importes no positivos y alícuotas inexistentes', () => {
    expect(() => adjustmentAmounts(0n, 21, 'TAXED')).toThrow(RangeError);
    expect(() => adjustmentAmounts(100n, 19, 'TAXED')).toThrow(RangeError);
  });
});
