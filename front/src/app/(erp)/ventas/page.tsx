'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { PeriodPicker, periodFor, type Period } from '@/components/ui/PeriodPicker';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { VoucherLetter } from '@/components/ui/VoucherLetter';
import { salesApi } from '@/lib/api/endpoints';
import type { SalePaymentMethod, VoucherClass } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { dateTime, money, PAYMENT_LABEL } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { FISCAL_STATUS, RETURN_STATUS } from '@/lib/labels';

export default function SalesPage() {
  return (
    <RequireCapability capability="sales.view">
      <SalesList />
    </RequireCapability>
  );
}

function SalesList() {
  const router = useRouter();
  const { activeBranchId, can } = useSession();
  const branchName = useBranchName();
  const [period, setPeriod] = useState<Period>(() => periodFor('7d'));
  const [page, setPage] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod | ''>('');
  const [voucherClass, setVoucherClass] = useState<VoucherClass | ''>('');

  const sales = useApiQuery(
    () =>
      salesApi.list({
        ...period,
        page,
        limit: 25,
        branchId: activeBranchId ?? undefined,
        paymentMethod: paymentMethod || undefined,
        voucherClass: voucherClass || undefined,
      }),
    [period.from, period.to, page, activeBranchId, paymentMethod, voucherClass],
  );

  const canOpen = can('pos.sell') || can('sales.return');

  return (
    <>
      <PageHeader
        eyebrow="Ventas"
        title="Ventas registradas"
        subtitle="Tickets, facturas y devoluciones de cada sucursal."
        actions={
          can('pos.sell') && (
            <Link href="/ventas/pos" className="btn btn-primary btn-sm">
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              Nueva venta
            </Link>
          )
        }
      />

      <section className="surface">
        <div className="toolbar">
          <PeriodPicker
            value={period}
            initialPreset="7d"
            onChange={(next) => {
              setPeriod(next);
              setPage(1);
            }}
          />
          <select className="form-select form-select-sm w-auto" value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value as SalePaymentMethod | ''); setPage(1); }} aria-label="Medio de pago">
            <option value="">Todos los medios</option>
            {(Object.keys(PAYMENT_LABEL) as SalePaymentMethod[]).map((method) => (
              <option key={method} value={method}>
                {PAYMENT_LABEL[method]}
              </option>
            ))}
          </select>
          <select className="form-select form-select-sm w-auto" value={voucherClass} onChange={(event) => { setVoucherClass(event.target.value as VoucherClass | ''); setPage(1); }} aria-label="Comprobante">
            <option value="">Todas las letras</option>
            {(['A', 'B', 'C', 'E'] as VoucherClass[]).map((letter) => (
              <option key={letter} value={letter}>
                Factura {letter}
              </option>
            ))}
          </select>
        </div>

        {sales.error && (
          <div className="p-3 pb-0">
            <ErrorAlert message={sales.error} onRetry={sales.reload} />
          </div>
        )}

        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comprobante</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th className="num">IVA</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            {sales.loading && !sales.data ? (
              <SkeletonRows columns={6} />
            ) : sales.data && sales.data.items.length === 0 ? (
              <TableMessage colSpan={6}>
                <EmptyState icon="bi-receipt" title="Sin ventas en el período">
                  Probá con otro rango de fechas o sucursal.
                </EmptyState>
              </TableMessage>
            ) : (
              <tbody>
                {sales.data?.items.map((sale) => {
                  const returned = RETURN_STATUS[sale.returnStatus];
                  return (
                    <tr key={sale.id} className={canOpen ? 'clickable' : ''} onClick={() => canOpen && router.push(`/ventas/${sale.id}`)}>
                      <td>
                        <div className="cell-title">{dateTime(sale.createdAt)}</div>
                        <div className="cell-sub mono">#{sale.id.slice(0, 8)}</div>
                      </td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <VoucherLetter letter={sale.voucherClass ?? '–'} />
                          <span className="small text-muted-2">{sale.customerPersonId ? 'Cliente identificado' : 'Consumidor final'}</span>
                        </div>
                      </td>
                      <td>{branchName(sale.branchId)}</td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          <StatusBadge tone={FISCAL_STATUS[sale.fiscalStatus].tone}>{FISCAL_STATUS[sale.fiscalStatus].label}</StatusBadge>
                          {returned && <StatusBadge tone={returned.tone}>{returned.label}</StatusBadge>}
                        </div>
                      </td>
                      <td className="num text-muted-2">{money(sale.taxTotal)}</td>
                      <td className="num fw-semibold">{money(sale.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
        {sales.data && <Pagination page={sales.data.page} pages={sales.data.pages} total={sales.data.total} limit={sales.data.limit} onPage={setPage} />}
      </section>
    </>
  );
}
