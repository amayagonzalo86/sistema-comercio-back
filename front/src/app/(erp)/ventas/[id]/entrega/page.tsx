'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { CustomerBlock, DocumentHeader, saleConditionLabel, useLetterhead } from '@/components/print/DocumentHeader';
import { salesApi } from '@/lib/api/endpoints';
import { useBranchName, useSession } from '@/lib/auth/session';
import { dateTime, money, qty } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

export default function DeliveryNotePage() {
  return (
    <RequireCapability capability="sales.view">
      <DeliveryNote />
    </RequireCapability>
  );
}

/**
 * Comprobante de entrega interno ("X"): acompaña la mercadería y se firma al recibirla.
 * NO es un comprobante fiscal: la operación se documenta con la factura (A, B o C) de la venta.
 */
function DeliveryNote() {
  const params = useParams<{ id: string }>();
  const { tenant } = useSession();
  const branchName = useBranchName();
  const [withPrices, setWithPrices] = useState(false);
  const sale = useApiQuery(() => salesApi.get(params.id), [params.id]);
  const letterhead = useLetterhead(sale.data?.branchId);

  if (sale.loading && !sale.data) return <Spinner label="Cargando venta…" />;
  if (sale.error || !sale.data) return <ErrorAlert message={sale.error ?? 'Venta no encontrada.'} onRetry={sale.reload} />;
  const data = sale.data;
  const units = data.items.reduce((sum, item) => sum + Number(item.quantity), 0);

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3 no-print">
        <Link href={`/ventas/${data.id}`} className="btn btn-sm btn-link px-0">
          <i className="bi bi-arrow-left me-1" aria-hidden="true" />
          Volver a la venta
        </Link>
        <div className="d-flex align-items-center gap-3">
          <div className="form-check form-switch mb-0">
            <input id="with-prices" className="form-check-input" type="checkbox" checked={withPrices} onChange={(event) => setWithPrices(event.target.checked)} />
            <label className="form-check-label small" htmlFor="with-prices">
              Mostrar importes
            </label>
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => window.print()}>
            <i className="bi bi-printer me-1" aria-hidden="true" />
            Imprimir
          </button>
        </div>
      </div>

      <article className="invoice-sheet mx-auto">
        <DocumentHeader
          letterhead={letterhead.data}
          fallbackName={tenant?.tradeName || tenant?.legalName || branchName(data.branchId)}
          letter="X"
          letterNote="No válido como factura"
          title="Remito"
          subtitle="Comprobante de entrega interno"
          number={data.id.slice(0, 8).toUpperCase()}
          issuedAt={dateTime(data.createdAt)}
          extra={<div>Comprobante fiscal: Factura {data.voucherClass ?? '—'}</div>}
        />
        <CustomerBlock customer={data.customer} sellerName={data.sellerName} saleCondition={saleConditionLabel(data.payments)} />

        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Cantidad</th>
              <th>Código</th>
              <th>Descripción</th>
              {withPrices && <th className="text-end">Importe</th>}
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{qty(item.quantity)}</td>
                <td className="mono">{item.skuSnapshot}</td>
                <td>{item.nameSnapshot}</td>
                {withPrices && <td className="text-end mono">{money(item.total)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="mono fw-semibold">{qty(units)}</td>
              <td colSpan={2} className="small text-muted-2">
                unidades en {data.items.length} {data.items.length === 1 ? 'renglón' : 'renglones'}
              </td>
              {withPrices && <td className="text-end mono fw-semibold">{money(data.total)}</td>}
            </tr>
          </tfoot>
        </table>

        <div className="invoice-signatures small">
          <div>Firma y aclaración de quien recibe</div>
          <div>DNI · Fecha y hora de recepción</div>
        </div>
        <p className="legal-note m-3">
          Documento interno de control de entrega, no válido como factura. La operación está documentada con la
          Factura {data.voucherClass ?? ''} de esta venta. Para el traslado de mercadería por terceros, rigen las
          normas de ARCA sobre remitos (remito electrónico o remito R con CAI).
        </p>
      </article>
    </>
  );
}
