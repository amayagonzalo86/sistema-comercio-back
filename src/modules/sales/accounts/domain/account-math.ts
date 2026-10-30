/**
 * Cálculos de cuenta corriente sin base de datos (todo en centavos, bigint):
 * imputación de pagos, antigüedad de la deuda e interés por mora.
 */

export interface OpenDebit {
  id: string;
  /** Saldo pendiente del débito. */
  pendingCents: bigint;
  /** Vencimiento AAAA-MM-DD (null = sin vencimiento: se imputa al final). */
  dueDate: string | null;
  createdAt: Date;
}

export interface AllocationPlanItem {
  debitId: string;
  amountCents: bigint;
}

/** Orden de imputación automática: primero lo que vence antes; a igual vencimiento, lo más viejo. */
export function oldestFirst(a: OpenDebit, b: OpenDebit): number {
  const dueA = a.dueDate ?? '9999-12-31';
  const dueB = b.dueDate ?? '9999-12-31';
  if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Imputa un importe a los débitos abiertos.
 * - Con `requested` (elegido por el cajero) se respeta cada importe; tiene que existir el débito y no superar su saldo.
 * - Sin `requested`, de lo más viejo a lo más nuevo.
 * Lo que sobra queda como saldo a favor (no imputado).
 */
export function planAllocation(
  availableCents: bigint,
  debits: OpenDebit[],
  requested?: AllocationPlanItem[] | null,
): { items: AllocationPlanItem[]; unappliedCents: bigint } {
  if (availableCents < 0n) throw new RangeError('El importe a imputar no puede ser negativo.');
  const byId = new Map(debits.map((debit) => [debit.id, debit]));
  const items: AllocationPlanItem[] = [];
  let remaining = availableCents;
  if (requested && requested.length > 0) {
    const seen = new Set<string>();
    for (const item of requested) {
      if (item.amountCents <= 0n) continue;
      const debit = byId.get(item.debitId);
      if (!debit || seen.has(item.debitId)) throw new RangeError('Una de las facturas elegidas no está pendiente en la cuenta del cliente.');
      if (item.amountCents > debit.pendingCents) throw new RangeError('El importe imputado supera el saldo pendiente de la factura.');
      if (item.amountCents > remaining) throw new RangeError('Lo imputado a facturas supera el total cobrado.');
      seen.add(item.debitId);
      items.push({ debitId: item.debitId, amountCents: item.amountCents });
      remaining -= item.amountCents;
    }
    return { items, unappliedCents: remaining };
  }
  for (const debit of [...debits].sort(oldestFirst)) {
    if (remaining === 0n) break;
    if (debit.pendingCents <= 0n) continue;
    const amountCents = debit.pendingCents < remaining ? debit.pendingCents : remaining;
    items.push({ debitId: debit.id, amountCents });
    remaining -= amountCents;
  }
  return { items, unappliedCents: remaining };
}

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** AAAA-MM-DD + días. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export interface Aging {
  /** Sin vencer. */
  currentCents: bigint;
  days1to30Cents: bigint;
  days31to60Cents: bigint;
  days61to90Cents: bigint;
  over90Cents: bigint;
  overdueCents: bigint;
}

/** Antigüedad de la deuda por días de atraso al día `today`. */
export function agingOf(debits: OpenDebit[], today: string): Aging {
  const aging: Aging = { currentCents: 0n, days1to30Cents: 0n, days31to60Cents: 0n, days61to90Cents: 0n, over90Cents: 0n, overdueCents: 0n };
  for (const debit of debits) {
    if (debit.pendingCents <= 0n) continue;
    const late = debit.dueDate ? daysBetween(debit.dueDate, today) : 0;
    if (late <= 0) aging.currentCents += debit.pendingCents;
    else {
      aging.overdueCents += debit.pendingCents;
      if (late <= 30) aging.days1to30Cents += debit.pendingCents;
      else if (late <= 60) aging.days31to60Cents += debit.pendingCents;
      else if (late <= 90) aging.days61to90Cents += debit.pendingCents;
      else aging.over90Cents += debit.pendingCents;
    }
  }
  return aging;
}

/**
 * Interés por mora simple: saldo × tasa mensual × días de atraso ÷ 30, redondeado al centavo.
 * Ej.: $100.000 al 5 % mensual con 45 días de atraso = $7.500.
 */
export function lateInterestCents(pendingCents: bigint, monthlyRatePercent: number, daysLate: number): bigint {
  if (pendingCents <= 0n || daysLate <= 0 || !(monthlyRatePercent > 0)) return 0n;
  const rateBasisPoints = BigInt(Math.round(monthlyRatePercent * 100));
  const numerator = pendingCents * rateBasisPoints * BigInt(daysLate);
  const denominator = 10_000n * 30n;
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Regla de crédito para vender a cuenta: dentro del límite y sin deuda vencida.
 * Devuelve el motivo por el que hace falta autorización, o null si se puede vender.
 */
export function creditProblem(input: {
  balanceCents: bigint;
  amountCents: bigint;
  limitCents: bigint | null;
  overdueCents: bigint;
  format: (cents: bigint) => string;
}): string | null {
  if (input.overdueCents > 0n) return `El cliente tiene deuda vencida por ${input.format(input.overdueCents)}.`;
  if (input.limitCents !== null && input.balanceCents + input.amountCents > input.limitCents) {
    const available = input.limitCents - input.balanceCents;
    return `La venta supera el límite de crédito: disponible ${input.format(available > 0n ? available : 0n)}.`;
  }
  return null;
}
