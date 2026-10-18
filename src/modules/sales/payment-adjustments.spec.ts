import { BadRequestException } from '@nestjs/common';
import { VatLineResult } from '../fiscal/vat/vat';
import { distributeLineTotals, settlePayments, vatForTotal } from './payment-adjustments';
import { cardPlanLabel, isPlanAvailable, parseWeekdays, serializeWeekdays } from './card-plans/card-plan-rules';

describe('payment adjustments', () => {
  it('applies the cash list to the whole sale when everything is paid in cash', () => {
    const result = settlePayments(100_000n, 95_000n, [{ amountCents: 95_000n, kind: 'CASH_LIST', surchargeBasisPoints: 0n }]);
    expect(result).toMatchObject({ adjusted: true, totalCents: 95_000n, adjustmentTotalCents: -5_000n });
    expect(result.coveredCents).toEqual([100_000n]);
  });

  it('gives the cash discount only on the half paid in cash', () => {
    // $1000 de lista: $500 de la venta en efectivo (se cobra $475) y $500 con tarjeta sin interés.
    const payments = [
      { amountCents: 47_500n, kind: 'CASH_LIST' as const, surchargeBasisPoints: 0n },
      { amountCents: 50_000n, kind: 'PLAN' as const, surchargeBasisPoints: 0n },
    ];
    const result = settlePayments(100_000n, 95_000n, payments);
    expect(result.totalCents).toBe(97_500n);
    expect(result.adjustmentTotalCents).toBe(-2_500n);
    expect(result.payments[1].kind).toBe('NONE'); // sin interés = sin ajuste
    const lines = distributeLineTotals(
      [
        { baseTotalCents: 60_000n, cashTotalCents: 57_000n },
        { baseTotalCents: 40_000n, cashTotalCents: 38_000n },
      ],
      100_000n,
      95_000n,
      result.payments,
      result.totalCents,
    );
    expect(lines).toEqual([58_500n, 39_000n]);
  });

  it('rejects a cash amount that ignores the discount', () => {
    expect(() => settlePayments(100_000n, 95_000n, [{ amountCents: 100_000n, kind: 'CASH_LIST', surchargeBasisPoints: 0n }])).toThrow(BadRequestException);
  });

  it('keeps the exact-sum rule when no payment is adjusted', () => {
    expect(() => settlePayments(100_000n, null, [{ amountCents: 99_999n, kind: 'NONE', surchargeBasisPoints: 0n }])).toThrow(BadRequestException);
    expect(settlePayments(100_000n, null, [{ amountCents: 100_000n, kind: 'CASH_LIST', surchargeBasisPoints: 0n }]).adjusted).toBe(false);
  });

  it('adds the plan surcharge on the card part and spreads rounding cents exactly', () => {
    // $1000,01 con plan +15 % → $1150,01 (redondeo al centavo).
    const result = settlePayments(100_001n, null, [{ amountCents: 115_001n, kind: 'PLAN', surchargeBasisPoints: 1_500n }]);
    expect(result.adjustmentTotalCents).toBe(15_000n);
    const lines = distributeLineTotals(
      [
        { baseTotalCents: 33_334n, cashTotalCents: 33_334n },
        { baseTotalCents: 33_334n, cashTotalCents: 33_334n },
        { baseTotalCents: 33_333n, cashTotalCents: 33_333n },
      ],
      100_001n,
      null,
      result.payments,
      result.totalCents,
    );
    expect(lines.reduce((sum, value) => sum + value, 0n)).toBe(115_001n);
  });

  it('recomputes VAT from the final total', () => {
    const vat: VatLineResult = { netCents: 82_645n, vatCents: 17_355n, exemptCents: 0n, notTaxedCents: 0n, totalCents: 100_000n, appliedRateBasisPoints: 2_100n, arcaVatRateId: 5 };
    expect(vatForTotal(vat, vat, 115_000n)).toMatchObject({ netCents: 95_041n, vatCents: 19_959n, totalCents: 115_000n, arcaVatRateId: 5 });
    const exempt: VatLineResult = { netCents: 0n, vatCents: 0n, exemptCents: 1_000n, notTaxedCents: 0n, totalCents: 1_000n, appliedRateBasisPoints: 0n, arcaVatRateId: null };
    expect(vatForTotal(exempt, exempt, 950n)).toMatchObject({ exemptCents: 950n, netCents: 0n, totalCents: 950n });
  });
});

describe('card plan rules', () => {
  it('formats the plan for the cashier', () => {
    expect(cardPlanLabel({ name: 'Visa Banco de Tierra del Fuego', installments: 12, surchargePercentage: '0.00' })).toBe('Visa Banco de Tierra del Fuego · 12 cuotas sin interés');
    expect(cardPlanLabel({ name: 'Tarjeta TDF', installments: 1, surchargePercentage: '0.00' })).toBe('Tarjeta TDF · 1 pago sin interés');
    expect(cardPlanLabel({ name: 'Mastercard', installments: 6, surchargePercentage: '15.50' })).toBe('Mastercard · 6 cuotas +15,5 %');
  });

  it('limits plans to their weekdays and dates', () => {
    expect(parseWeekdays('4')).toEqual([4]);
    expect(serializeWeekdays([0, 1, 2, 3, 4, 5, 6])).toBeNull();
    const thursdays = { isActive: true, weekdays: '4', validFrom: null, validTo: null };
    expect(isPlanAvailable(thursdays, '2026-10-22', 4)).toBe(true);
    expect(isPlanAvailable(thursdays, '2026-10-21', 3)).toBe(false);
    expect(isPlanAvailable({ isActive: true, weekdays: null, validFrom: '2026-11-01', validTo: null }, '2026-10-22', 4)).toBe(false);
    expect(isPlanAvailable({ isActive: false, weekdays: null, validFrom: null, validTo: null }, '2026-10-22', 4)).toBe(false);
  });
});
