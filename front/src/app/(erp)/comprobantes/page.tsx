'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { PeriodPicker, periodFor, type Period } from '@/components/ui/PeriodPicker';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { VoucherLetter } from '@/components/ui/VoucherLetter';
import { fiscalApi } from '@/lib/api/endpoints';
import type { FiscalDocumentStatus } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { date, money, VOUCHER_TYPE_LABEL } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { DOCUMENT_STATUS } from '@/lib/labels';

export default function FiscalDocumentsPage() {
  return (
    <RequireCapability capability="fiscal.view">
      <FiscalDocuments />
    </RequireCapability>
  );
}

function FiscalDocuments() {
  const router = useRouter();
  const { activeBranchId } = useSession();
  const branchName = useBranchName();
  const [period, setPeriod] = useState<Period>(() => periodFor('30d'));
  const [status, setStatus] = useState<FiscalDocumentStatus | ''>('');
  const [page, setPage] = useState(1);

  const documents = useApiQuery(
    () => fiscalApi.documents({ ...period, page, limit: 25, status: status || undefined, branchId: activeBranchId ?? undefined }),
    [period.from, period.to, page, status, activeBranchId],
  );

  return (
    <>
      <PageHeader eyebrow="Factura electrónica" title="Comprobantes ARCA" subtitle="Facturas y notas de crédito emitidas por WSFEv1, con CAE y código QR." />
      <section className="surface">
        <div className="toolbar">
          <PeriodPicker value={period} onChange={(next) => { setPeriod(next); setPage(1); }} />
          <select className="form-select form-select-sm w-auto" value={status} onChange={(event) => { setStatus(event.target.value as FiscalDocumentStatus | ''); setPage(1); }} aria-label="Estado">
            <option value="">Todos los estados</option>
            {(Object.keys(DOCUMENT_STATUS) as FiscalDocumentStatus[]).map((key) => (
              <option key={key} value={key}>
                {DOCUMENT_STATUS[key].label}
              </option>
            ))}
          </select>
        </div>
        {documents.error && (
          <div className="p-3 pb-0">
            <ErrorAlert message={documents.error} onRetry={documents.reload} />
          </div>
        )}
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>Comprobante</th>
                <th>Número</th>
                <th>Fecha</th>
                <th>Sucursal</th>
                <th>CAE</th>
                <th>Estado</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            {documents.loading && !documents.data ? (
              <SkeletonRows columns={7} />
            ) : documents.data && documents.data.items.length === 0 ? (
              <TableMessage colSpan={7}>
                <EmptyState icon="bi-file-earmark-text" title="Sin comprobantes en el período">
                  Los comprobantes aparecen al facturar desde el punto de venta o el detalle de una venta.
                </EmptyState>
              </TableMessage>
            ) : (
              <tbody>
                {documents.data?.items.map((document) => (
                  <tr key={document.id} className="clickable" onClick={() => router.push(`/comprobantes/${document.id}`)}>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <VoucherLetter letter={document.voucherClass} />
                        <span>{VOUCHER_TYPE_LABEL[document.voucherType] ?? `Tipo ${document.voucherType}`}</span>
                        {document.environment === 'HOMOLOGATION' && <span className="env-badge homo">Prueba</span>}
                      </div>
                    </td>
                    <td className="mono">
                      {String(document.pointOfSale).padStart(5, '0')}-{document.number ? String(document.number).padStart(8, '0') : '········'}
                    </td>
                    <td>{date(document.issueDate)}</td>
                    <td>{branchName(document.branchId)}</td>
                    <td className="mono small">{document.cae ?? '—'}</td>
                    <td>
                      <StatusBadge tone={DOCUMENT_STATUS[document.status].tone}>{DOCUMENT_STATUS[document.status].label}</StatusBadge>
                    </td>
                    <td className="num fw-semibold">{money(document.total)}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {documents.data && <Pagination page={documents.data.page} pages={documents.data.pages} total={documents.data.total} limit={documents.data.limit} onPage={setPage} />}
      </section>
    </>
  );
}
