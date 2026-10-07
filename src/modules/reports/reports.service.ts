import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantEntity } from '../platform/entities/tenant.entity';
import {
  buildPeriod,
  growthPercent,
  localToday,
  marginPercent,
  periodDays,
  previousPeriod,
  ReportPeriod,
} from './domain/period';
import { DeadStockQueryDto, ReportQueryDto, TopProductsQueryDto, TopProductsSort } from './dto/report-query.dto';

type Row = Record<string, string | number | null>;

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value: unknown): number => Math.round(num(value) * 100) / 100;
const qty = (value: unknown): number => Math.round(num(value) * 1000) / 1000;

export interface PeriodTotals {
  tickets: number;
  grossSales: number;
  refunds: number;
  netSales: number;
  vat: number;
  averageTicket: number;
  revenueWithoutVat: number;
  cost: number;
  grossMargin: number;
  marginPercent: number | null;
}

export interface DashboardResponse {
  period: { from: string; to: string; days: number };
  previousPeriod: { from: string; to: string };
  totals: PeriodTotals;
  previous: PeriodTotals;
  growth: { netSales: number | null; tickets: number | null; grossMargin: number | null };
  byBranch: Array<{ branchId: string; code: string; name: string; tickets: number; netSales: number; grossMargin: number; marginPercent: number | null }>;
  today: { tickets: number; netSales: number };
  operations: {
    openCashSessions: number;
    cashInRegisters: number;
    payablesOutstanding: number;
    payablesOverdue: number;
    lowStockItems: number;
    transfersInTransit: number;
    purchaseOrdersPending: number;
  };
}

/**
 * Reportes para el dueño: siempre filtrados por empresa y, si el usuario tiene sucursal asignada, por su sucursal.
 * Las devoluciones se descuentan en la fecha en que se registran.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}

  async dashboard(tenantId: string, query: ReportQueryDto, branchScope: string | null): Promise<DashboardResponse> {
    const { period, branchId, timeZone } = await this.context(tenantId, query, branchScope);
    const previous = previousPeriod(period);
    const today = buildPeriod(timeZone, localToday(timeZone), localToday(timeZone));

    const [totals, prev, todayTotals, byBranch, operations] = await Promise.all([
      this.periodTotals(tenantId, period, branchId),
      this.periodTotals(tenantId, previous, branchId),
      this.periodTotals(tenantId, today, branchId),
      this.branchBreakdown(tenantId, period, branchId),
      this.operations(tenantId, branchId, timeZone),
    ]);

    return {
      period: { from: period.from, to: period.to, days: period.days },
      previousPeriod: { from: previous.from, to: previous.to },
      totals,
      previous: prev,
      growth: {
        netSales: growthPercent(totals.netSales, prev.netSales),
        tickets: growthPercent(totals.tickets, prev.tickets),
        grossMargin: growthPercent(totals.grossMargin, prev.grossMargin),
      },
      byBranch,
      today: { tickets: todayTotals.tickets, netSales: todayTotals.netSales },
      operations,
    };
  }

  /** Serie diaria (días sin ventas en cero) para gráficos de evolución. */
  async salesByDay(tenantId: string, query: ReportQueryDto, branchScope: string | null) {
    const { period, branchId } = await this.context(tenantId, query, branchScope);
    const branchSql = branchId ? ' AND s.branch_id = ?' : '';
    const params = [period.offset, tenantId, period.startUtc, period.endUtc, ...(branchId ? [branchId] : [])];
    const [sales, returns] = await Promise.all([
      this.dataSource.query(
        `SELECT DATE(CONVERT_TZ(s.created_at, '+00:00', ?)) AS day, COUNT(*) AS tickets, COALESCE(SUM(s.total), 0) AS gross
           FROM sales s
          WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchSql}
          GROUP BY day`,
        params,
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT DATE(CONVERT_TZ(s.created_at, '+00:00', ?)) AS day, COALESCE(SUM(s.total), 0) AS refunds
           FROM sale_returns s
          WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchSql}
          GROUP BY day`,
        params,
      ) as Promise<Row[]>,
    ]);
    const key = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
    const salesByDay = new Map(sales.map((row) => [key(row.day), row]));
    const refundsByDay = new Map(returns.map((row) => [key(row.day), money(row.refunds)]));
    return {
      period: { from: period.from, to: period.to },
      series: periodDays(period).map((day) => {
        const gross = money(salesByDay.get(day)?.gross);
        const refunds = refundsByDay.get(day) ?? 0;
        return { day, tickets: num(salesByDay.get(day)?.tickets), grossSales: gross, refunds, netSales: money(gross - refunds) };
      }),
    };
  }

  /** Mapa de calor día de la semana × hora (para organizar personal y horarios). */
  async salesByHour(tenantId: string, query: ReportQueryDto, branchScope: string | null) {
    const { period, branchId } = await this.context(tenantId, query, branchScope);
    const rows = (await this.dataSource.query(
      `SELECT DAYOFWEEK(CONVERT_TZ(s.created_at, '+00:00', ?)) AS weekday,
              HOUR(CONVERT_TZ(s.created_at, '+00:00', ?)) AS hour,
              COUNT(*) AS tickets, COALESCE(SUM(s.total), 0) AS gross
         FROM sales s
        WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchId ? ' AND s.branch_id = ?' : ''}
        GROUP BY weekday, hour
        ORDER BY weekday, hour`,
      [period.offset, period.offset, tenantId, period.startUtc, period.endUtc, ...(branchId ? [branchId] : [])],
    )) as Row[];
    // DAYOFWEEK: 1 = domingo ... 7 = sábado.
    return {
      period: { from: period.from, to: period.to },
      cells: rows.map((row) => ({ weekday: num(row.weekday), hour: num(row.hour), tickets: num(row.tickets), grossSales: money(row.gross) })),
    };
  }

  /** Ranking de productos por facturación, unidades o margen (neto de devoluciones). */
  async topProducts(tenantId: string, query: TopProductsQueryDto, branchScope: string | null) {
    const { period, branchId } = await this.context(tenantId, query, branchScope);
    const branchSql = branchId ? ' AND s.branch_id = ?' : '';
    const params = [tenantId, period.startUtc, period.endUtc, ...(branchId ? [branchId] : [])];
    const [sold, returned] = await Promise.all([
      this.dataSource.query(
        `SELECT si.product_id AS productId, MAX(si.sku_snapshot) AS sku, MAX(si.name_snapshot) AS name,
                SUM(si.quantity) AS quantity, SUM(si.total) AS revenue,
                SUM(si.net_amount + si.exempt_amount + si.not_taxed_amount) AS revenueNet,
                SUM(si.unit_cost * si.quantity) AS cost
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id AND s.tenant_id = si.tenant_id
          WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchSql}
          GROUP BY si.product_id`,
        params,
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT ri.product_id AS productId, SUM(ri.quantity) AS quantity, SUM(ri.total) AS revenue,
                SUM(ri.net_amount + ri.exempt_amount + ri.not_taxed_amount) AS revenueNet,
                SUM(ri.unit_cost * ri.quantity) AS cost
           FROM sale_return_items ri
           JOIN sale_returns s ON s.id = ri.sale_return_id AND s.tenant_id = ri.tenant_id
          WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchSql}
          GROUP BY ri.product_id`,
        params,
      ) as Promise<Row[]>,
    ]);
    const returnsByProduct = new Map(returned.map((row) => [String(row.productId), row]));
    const items = sold.map((row) => {
      const back = returnsByProduct.get(String(row.productId));
      const quantity = qty(num(row.quantity) - num(back?.quantity));
      const revenue = money(num(row.revenue) - num(back?.revenue));
      const revenueNet = money(num(row.revenueNet) - num(back?.revenueNet));
      const cost = money(num(row.cost) - num(back?.cost));
      return {
        productId: String(row.productId),
        sku: String(row.sku ?? ''),
        name: String(row.name ?? ''),
        quantity,
        revenue,
        grossMargin: money(revenueNet - cost),
        marginPercent: marginPercent(revenueNet, cost),
      };
    });
    const sortKey: Record<TopProductsSort, (item: (typeof items)[number]) => number> = {
      [TopProductsSort.REVENUE]: (item) => item.revenue,
      [TopProductsSort.QUANTITY]: (item) => item.quantity,
      [TopProductsSort.MARGIN]: (item) => item.grossMargin,
    };
    const sorter = sortKey[query.sort];
    items.sort((a, b) => sorter(b) - sorter(a));
    const ranked = query.order === 'asc' ? items.reverse() : items;
    return { period: { from: period.from, to: period.to }, items: ranked.slice(0, query.limit) };
  }

  async salesByCategory(tenantId: string, query: ReportQueryDto, branchScope: string | null) {
    const { period, branchId } = await this.context(tenantId, query, branchScope);
    const rows = (await this.dataSource.query(
      `SELECT COALESCE(NULLIF(p.category, ''), 'Sin categoría') AS category,
              SUM(si.quantity) AS quantity, SUM(si.total) AS revenue,
              SUM(si.net_amount + si.exempt_amount + si.not_taxed_amount) AS revenueNet,
              SUM(si.unit_cost * si.quantity) AS cost
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id AND s.tenant_id = si.tenant_id
         JOIN products p ON p.id = si.product_id
        WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchId ? ' AND s.branch_id = ?' : ''}
        GROUP BY category
        ORDER BY revenue DESC`,
      [tenantId, period.startUtc, period.endUtc, ...(branchId ? [branchId] : [])],
    )) as Row[];
    return {
      period: { from: period.from, to: period.to },
      items: rows.map((row) => ({
        category: String(row.category),
        quantity: qty(row.quantity),
        revenue: money(row.revenue),
        grossMargin: money(num(row.revenueNet) - num(row.cost)),
        marginPercent: marginPercent(num(row.revenueNet), num(row.cost)),
      })),
    };
  }

  async salesByPaymentMethod(tenantId: string, query: ReportQueryDto, branchScope: string | null) {
    const { period, branchId } = await this.context(tenantId, query, branchScope);
    const rows = (await this.dataSource.query(
      `SELECT sp.method AS method, COUNT(DISTINCT sp.sale_id) AS tickets, SUM(sp.amount) AS amount
         FROM sale_payments sp
         JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
        WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchId ? ' AND s.branch_id = ?' : ''}
        GROUP BY sp.method
        ORDER BY amount DESC`,
      [tenantId, period.startUtc, period.endUtc, ...(branchId ? [branchId] : [])],
    )) as Row[];
    const total = rows.reduce((sum, row) => sum + num(row.amount), 0);
    return {
      period: { from: period.from, to: period.to },
      items: rows.map((row) => ({
        method: String(row.method),
        tickets: num(row.tickets),
        amount: money(row.amount),
        share: total > 0 ? Math.round((num(row.amount) / total) * 1000) / 10 : 0,
      })),
    };
  }

  /** Desempeño por vendedor/cajero (usuario que registró la venta). */
  async salesBySeller(tenantId: string, query: ReportQueryDto, branchScope: string | null) {
    const { period, branchId } = await this.context(tenantId, query, branchScope);
    const rows = (await this.dataSource.query(
      `SELECT s.actor_user_id AS userId, MAX(u.username) AS username,
              MAX(CONCAT_WS(' ', pe.first_name, pe.last_name)) AS fullName,
              COUNT(*) AS tickets, SUM(s.total) AS gross, SUM(s.refunded_total) AS refunds
         FROM sales s
         LEFT JOIN users u ON u.id = s.actor_user_id
         LEFT JOIN persons pe ON pe.id = u.person_id
        WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchId ? ' AND s.branch_id = ?' : ''}
        GROUP BY s.actor_user_id
        ORDER BY gross DESC`,
      [tenantId, period.startUtc, period.endUtc, ...(branchId ? [branchId] : [])],
    )) as Row[];
    return {
      period: { from: period.from, to: period.to },
      items: rows.map((row) => {
        const gross = money(row.gross);
        const tickets = num(row.tickets);
        return {
          userId: String(row.userId),
          username: row.username ? String(row.username) : null,
          fullName: row.fullName ? String(row.fullName) : null,
          tickets,
          grossSales: gross,
          refunds: money(row.refunds),
          averageTicket: tickets > 0 ? money(gross / tickets) : 0,
        };
      }),
    };
  }

  /** Valor del inventario por sucursal: a costo y a precio de venta. */
  async stockValuation(tenantId: string, query: ReportQueryDto, branchScope: string | null) {
    const branchId = this.scopedBranch(query.branchId, branchScope);
    const rows = (await this.dataSource.query(
      `SELECT b.id AS branchId, b.code AS code, b.name AS name,
              COUNT(pb.id) AS products,
              COALESCE(SUM(pb.stock), 0) AS units,
              COALESCE(SUM(pb.stock * pb.cost_price), 0) AS costValue,
              COALESCE(SUM(pb.stock * pb.selling_price), 0) AS retailValue
         FROM branches b
         LEFT JOIN product_branches pb ON pb.branch_id = b.id AND pb.tenant_id = b.tenant_id AND pb.is_active = 1 AND pb.stock > 0
        WHERE b.tenant_id = ? AND b.status = 1${branchId ? ' AND b.id = ?' : ''}
        GROUP BY b.id, b.code, b.name
        ORDER BY b.code`,
      [tenantId, ...(branchId ? [branchId] : [])],
    )) as Row[];
    const items = rows.map((row) => ({
      branchId: String(row.branchId),
      code: String(row.code),
      name: String(row.name),
      products: num(row.products),
      units: qty(row.units),
      costValue: money(row.costValue),
      retailValue: money(row.retailValue),
    }));
    return {
      items,
      totals: {
        units: qty(items.reduce((sum, item) => sum + item.units, 0)),
        costValue: money(items.reduce((sum, item) => sum + item.costValue, 0)),
        retailValue: money(items.reduce((sum, item) => sum + item.retailValue, 0)),
      },
    };
  }

  /** Mercadería sin ventas en los últimos N días (capital inmovilizado). */
  async deadStock(tenantId: string, query: DeadStockQueryDto, branchScope: string | null) {
    const branchId = this.scopedBranch(query.branchId, branchScope);
    const since = new Date(Date.now() - query.days * 86_400_000);
    const where = `pb.tenant_id = ? AND pb.is_active = 1 AND pb.stock > 0${branchId ? ' AND pb.branch_id = ?' : ''}
          AND NOT EXISTS (
            SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.tenant_id = pb.tenant_id AND s.branch_id = pb.branch_id AND si.product_id = pb.product_id AND s.created_at >= ?
          )`;
    // Orden de los "?" en el WHERE: empresa, sucursal (opcional) y fecha del subquery.
    const ordered = [tenantId, ...(branchId ? [branchId] : []), since];
    const [rows, count] = await Promise.all([
      this.dataSource.query(
        `SELECT pb.product_id AS productId, p.sku AS sku, p.name AS name, pb.branch_id AS branchId,
                pb.stock AS stock, pb.cost_price AS costPrice, (pb.stock * pb.cost_price) AS costValue
           FROM product_branches pb
           JOIN products p ON p.id = pb.product_id
          WHERE ${where}
          ORDER BY costValue DESC
          LIMIT ? OFFSET ?`,
        [...ordered, query.limit, (query.page - 1) * query.limit],
      ) as Promise<Row[]>,
      this.dataSource.query(`SELECT COUNT(*) AS total FROM product_branches pb WHERE ${where}`, ordered) as Promise<Row[]>,
    ]);
    const total = num(count[0]?.total);
    return {
      days: query.days,
      items: rows.map((row) => ({
        productId: String(row.productId),
        sku: String(row.sku),
        name: String(row.name),
        branchId: String(row.branchId),
        stock: qty(row.stock),
        costValue: money(row.costValue),
      })),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  private async periodTotals(tenantId: string, period: ReportPeriod, branchId: string | null): Promise<PeriodTotals> {
    const branchSql = branchId ? ' AND s.branch_id = ?' : '';
    const params = [tenantId, period.startUtc, period.endUtc, ...(branchId ? [branchId] : [])];
    const [salesRows, itemRows, returnRows, returnItemRows] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*) AS tickets, COALESCE(SUM(s.total), 0) AS gross, COALESCE(SUM(s.tax_total), 0) AS vat
           FROM sales s WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchSql}`,
        params,
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT COALESCE(SUM(si.net_amount + si.exempt_amount + si.not_taxed_amount), 0) AS revenueNet,
                COALESCE(SUM(si.unit_cost * si.quantity), 0) AS cost
           FROM sale_items si JOIN sales s ON s.id = si.sale_id AND s.tenant_id = si.tenant_id
          WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchSql}`,
        params,
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT COALESCE(SUM(s.total), 0) AS refunds, COALESCE(SUM(s.tax_total), 0) AS vat
           FROM sale_returns s WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchSql}`,
        params,
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT COALESCE(SUM(ri.net_amount + ri.exempt_amount + ri.not_taxed_amount), 0) AS revenueNet,
                COALESCE(SUM(ri.unit_cost * ri.quantity), 0) AS cost
           FROM sale_return_items ri JOIN sale_returns s ON s.id = ri.sale_return_id AND s.tenant_id = ri.tenant_id
          WHERE s.tenant_id = ? AND s.created_at >= ? AND s.created_at < ?${branchSql}`,
        params,
      ) as Promise<Row[]>,
    ]);
    const tickets = num(salesRows[0]?.tickets);
    const grossSales = money(salesRows[0]?.gross);
    const refunds = money(returnRows[0]?.refunds);
    const netSales = money(grossSales - refunds);
    const revenueWithoutVat = money(num(itemRows[0]?.revenueNet) - num(returnItemRows[0]?.revenueNet));
    const cost = money(num(itemRows[0]?.cost) - num(returnItemRows[0]?.cost));
    return {
      tickets,
      grossSales,
      refunds,
      netSales,
      vat: money(num(salesRows[0]?.vat) - num(returnRows[0]?.vat)),
      averageTicket: tickets > 0 ? money(grossSales / tickets) : 0,
      revenueWithoutVat,
      cost,
      grossMargin: money(revenueWithoutVat - cost),
      marginPercent: marginPercent(revenueWithoutVat, cost),
    };
  }

  private async branchBreakdown(tenantId: string, period: ReportPeriod, branchId: string | null) {
    const rows = (await this.dataSource.query(
      `SELECT b.id AS branchId, b.code AS code, b.name AS name,
              (SELECT COUNT(*) FROM sales s WHERE s.tenant_id = b.tenant_id AND s.branch_id = b.id AND s.created_at >= ? AND s.created_at < ?) AS tickets,
              (SELECT COALESCE(SUM(s.total), 0) FROM sales s WHERE s.tenant_id = b.tenant_id AND s.branch_id = b.id AND s.created_at >= ? AND s.created_at < ?) AS gross,
              (SELECT COALESCE(SUM(s.total), 0) FROM sale_returns s WHERE s.tenant_id = b.tenant_id AND s.branch_id = b.id AND s.created_at >= ? AND s.created_at < ?) AS refunds,
              (SELECT COALESCE(SUM(si.net_amount + si.exempt_amount + si.not_taxed_amount), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                WHERE s.tenant_id = b.tenant_id AND s.branch_id = b.id AND s.created_at >= ? AND s.created_at < ?) AS revenueNet,
              (SELECT COALESCE(SUM(si.unit_cost * si.quantity), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                WHERE s.tenant_id = b.tenant_id AND s.branch_id = b.id AND s.created_at >= ? AND s.created_at < ?) AS cost
         FROM branches b
        WHERE b.tenant_id = ? AND b.status = 1${branchId ? ' AND b.id = ?' : ''}
        ORDER BY gross DESC`,
      [
        period.startUtc, period.endUtc,
        period.startUtc, period.endUtc,
        period.startUtc, period.endUtc,
        period.startUtc, period.endUtc,
        period.startUtc, period.endUtc,
        tenantId,
        ...(branchId ? [branchId] : []),
      ],
    )) as Row[];
    return rows.map((row) => ({
      branchId: String(row.branchId),
      code: String(row.code),
      name: String(row.name),
      tickets: num(row.tickets),
      netSales: money(num(row.gross) - num(row.refunds)),
      grossMargin: money(num(row.revenueNet) - num(row.cost)),
      marginPercent: marginPercent(num(row.revenueNet), num(row.cost)),
    }));
  }

  private async operations(tenantId: string, branchId: string | null, timeZone: string) {
    const branchFilter = (column: string) => (branchId ? ` AND ${column} = ?` : '');
    const branchParam = branchId ? [branchId] : [];
    const today = localToday(timeZone);
    const [cash, payables, lowStock, transfers, orders] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*) AS sessions, COALESCE(SUM(expected_amount), 0) AS cash
           FROM cash_sessions WHERE tenant_id = ? AND status = 'OPEN'${branchFilter('branch_id')}`,
        [tenantId, ...branchParam],
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT COALESCE(SUM(original_amount - amount_paid), 0) AS outstanding,
                COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN original_amount - amount_paid ELSE 0 END), 0) AS overdue
           FROM supplier_payables WHERE tenant_id = ? AND original_amount > amount_paid${branchFilter('branch_id')}`,
        [today, tenantId, ...branchParam],
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT COUNT(*) AS total FROM product_branches
          WHERE tenant_id = ? AND is_active = 1 AND min_stock > 0 AND stock <= min_stock${branchFilter('branch_id')}`,
        [tenantId, ...branchParam],
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT COUNT(*) AS total FROM stock_transfers
          WHERE tenant_id = ? AND status = 'SENT'${branchId ? ' AND (origin_branch_id = ? OR destination_branch_id = ?)' : ''}`,
        [tenantId, ...(branchId ? [branchId, branchId] : [])],
      ) as Promise<Row[]>,
      this.dataSource.query(
        `SELECT COUNT(*) AS total FROM purchase_orders
          WHERE tenant_id = ? AND status IN ('SENT', 'PARTIALLY_RECEIVED')${branchFilter('branch_id')}`,
        [tenantId, ...branchParam],
      ) as Promise<Row[]>,
    ]);
    return {
      openCashSessions: num(cash[0]?.sessions),
      cashInRegisters: money(cash[0]?.cash),
      payablesOutstanding: money(payables[0]?.outstanding),
      payablesOverdue: money(payables[0]?.overdue),
      lowStockItems: num(lowStock[0]?.total),
      transfersInTransit: num(transfers[0]?.total),
      purchaseOrdersPending: num(orders[0]?.total),
    };
  }

  private scopedBranch(requested: string | undefined, branchScope: string | null): string | null {
    if (branchScope && requested && requested !== branchScope) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
    return branchScope ?? requested ?? null;
  }

  private async context(tenantId: string, query: ReportQueryDto, branchScope: string | null) {
    const branchId = this.scopedBranch(query.branchId, branchScope);
    const tenant = await this.dataSource.getRepository(TenantEntity).findOne({ where: { id: tenantId }, select: { id: true, timeZone: true } });
    const timeZone = tenant?.timeZone || 'America/Argentina/Buenos_Aires';
    try {
      return { period: buildPeriod(timeZone, query.from, query.to), branchId, timeZone };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Período inválido.');
    }
  }
}
