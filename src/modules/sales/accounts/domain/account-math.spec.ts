import { addDays, agingOf, creditProblem, daysBetween, lateInterestCents, OpenDebit, planAllocation } from './account-math';

const debit = (id: string, pendingCents: bigint, dueDate: string | null, minute = 0): OpenDebit => ({
  id,
  pendingCents,
  dueDate,
  createdAt: new Date(Date.UTC(2026, 9, 1, 10, minute)),
});

describe('cuenta corriente: cálculos', () => {
  it('imputa de lo que vence antes a lo que vence después y deja el sobrante a favor', () => {
    const debits = [debit('b', 50_000n, '2026-11-10'), debit('a', 30_000n, '2026-10-20'), debit('c', 20_000n, null)];
    expect(planAllocation(60_000n, debits)).toEqual({
      items: [
        { debitId: 'a', amountCents: 30_000n },
        { debitId: 'b', amountCents: 30_000n },
      ],
      unappliedCents: 0n,
    });
    expect(planAllocation(120_000n, debits).unappliedCents).toBe(20_000n);
  });

  it('respeta la imputación elegida y la valida', () => {
    const debits = [debit('a', 30_000n, '2026-10-20'), debit('b', 50_000n, '2026-11-10')];
    expect(planAllocation(50_000n, debits, [{ debitId: 'b', amountCents: 40_000n }])).toEqual({
      items: [{ debitId: 'b', amountCents: 40_000n }],
      unappliedCents: 10_000n,
    });
    expect(() => planAllocation(50_000n, debits, [{ debitId: 'a', amountCents: 40_000n }])).toThrow('saldo pendiente');
    expect(() => planAllocation(10_000n, debits, [{ debitId: 'b', amountCents: 20_000n }])).toThrow('total cobrado');
    expect(() => planAllocation(10_000n, debits, [{ debitId: 'x', amountCents: 1_000n }])).toThrow('no está pendiente');
  });

  it('calcula la antigüedad de la deuda', () => {
    const aging = agingOf(
      [debit('a', 10_000n, '2026-10-29'), debit('b', 20_000n, '2026-10-10'), debit('c', 30_000n, '2026-09-10'), debit('d', 40_000n, '2026-08-20'), debit('e', 50_000n, '2026-06-01')],
      '2026-10-29',
    );
    expect(aging).toEqual({ currentCents: 10_000n, days1to30Cents: 20_000n, days31to60Cents: 30_000n, days61to90Cents: 40_000n, over90Cents: 50_000n, overdueCents: 140_000n });
  });

  it('interés por mora simple, prorrateado por día', () => {
    expect(lateInterestCents(10_000_000n, 5, 45)).toBe(750_000n); // $100.000 al 5 % mensual, 45 días = $7.500
    expect(lateInterestCents(80_000n, 5, 45)).toBe(6_000n);
    expect(lateInterestCents(80_000n, 0, 45)).toBe(0n);
    expect(lateInterestCents(80_000n, 5, 0)).toBe(0n);
  });

  it('fechas', () => {
    expect(addDays('2026-10-29', 30)).toBe('2026-11-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-01', '2026-10-29')).toBe(28);
  });

  it('regla de crédito: límite y deuda vencida', () => {
    const format = (cents: bigint) => `$ ${cents}`;
    expect(creditProblem({ balanceCents: 100_000n, amountCents: 50_000n, limitCents: 200_000n, overdueCents: 0n, format })).toBeNull();
    expect(creditProblem({ balanceCents: 180_000n, amountCents: 50_000n, limitCents: 200_000n, overdueCents: 0n, format })).toContain('disponible $ 20000');
    expect(creditProblem({ balanceCents: 0n, amountCents: 50_000n, limitCents: null, overdueCents: 1n, format })).toContain('deuda vencida');
    expect(creditProblem({ balanceCents: 9_000_000n, amountCents: 50_000n, limitCents: null, overdueCents: 0n, format })).toBeNull();
  });
});
