import { EntityManager } from 'typeorm';
import { CashMovementDirection, CashMovementType } from './entities/cash-movement.entity';
import { CashReportBreakdown, CashReportDocument, CashReportSummary, CashReportType } from './entities/cash-session-report.entity';
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
  const [salesRows, paymentRows, voucherRows, refundRows, movementRows, xRows, documentRows, invoicedRows] = await Promise.all([
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
    // Comprobantes autorizados de las ventas y devoluciones de esta caja, por tipo y punto de venta.
    manager.query(
      `SELECT f.voucher_type AS voucherType, f.point_of_sale AS pointOfSale, COUNT(*) AS count,
              MIN(f.number) AS fromNumber, MAX(f.number) AS toNumber, COALESCE(SUM(f.total), 0) AS total
         FROM fiscal_documents f
        WHERE f.tenant_id = ? AND f.status = 'AUTHORIZED' AND f.number IS NOT NULL AND (
              (f.source_type = 'SALE' AND f.source_id IN (SELECT s.id FROM sales s WHERE s.tenant_id = f.tenant_id AND s.cash_session_id = ?))
           OR (f.source_type = 'SALE_RETURN' AND f.source_id IN (SELECT r.id FROM sale_returns r WHERE r.tenant_id = f.tenant_id AND r.cash_session_id = ?))
           OR (f.source_type = 'SALE_ADJUSTMENT' AND f.source_id IN (SELECT a.id FROM sale_adjustments a WHERE a.tenant_id = f.tenant_id AND a.cash_session_id = ?)))
        GROUP BY f.voucher_type, f.point_of_sale
        ORDER BY f.voucher_type, f.point_of_sale`,
      [session.tenantId, session.id, session.id, session.id],
    ) as Promise<Row[]>,
    manager.query(
      `SELECT COUNT(DISTINCT f.source_id) AS count FROM fiscal_documents f
        WHERE f.tenant_id = ? AND f.source_type = 'SALE' AND f.status = 'AUTHORIZED'
          AND f.source_id IN (SELECT s.id FROM sales s WHERE s.tenant_id = f.tenant_id AND s.cash_session_id = ?)`,
      params,
    ) as Promise<Row[]>,
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
    tickets: {
      sales: Number(sales.count ?? 0),
      invoiced: Number(invoicedRows[0]?.count ?? 0),
      notInvoiced: Math.max(0, Number(sales.count ?? 0) - Number(invoicedRows[0]?.count ?? 0)),
    },
    documents: documentRows.map(
      (row): CashReportDocument => ({
        voucherType: Number(row.voucherType),
        pointOfSale: Number(row.pointOfSale),
        count: Number(row.count),
        from: Number(row.fromNumber),
        to: Number(row.toNumber),
        total: centsText(decimalCents(row.total as string)),
      }),
    ),
  };
}

/** Producto vendido en la caja (cantidades netas de lo cobrado). */
export interface CashDetailProduct {
  productId: string;
  sku: string;
  name: string;
  quantity: string;
  discount: string;
  total: string;
}

/** Venta cobrada en la caja. */
export interface CashDetailSale {
  id: string;
  createdAt: string;
  voucherClass: string | null;
  /** Número de factura autorizada ("00003-00001287"), si se emitió. */
  invoiceNumber: string | null;
  customerName: string | null;
  payments: string[];
  total: string;
}

export interface CashSessionSalesDetail {
  until: string;
  products: CashDetailProduct[];
  sales: CashDetailSale[];
  /** true si la caja tuvo más ventas que las listadas. */
  truncated: boolean;
}

const MAX_DETAIL_SALES = 1000;

/**
 * Detalle de lo cobrado en una caja hasta un momento (cierre X: hasta ese X; Z o en vivo: hasta el cierre/ahora):
 * productos vendidos agrupados y la lista de ventas con comprobante, cliente y medios de pago.
 */
export async function buildCashSalesDetail(manager: EntityManager, tenantId: string, sessionId: string, until: Date): Promise<CashSessionSalesDetail> {
  const params = [tenantId, sessionId, until];
  const [productRows, saleRows] = await Promise.all([
    manager.query(
      `SELECT i.product_id AS productId, MAX(i.sku_snapshot) AS sku, MAX(i.name_snapshot) AS name,
              COALESCE(SUM(i.quantity), 0) AS quantity, COALESCE(SUM(i.discount_amount), 0) AS discount, COALESCE(SUM(i.total), 0) AS total
         FROM sale_items i JOIN sales s ON s.id = i.sale_id
        WHERE s.tenant_id = ? AND s.cash_session_id = ? AND s.created_at <= ?
        GROUP BY i.product_id
        ORDER BY total DESC, name ASC`,
      params,
    ) as Promise<Row[]>,
    manager.query(
      `SELECT s.id, DATE_FORMAT(s.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt, s.voucher_class AS voucherClass, s.total,
              TRIM(CONCAT_WS(' ', p.first_name, NULLIF(p.last_name, '-'))) AS customerName,
              (SELECT GROUP_CONCAT(DISTINCT sp.method ORDER BY sp.method SEPARATOR ',') FROM sale_payments sp WHERE sp.sale_id = s.id) AS payments,
              (SELECT CONCAT(LPAD(f.point_of_sale, 5, '0'), '-', LPAD(f.number, 8, '0')) FROM fiscal_documents f
                WHERE f.tenant_id = s.tenant_id AND f.source_type = 'SALE' AND f.source_id = s.id AND f.status = 'AUTHORIZED' AND f.number IS NOT NULL
                ORDER BY f.created_at DESC LIMIT 1) AS invoiceNumber
         FROM sales s LEFT JOIN persons p ON p.id = s.customer_person_id AND p.tenant_id = s.tenant_id
        WHERE s.tenant_id = ? AND s.cash_session_id = ? AND s.created_at <= ?
        ORDER BY s.created_at ASC, s.id ASC
        LIMIT ${MAX_DETAIL_SALES + 1}`,
      params,
    ) as Promise<Row[]>,
  ]);
  return {
    until: until.toISOString(),
    products: productRows.map((row) => ({
      productId: String(row.productId),
      sku: String(row.sku ?? ''),
      name: String(row.name ?? ''),
      quantity: Number(row.quantity ?? 0).toFixed(3),
      discount: centsText(decimalCents(row.discount as string)),
      total: centsText(decimalCents(row.total as string)),
    })),
    sales: saleRows.slice(0, MAX_DETAIL_SALES).map((row) => ({
      id: String(row.id),
      createdAt: String(row.createdAt),
      voucherClass: row.voucherClass ? String(row.voucherClass) : null,
      invoiceNumber: row.invoiceNumber ? String(row.invoiceNumber) : null,
      customerName: row.customerName ? String(row.customerName) : null,
      payments: row.payments ? String(row.payments).split(',') : [],
      total: centsText(decimalCents(row.total as string)),
    })),
    truncated: saleRows.length > MAX_DETAIL_SALES,
  };
}
