import { EntityManager } from 'typeorm';
import { CashMovementDirection, CashMovementType } from './entities/cash-movement.entity';
import { CashReportBreakdown, CashReportSummary, CashReportType } from './entities/cash-session-report.entity';
import { CashSessionEntity } from './entities/cash-session.entity';

/** Centavos a partir de un decimal de MySQL ("1234.50", "-3.00" o null). */
export function decimalCents(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  const text = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const cents = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

export function centsText(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

type Row = Record<string, string | number | null>;

/**
 * Resumen de una sesión de caja: ventas cobradas en esa caja (todos los medios de pago), devoluciones,
 * movimientos de efectivo y efectivo esperado. Es la base del cierre X (parcial) y del Z (definitivo).
 */
export async function buildCashSummary(manager: EntityManager, session: CashSessionEntity, until: Date): Promise<CashReportSummary> {
  const params = [session.tenantId, session.id];
  const [salesRows, paymentRows, voucherRows, refundRows, movementRows, xRows] = await Promise.all([
    manager.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(discount_total), 0) AS discounts, COALESCE(SUM(tax_total), 0) AS tax
         FROM sales WHERE tenant_id = ? AND cash_session_id = ?`,
      params,
    ) as Promise<Row[]>,
    manager.query(
      `SELECT p.method AS \`key\`, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS amount
         FROM sale_payments p JOIN sales s ON s.id = p.sale_id
        WHERE s.tenant_id = ? AND s.cash_session_id = ?
        GROUP BY p.method ORDER BY amount DESC`,
      params,
    ) as Promise<Row[]>,
    manager.query(
      `SELECT COALESCE(voucher_class, '-') AS \`key\`, COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
         FROM sales WHERE tenant_id = ? AND cash_session_id = ?
        GROUP BY voucher_class ORDER BY \`key\``,
      params,
    ) as Promise<Row[]>,
    manager.query('SELECT COUNT(*) AS count FROM sale_returns WHERE tenant_id = ? AND cash_session_id = ?', params) as Promise<Row[]>,
    manager.query(
      `SELECT type, direction, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
         FROM cash_movements WHERE tenant_id = ? AND cash_session_id = ?
        GROUP BY type, direction`,
      params,
    ) as Promise<Row[]>,
    manager.query(`SELECT COUNT(*) AS count FROM cash_session_reports WHERE tenant_id = ? AND cash_session_id = ? AND type = ?`, [
      ...params,
      CashReportType.X,
    ]) as Promise<Row[]>,
  ]);

  const movement = (type: CashMovementType, direction: CashMovementDirection) =>
    movementRows
      .filter((row) => row.type === type && row.direction === direction)
      .reduce((sum, row) => sum + decimalCents(row.amount as string), 0n);
  const breakdown = (rows: Row[]): CashReportBreakdown[] =>
    rows.map((row) => ({ key: String(row.key), count: Number(row.count), amount: centsText(decimalCents(row.amount as string)) }));
  const sales = salesRows[0] ?? {};
  const refundsCash = movement(CashMovementType.REFUND, CashMovementDirection.OUT);

  return {
    from: new Date(session.openedAt).toISOString(),
    to: until.toISOString(),
    currency: session.currency,
    openingAmount: centsText(decimalCents(session.openingAmount)),
    sales: {
      count: Number(sales.count ?? 0),
      total: centsText(decimalCents(sales.total as string)),
      discounts: centsText(decimalCents(sales.discounts as string)),
      tax: centsText(decimalCents(sales.tax as string)),
    },
    payments: breakdown(paymentRows),
    vouchers: breakdown(voucherRows),
    refunds: { count: Number(refundRows[0]?.count ?? 0), cash: centsText(refundsCash) },
    movements: {
      sales: centsText(movement(CashMovementType.SALE, CashMovementDirection.IN)),
      refunds: centsText(refundsCash),
      incomes: centsText(movement(CashMovementType.INCOME, CashMovementDirection.IN)),
      expenses: centsText(movement(CashMovementType.EXPENSE, CashMovementDirection.OUT)),
      adjustmentsIn: centsText(movement(CashMovementType.ADJUSTMENT, CashMovementDirection.IN)),
      adjustmentsOut: centsText(movement(CashMovementType.ADJUSTMENT, CashMovementDirection.OUT)),
      count: movementRows.reduce((sum, row) => sum + Number(row.count), 0),
    },
    expectedCash: centsText(decimalCents(session.expectedAmount)),
    previousX: Number(xRows[0]?.count ?? 0),
  };
}
