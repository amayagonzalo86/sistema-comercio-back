'use client';

import { useState } from 'react';
import { ErrorAlert } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { PeriodPicker, periodFor, type Period } from '@/components/ui/PeriodPicker';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { marketingApi } from '@/lib/api/endpoints';
import type { CustomerInsight } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { date, int, money, pct } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

export default function LoyaltyPage() {
  return (
    <RequireCapability capability="marketing.view">
      <Loyalty />
    </RequireCapability>
  );
}

function ContactCell({ customer }: { customer: CustomerInsight }) {
  return (
    <td className="small">
      {customer.email && <div>{customer.email}</div>}
      {customer.phone && <div className="text-muted-2">{customer.phone}</div>}
      {!customer.marketingConsent && <div className="text-muted-2 fst-italic">Sin consentimiento</div>}
    </td>
  );
}

function Loyalty() {
  const toast = useToast();
  const { activeBranchId, can } = useSession();
  const [period, setPeriod] = useState<Period>(() => periodFor('30d'));
  const [days, setDays] = useState(60);
  const [onlyConsent, setOnlyConsent] = useState(true);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const query = { ...period, branchId: activeBranchId ?? undefined };
  const summary = useApiQuery(() => marketingApi.summary(query), [period.from, period.to, activeBranchId]);
  const top = useApiQuery(() => marketingApi.topCustomers({ ...query, limit: 15 }), [period.from, period.to, activeBranchId]);
  const inactive = useApiQuery(() => marketingApi.inactiveCustomers({ days, onlyWithConsent: onlyConsent || undefined, page, limit: 20 }), [days, onlyConsent, page]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await marketingApi.contactsCsv();
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'contactos-marketing.csv';
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Contactos exportados', 'Solo se incluyen clientes con consentimiento (Ley 25.326).');
    } catch (caught) {
      toast.error('No se pudo exportar', errorMessage(caught));
    } finally {
      setExporting(false);
    }
  };

  const data = summary.data;

  return (
    <>
      <PageHeader
        eyebrow="Marketing"
        title="Fidelización de clientes"
        subtitle="Quiénes compran más, quiénes dejaron de venir y a quiénes se les puede escribir."
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            {can('marketing.export') && (
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void exportCsv()} disabled={exporting}>
                <i className="bi bi-download me-1" aria-hidden="true" />
                Exportar contactos
              </button>
            )}
          </>
        }
      />
      {summary.error && <ErrorAlert message={summary.error} onRetry={summary.reload} />}
      <div className="row g-3 mb-3">
        <div className="col-sm-6 col-xl-3"><KpiCard label="Clientes identificados" icon="bi-people" loading={!data} value={data ? int(data.customers) : '—'} foot={data && `${int(data.newCustomers)} nuevos · ${int(data.returningCustomers)} recurrentes`} /></div>
        <div className="col-sm-6 col-xl-3"><KpiCard label="Ventas identificadas" icon="bi-person-check" loading={!data} value={data ? pct(data.identifiedShare) : '—'} foot={data && `${int(data.identifiedTickets)} de ${int(data.tickets)} tickets`} /></div>
        <div className="col-sm-6 col-xl-3"><KpiCard label="Facturación identificada" icon="bi-currency-dollar" loading={!data} value={data ? money(data.identifiedGrossSales) : '—'} foot={data && `de ${money(data.grossSales)} totales`} /></div>
        <div className="col-sm-6 col-xl-3"><KpiCard label="A recuperar" icon="bi-arrow-repeat" loading={!inactive.data} value={inactive.data ? int(inactive.data.total) : '—'} foot={`Sin comprar hace ${days}+ días`} /></div>
      </div>

      <div className="row g-3">
        <div className="col-xl-6">
          <Surface title="Mejores clientes del período" padded={false}>
            <div className="table-responsive">
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Contacto</th>
                    <th className="num">Compras</th>
                    <th className="num">Gastado</th>
                  </tr>
                </thead>
                <tbody>
                  {top.data?.items.map((customer, index) => (
                    <tr key={customer.personId}>
                      <td><span className="mono text-muted-2 me-2">{index + 1}</span><span className="cell-title">{customer.name}</span><div className="cell-sub">Última: {date(customer.lastPurchase)}</div></td>
                      <ContactCell customer={customer} />
                      <td className="num">{int(customer.purchases)}</td>
                      <td className="num fw-semibold">{money(customer.spent)}</td>
                    </tr>
                  ))}
                  {top.data && top.data.items.length === 0 && <tr><td colSpan={4} className="text-center text-muted-2 py-4">Identificá clientes en el punto de venta para ver este ranking.</td></tr>}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>
        <div className="col-xl-6">
          <Surface
            title="Clientes a recuperar"
            padded={false}
            actions={
              <>
                <select className="form-select form-select-sm w-auto" value={days} onChange={(event) => { setDays(Number(event.target.value)); setPage(1); }} aria-label="Días sin comprar">
                  {[30, 60, 90, 180].map((value) => <option key={value} value={value}>{value}+ días</option>)}
                </select>
                <div className="form-check form-switch mb-0">
                  <input id="consent" className="form-check-input" type="checkbox" checked={onlyConsent} onChange={(event) => { setOnlyConsent(event.target.checked); setPage(1); }} />
                  <label htmlFor="consent" className="form-check-label small">Con consentimiento</label>
                </div>
              </>
            }
          >
            <div className="table-responsive">
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Contacto</th>
                    <th className="num">Histórico</th>
                  </tr>
                </thead>
                <tbody>
                  {inactive.data?.items.map((customer) => (
                    <tr key={customer.personId}>
                      <td><div className="cell-title">{customer.name}</div><div className="cell-sub">Última compra: {date(customer.lastPurchase)}</div></td>
                      <ContactCell customer={customer} />
                      <td className="num">{money(customer.spent)}<div className="cell-sub">{int(customer.purchases)} compras</div></td>
                    </tr>
                  ))}
                  {inactive.data && inactive.data.items.length === 0 && <tr><td colSpan={3} className="text-center text-muted-2 py-4">No hay clientes inactivos con estos filtros.</td></tr>}
                </tbody>
              </table>
            </div>
            {inactive.data && <Pagination page={inactive.data.page} pages={inactive.data.pages} total={inactive.data.total} limit={inactive.data.limit} onPage={setPage} />}
          </Surface>
          <div className="legal-note mt-3">Ley 25.326: escribí solo a clientes que dieron su consentimiento y ofrecé siempre la opción de darse de baja.</div>
        </div>
      </div>
    </>
  );
}
