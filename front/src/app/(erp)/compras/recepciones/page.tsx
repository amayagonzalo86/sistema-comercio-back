'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { PeriodPicker, periodFor, type Period } from '@/components/ui/PeriodPicker';
import { receiptsApi } from '@/lib/api/endpoints';
import { useBranchName, useSession } from '@/lib/auth/session';
import { dateTime, money } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { usePersonNames } from '@/lib/hooks/usePersonNames';

export default function ReceiptsPage() {
  return (
    <RequireCapability capability="purchases.view">
      <Receipts />
    </RequireCapability>
  );
}

function Receipts() {
  const { activeBranchId, can } = useSession();
  const branchName = useBranchName();
  const supplierName = usePersonNames('suppliers');
  const [period, setPeriod] = useState<Period>(() => periodFor('30d'));
  const [page, setPage] = useState(1);
  const receipts = useApiQuery(() => receiptsApi.list({ ...period, page, limit: 25, branchId: activeBranchId ?? undefined }), [period.from, period.to, page, activeBranchId]);

  return (
    <>
      <PageHeader
        eyebrow="Compras"
        title="Recepción de mercadería"
        subtitle="Cada ingreso suma stock, actualiza costos y genera la deuda con el proveedor."
        actions={
          can('purchases.receive') && (
            <Link href="/compras/recepciones/nueva" className="btn btn-sm btn-primary">
              <i className="bi bi-box-arrow-in-down me-1" aria-hidden="true" />
              Registrar ingreso
            </Link>
          )
        }
      />
      <section className="surface">
        <div className="toolbar">
          <PeriodPicker value={period} onChange={(next) => { setPeriod(next); setPage(1); }} />
        </div>
        {receipts.error && <div className="p-3 pb-0"><ErrorAlert message={receipts.error} onRetry={receipts.reload} /></div>}
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Comprobante</th>
                <th>Sucursal</th>
                <th className="num">Neto</th>
                <th className="num">IVA</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            {receipts.loading && !receipts.data ? (
              <SkeletonRows columns={7} />
            ) : receipts.data && receipts.data.items.length === 0 ? (
              <TableMessage colSpan={7}><EmptyState icon="bi-box-arrow-in-down" title="Sin ingresos en el período" /></TableMessage>
            ) : (
              <tbody>
                {receipts.data?.items.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>{dateTime(receipt.createdAt)}</td>
                    <td className="cell-title">{supplierName(receipt.supplierPersonId)}</td>
                    <td>
                      {receipt.sourceDocumentNumber ? `${receipt.sourceDocumentType ?? 'Doc.'} ${receipt.sourceDocumentNumber}` : <span className="text-muted-2">—</span>}
                      {receipt.purchaseOrderId && <div className="cell-sub"><Link href={`/compras/pedidos/${receipt.purchaseOrderId}`}>Ver pedido</Link></div>}
                    </td>
                    <td>{branchName(receipt.branchId)}</td>
                    <td className="num text-muted-2">{money(receipt.subtotal)}</td>
                    <td className="num text-muted-2">{money(receipt.taxTotal)}</td>
                    <td className="num fw-semibold">{money(receipt.total)}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {receipts.data && <Pagination page={receipts.data.page} pages={receipts.data.pages} total={receipts.data.total} limit={receipts.data.limit} onPage={setPage} />}
      </section>
    </>
  );
}
