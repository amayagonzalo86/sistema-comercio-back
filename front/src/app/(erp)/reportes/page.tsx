'use client';

import { useState } from 'react';
import { BarList } from '@/components/charts/BarList';
import { Heatmap } from '@/components/charts/Heatmap';
import { ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { PeriodPicker, periodFor, type Period } from '@/components/ui/PeriodPicker';
import { Surface } from '@/components/ui/Surface';
import { reportsApi } from '@/lib/api/endpoints';
import { useBranchName, useSession } from '@/lib/auth/session';
import { int, money, moneyCompact, PAYMENT_LABEL, pct, qty } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

type Tab = 'products' | 'categories' | 'sellers' | 'payments' | 'hours' | 'valuation' | 'dead';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'products', label: 'Productos', icon: 'bi-trophy' },
  { id: 'categories', label: 'Rubros', icon: 'bi-diagram-3' },
  { id: 'sellers', label: 'Vendedores', icon: 'bi-person-badge' },
  { id: 'payments', label: 'Medios de pago', icon: 'bi-credit-card' },
  { id: 'hours', label: 'Horarios', icon: 'bi-clock' },
  { id: 'valuation', label: 'Inventario valorizado', icon: 'bi-safe' },
  { id: 'dead', label: 'Sin rotación', icon: 'bi-hourglass-split' },
];

/** Exporta la tabla visible a CSV (separador ; para Excel en español). */
function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
  const escape = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; // evita inyección de fórmulas
    return /[;"\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = [header, ...rows].map((row) => row.map(escape).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const decimal = (value: number) => value.toFixed(2).replace('.', ',');

export default function ReportsPage() {
  return (
    <RequireCapability capability="reports.view">
      <Reports />
    </RequireCapability>
  );
}

function Reports() {
  const { activeBranchId } = useSession();
  const [tab, setTab] = useState<Tab>('products');
  const [period, setPeriod] = useState<Period>(() => periodFor('30d'));
  const query = { ...period, branchId: activeBranchId ?? undefined };
  const periodDeps = [period.from, period.to, activeBranchId];
  const usesPeriod = tab !== 'valuation' && tab !== 'dead';

  return (
    <>
      <PageHeader eyebrow="Dirección" title="Reportes" subtitle="Análisis para decidir qué comprar, qué promocionar y dónde está el capital inmovilizado." actions={usesPeriod && <PeriodPicker value={period} onChange={setPeriod} />} />
      <div className="d-flex flex-wrap gap-1 mb-3">
        {TABS.map((item) => (
          <button key={item.id} type="button" className={`btn btn-sm ${tab === item.id ? 'btn-dark' : 'btn-light border'}`} onClick={() => setTab(item.id)}>
            <i className={`bi ${item.icon} me-1`} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'products' && <ProductsReport query={query} deps={periodDeps} />}
      {tab === 'categories' && <CategoriesReport query={query} deps={periodDeps} />}
      {tab === 'sellers' && <SellersReport query={query} deps={periodDeps} />}
      {tab === 'payments' && <PaymentsReport query={query} deps={periodDeps} />}
      {tab === 'hours' && <HoursReport query={query} deps={periodDeps} />}
      {tab === 'valuation' && <ValuationReport />}
      {tab === 'dead' && <DeadStockReport />}
    </>
  );
}

type ReportProps = { query: { from: string; to: string; branchId?: string }; deps: ReadonlyArray<unknown> };

function ProductsReport({ query, deps }: ReportProps) {
  const [sort, setSort] = useState<'revenue' | 'quantity' | 'margin'>('revenue');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const report = useApiQuery(() => reportsApi.topProducts({ ...query, sort, order, limit: 50 }), [...deps, sort, order]);
  const items = report.data?.items ?? [];
  return (
    <Surface
      title={order === 'desc' ? 'Los que más venden' : 'Los que menos venden'}
      padded={false}
      actions={
        <>
          <select className="form-select form-select-sm w-auto" value={sort} onChange={(event) => setSort(event.target.value as 'revenue' | 'quantity' | 'margin')} aria-label="Ordenar por">
            <option value="revenue">Por facturación</option>
            <option value="quantity">Por unidades</option>
            <option value="margin">Por margen $</option>
          </select>
          <div className="segmented">
            <button type="button" className={order === 'desc' ? 'active' : ''} onClick={() => setOrder('desc')}>Más</button>
            <button type="button" className={order === 'asc' ? 'active' : ''} onClick={() => setOrder('asc')}>Menos</button>
          </div>
          <button type="button" className="btn btn-sm btn-light border" disabled={items.length === 0} onClick={() => downloadCsv('ranking-productos.csv', ['SKU', 'Producto', 'Unidades', 'Facturación', 'Margen $', 'Margen %'], items.map((item) => [item.sku, item.name, String(item.quantity).replace('.', ','), decimal(item.revenue), decimal(item.grossMargin), item.marginPercent === null ? '' : decimal(item.marginPercent)]))}>
            <i className="bi bi-filetype-csv" aria-hidden="true" />
          </button>
        </>
      }
    >
      {report.error && <div className="p-3"><ErrorAlert message={report.error} onRetry={report.reload} /></div>}
      {report.loading && !report.data && <Spinner className="p-3" />}
      <div className="table-scroll">
        <table className="table table-erp">
          <thead>
            <tr>
              <th>#</th>
              <th>Producto</th>
              <th className="num">Unidades</th>
              <th className="num">Facturación</th>
              <th className="num">Margen $</th>
              <th className="num">Margen %</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.productId}>
                <td className="mono text-muted-2">{index + 1}</td>
                <td><div className="cell-title">{item.name}</div><div className="cell-sub mono">{item.sku}</div></td>
                <td className="num">{qty(item.quantity)}</td>
                <td className="num fw-semibold">{money(item.revenue)}</td>
                <td className="num">{money(item.grossMargin)}</td>
                <td className="num">{item.marginPercent === null ? '—' : pct(item.marginPercent)}</td>
              </tr>
            ))}
            {report.data && items.length === 0 && <tr><td colSpan={6} className="text-center text-muted-2 py-4">Sin ventas en el período.</td></tr>}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function CategoriesReport({ query, deps }: ReportProps) {
  const report = useApiQuery(() => reportsApi.salesByCategory(query), deps);
  const items = report.data?.items ?? [];
  return (
    <div className="row g-3">
      <div className="col-xl-5">
        <Surface title="Facturación por rubro">
          {report.error && <ErrorAlert message={report.error} onRetry={report.reload} />}
          <BarList items={items.map((item) => ({ key: item.category, label: item.category, value: item.revenue, display: moneyCompact(item.revenue), hint: item.marginPercent === null ? undefined : `margen ${pct(item.marginPercent)}` }))} />
        </Surface>
      </div>
      <div className="col-xl-7">
        <Surface title="Detalle" padded={false}>
          <table className="table table-erp">
            <thead><tr><th>Rubro</th><th className="num">Unidades</th><th className="num">Facturación</th><th className="num">Margen $</th><th className="num">Margen %</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.category}>
                  <td className="cell-title">{item.category}</td>
                  <td className="num">{qty(item.quantity)}</td>
                  <td className="num fw-semibold">{money(item.revenue)}</td>
                  <td className="num">{money(item.grossMargin)}</td>
                  <td className="num">{item.marginPercent === null ? '—' : pct(item.marginPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      </div>
    </div>
  );
}

function SellersReport({ query, deps }: ReportProps) {
  const report = useApiQuery(() => reportsApi.salesBySeller(query), deps);
  return (
    <Surface title="Desempeño por vendedor / cajero" padded={false}>
      {report.error && <div className="p-3"><ErrorAlert message={report.error} onRetry={report.reload} /></div>}
      <table className="table table-erp">
        <thead><tr><th>Usuario</th><th className="num">Tickets</th><th className="num">Ventas</th><th className="num">Devoluciones</th><th className="num">Ticket promedio</th></tr></thead>
        <tbody>
          {report.data?.items.map((item) => (
            <tr key={item.userId}>
              <td><div className="cell-title">{item.fullName ?? item.username ?? 'Usuario'}</div><div className="cell-sub mono">{item.username}</div></td>
              <td className="num">{int(item.tickets)}</td>
              <td className="num fw-semibold">{money(item.grossSales)}</td>
              <td className="num text-danger">{item.refunds > 0 ? money(item.refunds) : '—'}</td>
              <td className="num">{money(item.averageTicket)}</td>
            </tr>
          ))}
          {report.data && report.data.items.length === 0 && <tr><td colSpan={5} className="text-center text-muted-2 py-4">Sin ventas en el período.</td></tr>}
        </tbody>
      </table>
    </Surface>
  );
}

function PaymentsReport({ query, deps }: ReportProps) {
  const report = useApiQuery(() => reportsApi.salesByPaymentMethod(query), deps);
  const items = report.data?.items ?? [];
  const cards = items.filter((item) => item.method === 'CREDIT_CARD' || item.method === 'DEBIT_CARD').reduce((sum, item) => sum + item.amount, 0);
  return (
    <div className="row g-3">
      <div className="col-xl-6">
        <Surface title="Participación por medio de pago">
          {report.error && <ErrorAlert message={report.error} onRetry={report.reload} />}
          <BarList items={items.map((item) => ({ key: item.method, label: PAYMENT_LABEL[item.method] ?? item.method, value: item.amount, display: pct(item.share), hint: `${moneyCompact(item.amount)} · ${int(item.tickets)} pagos` }))} />
        </Surface>
      </div>
      <div className="col-xl-6">
        <KpiCard label="Cobrado con tarjetas" icon="bi-credit-card" value={money(cards)} foot="Base para conciliar liquidaciones y estimar comisiones del adquirente." />
      </div>
    </div>
  );
}

function HoursReport({ query, deps }: ReportProps) {
  const report = useApiQuery(() => reportsApi.salesByHour(query), deps);
  return (
    <Surface title="Tickets por día y hora" subtitle="Más oscuro = más tickets. Pasá el mouse para ver el detalle.">
      {report.error && <ErrorAlert message={report.error} onRetry={report.reload} />}
      <Heatmap cells={report.data?.cells ?? []} />
    </Surface>
  );
}

function ValuationReport() {
  const { activeBranchId } = useSession();
  const report = useApiQuery(() => reportsApi.stockValuation({ branchId: activeBranchId ?? undefined }), [activeBranchId]);
  const totals = report.data?.totals;
  return (
    <>
      {report.error && <ErrorAlert message={report.error} onRetry={report.reload} />}
      <div className="row g-3 mb-3">
        <div className="col-md-4"><KpiCard label="Inventario a costo" icon="bi-safe" loading={!totals} value={totals ? money(totals.costValue) : '—'} /></div>
        <div className="col-md-4"><KpiCard label="Inventario a precio de venta" icon="bi-tags" loading={!totals} value={totals ? money(totals.retailValue) : '—'} /></div>
        <div className="col-md-4"><KpiCard label="Margen potencial" icon="bi-graph-up" loading={!totals} value={totals ? money(totals.retailValue - totals.costValue) : '—'} foot={totals && `${qty(totals.units)} unidades`} /></div>
      </div>
      <Surface title="Por sucursal" padded={false}>
        <table className="table table-erp">
          <thead><tr><th>Sucursal</th><th className="num">Productos</th><th className="num">Unidades</th><th className="num">A costo</th><th className="num">A venta</th></tr></thead>
          <tbody>
            {report.data?.items.map((item) => (
              <tr key={item.branchId}>
                <td className="cell-title">{item.name} <span className="mono text-muted-2 small">{item.code}</span></td>
                <td className="num">{int(item.products)}</td>
                <td className="num">{qty(item.units)}</td>
                <td className="num">{money(item.costValue)}</td>
                <td className="num fw-semibold">{money(item.retailValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Surface>
    </>
  );
}

function DeadStockReport() {
  const { activeBranchId } = useSession();
  const branchName = useBranchName();
  const [days, setDays] = useState(60);
  const [page, setPage] = useState(1);
  const report = useApiQuery(() => reportsApi.deadStock({ branchId: activeBranchId ?? undefined, days, page, limit: 50 }), [activeBranchId, days, page]);
  const capital = (report.data?.items ?? []).reduce((sum, item) => sum + item.costValue, 0);
  return (
    <Surface
      title="Mercadería sin ventas"
      subtitle={`Capital inmovilizado en esta página: ${money(capital)}. Candidatos a promoción, transferencia o devolución al proveedor.`}
      padded={false}
      actions={
        <select className="form-select form-select-sm w-auto" value={days} onChange={(event) => { setDays(Number(event.target.value)); setPage(1); }} aria-label="Días sin ventas">
          {[30, 60, 90, 180].map((value) => <option key={value} value={value}>Sin ventas hace {value}+ días</option>)}
        </select>
      }
    >
      {report.error && <div className="p-3"><ErrorAlert message={report.error} onRetry={report.reload} /></div>}
      <table className="table table-erp">
        <thead><tr><th>Producto</th><th>Sucursal</th><th className="num">Stock</th><th className="num">Valor a costo</th></tr></thead>
        <tbody>
          {report.data?.items.map((item) => (
            <tr key={`${item.productId}-${item.branchId}`}>
              <td><div className="cell-title">{item.name}</div><div className="cell-sub mono">{item.sku}</div></td>
              <td>{branchName(item.branchId)}</td>
              <td className="num">{qty(item.stock)}</td>
              <td className="num fw-semibold">{money(item.costValue)}</td>
            </tr>
          ))}
          {report.data && report.data.items.length === 0 && <tr><td colSpan={4} className="text-center text-muted-2 py-4">Toda la mercadería con stock tuvo ventas en el período.</td></tr>}
        </tbody>
      </table>
      {report.data && <Pagination page={report.data.page} pages={report.data.pages} total={report.data.total} limit={report.data.limit} onPage={setPage} />}
    </Surface>
  );
}
