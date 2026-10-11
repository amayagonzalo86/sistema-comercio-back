'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AreaChart } from '@/components/charts/AreaChart';
import { BarList } from '@/components/charts/BarList';
import { Heatmap } from '@/components/charts/Heatmap';
import { Delta } from '@/components/ui/Delta';
import { ErrorAlert } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodPicker, periodFor, type Period } from '@/components/ui/PeriodPicker';
import { Surface } from '@/components/ui/Surface';
import { reportsApi } from '@/lib/api/endpoints';
import { useSession } from '@/lib/auth/session';
import { date, int, money, moneyCompact, PAYMENT_LABEL, pct, qty, shortDay } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

export default function DashboardPage() {
  return (
    <RequireCapability capability="dashboard.view">
      <Dashboard />
    </RequireCapability>
  );
}

function Dashboard() {
  const { activeBranchId, activeBranch, user } = useSession();
  const [period, setPeriod] = useState<Period>(() => periodFor('30d'));
  const query = { ...period, branchId: activeBranchId ?? undefined };
  const deps = [period.from, period.to, activeBranchId];

  const dashboard = useApiQuery(() => reportsApi.dashboard(query), deps);
  const byDay = useApiQuery(() => reportsApi.salesByDay(query), deps);
  const byHour = useApiQuery(() => reportsApi.salesByHour(query), deps);
  const top = useApiQuery(() => reportsApi.topProducts({ ...query, limit: 8, sort: 'revenue' }), deps);
  const payments = useApiQuery(() => reportsApi.salesByPaymentMethod(query), deps);

  const data = dashboard.data;
  const loading = dashboard.loading && !data;
  const spark = byDay.data?.series.map((point) => point.netSales) ?? [];
  const firstName = user?.displayName.split(' ')[0] ?? '';

  return (
    <>
      <PageHeader
        eyebrow={activeBranch ? `Sucursal ${activeBranch.name}` : 'Todas las sucursales'}
        title={firstName ? `Hola, ${firstName}` : 'Tablero'}
        subtitle={data ? `Del ${date(data.period.from)} al ${date(data.period.to)} · comparado con ${date(data.previousPeriod.from)} – ${date(data.previousPeriod.to)}` : 'Resumen del negocio'}
        actions={<PeriodPicker value={period} onChange={setPeriod} />}
      />

      {dashboard.error && <ErrorAlert message={dashboard.error} onRetry={dashboard.reload} />}

      <div className="row g-3 mb-3">
        <div className="col-sm-6 col-xl-3">
          <KpiCard
            label="Ventas netas"
            icon="bi-currency-dollar"
            loading={loading}
            value={data ? money(data.totals.netSales) : '—'}
            spark={spark}
            foot={data && (<><Delta value={data.growth.netSales} /> vs. período anterior</>)}
          />
        </div>
        <div className="col-sm-6 col-xl-3">
          <KpiCard
            label="Tickets"
            icon="bi-receipt"
            loading={loading}
            value={data ? int(data.totals.tickets) : '—'}
            foot={data && (<><Delta value={data.growth.tickets} /> · promedio {money(data.totals.averageTicket)}</>)}
          />
        </div>
        <div className="col-sm-6 col-xl-3">
          <KpiCard
            label="Margen bruto"
            icon="bi-graph-up-arrow"
            loading={loading}
            value={data ? money(data.totals.grossMargin) : '—'}
            foot={data && (<><Delta value={data.growth.grossMargin} /> · {data.totals.marginPercent === null ? 'sin costo cargado' : `${pct(data.totals.marginPercent)} s/ventas sin IVA`}</>)}
          />
        </div>
        <div className="col-sm-6 col-xl-3">
          <KpiCard
            label="Hoy"
            icon="bi-sun"
            loading={loading}
            value={data ? money(data.today.netSales) : '—'}
            foot={data && (<>{int(data.today.tickets)} tickets · IVA del período {moneyCompact(data.totals.vat)}</>)}
          />
        </div>
      </div>

      {data && (
        <div className="row g-2 mb-3">
          <OpsTile href="/caja" icon="bi-safe2" tone="blue" value={int(data.operations.openCashSessions)} label={`Cajas abiertas · ${money(data.operations.cashInRegisters)} en efectivo`} />
          <OpsTile href="/stock?bajo=1" icon="bi-exclamation-triangle" tone={data.operations.lowStockItems > 0 ? 'amber' : 'green'} value={int(data.operations.lowStockItems)} label="Productos bajo el mínimo" />
          <OpsTile href="/stock/transferencias" icon="bi-truck" tone="slate" value={int(data.operations.transfersInTransit)} label="Transferencias en tránsito" />
          <OpsTile href="/compras/pedidos" icon="bi-clipboard-check" tone="slate" value={int(data.operations.purchaseOrdersPending)} label="Pedidos a proveedores pendientes" />
          <OpsTile
            href="/compras/cuentas"
            icon="bi-wallet2"
            tone={data.operations.payablesOverdue > 0 ? 'red' : 'green'}
            value={moneyCompact(data.operations.payablesOutstanding)}
            label={data.operations.payablesOverdue > 0 ? `Deuda con proveedores · ${moneyCompact(data.operations.payablesOverdue)} vencida` : 'Deuda con proveedores · al día'}
          />
        </div>
      )}

      <div className="row g-3 mb-3">
        <div className="col-xl-8">
          <Surface title="Evolución de ventas" subtitle="Ventas netas diarias (línea) y devoluciones (punteada)">
            {byDay.error ? (
              <ErrorAlert message={byDay.error} onRetry={byDay.reload} />
            ) : (
              <AreaChart
                points={(byDay.data?.series ?? []).map((point) => ({ label: point.day, value: point.netSales, secondary: point.refunds }))}
                formatValue={money}
                formatAxis={moneyCompact}
                formatLabel={shortDay}
                valueName="Ventas netas"
                secondaryName="Devoluciones"
              />
            )}
          </Surface>
        </div>
        <div className="col-xl-4">
          <Surface title="Sucursales" subtitle="Ventas netas y margen del período" className="h-100">
            <BarList
              items={(data?.byBranch ?? []).map((branch) => ({
                key: branch.branchId,
                label: branch.name,
                value: branch.netSales,
                display: moneyCompact(branch.netSales),
                hint: `${int(branch.tickets)} tk · ${branch.marginPercent === null ? 's/costo' : pct(branch.marginPercent)}`,
              }))}
            />
          </Surface>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-xl-7">
          <Surface
            title="Productos más vendidos"
            padded={false}
            actions={
              <Link href="/reportes" className="btn btn-sm btn-link">
                Ver ranking completo
              </Link>
            }
          >
            <div className="table-responsive">
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Unidades</th>
                    <th className="num">Facturación</th>
                    <th className="num">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {(top.data?.items ?? []).map((item) => (
                    <tr key={item.productId}>
                      <td>
                        <div className="cell-title">{item.name}</div>
                        <div className="cell-sub mono">{item.sku}</div>
                      </td>
                      <td className="num">{qty(item.quantity)}</td>
                      <td className="num">{money(item.revenue)}</td>
                      <td className="num">{item.marginPercent === null ? '—' : pct(item.marginPercent)}</td>
                    </tr>
                  ))}
                  {top.data && top.data.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-muted-2 py-4">
                        Todavía no hay ventas en el período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>
        <div className="col-xl-5 d-flex flex-column gap-3">
          <Surface title="Medios de pago">
            <BarList
              items={(payments.data?.items ?? []).map((item) => ({
                key: item.method,
                label: PAYMENT_LABEL[item.method] ?? item.method,
                value: item.amount,
                display: `${pct(item.share)}`,
                hint: moneyCompact(item.amount),
              }))}
            />
          </Surface>
          <Surface title="¿Cuándo se vende?" subtitle="Tickets por día y hora: útil para armar turnos y reponer antes del pico">
            <Heatmap cells={byHour.data?.cells ?? []} />
          </Surface>
        </div>
      </div>
    </>
  );
}

function OpsTile({ href, icon, tone, value, label }: { href: string; icon: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'slate'; value: string; label: string }) {
  return (
    <div className="col-sm-6 col-lg-4 col-xxl min-w-0">
      <Link href={href} className="ops-tile h-100">
        <span className={`ops-icon tone-${tone}`}>
          <i className={`bi ${icon}`} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="ops-value d-block">{value}</span>
          <span className="ops-label d-block text-truncate">{label}</span>
        </span>
      </Link>
    </div>
  );
}
