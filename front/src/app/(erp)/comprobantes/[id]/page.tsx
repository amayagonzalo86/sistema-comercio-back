'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { CustomerBlock, DocumentHeader, saleConditionLabel } from '@/components/print/DocumentHeader';
import { RequireCapability } from '@/components/ui/Guard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { fiscalApi } from '@/lib/api/endpoints';
import type { PrintableFiscalDocument } from '@/lib/api/types';
import { ARCA_VAT_RATE, date, money, qty, toNumber, VOUCHER_TYPE_LABEL } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { DOCUMENT_STATUS } from '@/lib/labels';

/** Condición IVA del receptor (tabla FEParamGetCondicionIvaReceptor). */
const RECEIVER_CONDITION: Record<number, string> = {
  1: 'IVA Responsable Inscripto',
  4: 'IVA Sujeto Exento',
  5: 'Consumidor Final',
  6: 'Responsable Monotributo',
  7: 'Sujeto No Categorizado',
  8: 'Proveedor del Exterior',
  9: 'Cliente del Exterior',
  10: 'IVA Liberado – Ley 19.640',
  13: 'Monotributista Social',
  15: 'IVA No Alcanzado',
  16: 'Monotributo Trabajador Independiente Promovido',
};

export default function FiscalDocumentPage() {
  return (
    <RequireCapability capability="fiscal.view">
      <PrintableDocument />
    </RequireCapability>
  );
}

function PrintableDocument() {
  const { id } = useParams<{ id: string }>();
  const query = useApiQuery(() => fiscalApi.document(id), [id]);

  if (query.loading && !query.data) return <Spinner label="Cargando comprobante…" />;
  if (query.error || !query.data) return <ErrorAlert message={query.error ?? 'Comprobante no encontrado.'} onRetry={query.reload} />;
  return <InvoiceSheet data={query.data} />;
}

function InvoiceSheet({ data }: { data: PrintableFiscalDocument }) {
  const { document, issuer, items, formattedNumber, qrUrl, associated, receiver, operation } = data;
  const [qrImage, setQrImage] = useState<string | null>(null);
  const status = DOCUMENT_STATUS[document.status];
  const isClassA = document.voucherClass === 'A';

  useEffect(() => {
    if (!qrUrl) return;
    // El QR se genera en el navegador: la URL de ARCA no se envía a servicios de terceros.
    QRCode.toDataURL(qrUrl, { margin: 0, width: 220, errorCorrectionLevel: 'M' })
      .then(setQrImage)
      .catch(() => setQrImage(null));
  }, [qrUrl]);

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3 no-print">
        <Link href="/comprobantes" className="btn btn-sm btn-light">
          <i className="bi bi-arrow-left me-1" aria-hidden="true" />
          Comprobantes
        </Link>
        <div className="d-flex gap-2 align-items-center">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {document.environment === 'HOMOLOGATION' && <span className="env-badge homo">Homologación · sin validez fiscal</span>}
          <button type="button" className="btn btn-sm btn-primary" onClick={() => window.print()} disabled={document.status !== 'AUTHORIZED'}>
            <i className="bi bi-printer me-1" aria-hidden="true" />
            Imprimir / PDF
          </button>
        </div>
      </div>

      {document.status !== 'AUTHORIZED' && (
        <div className="alert alert-warning small no-print">
          <strong>Comprobante no autorizado.</strong> {document.errorMessage ?? 'ARCA todavía no otorgó el CAE.'}
          {document.observations?.map((observation) => (
            <div key={observation.code}>
              Obs. {observation.code}: {observation.message}
            </div>
          ))}
        </div>
      )}

      <article className="invoice-sheet">
        <div className="text-center fw-semibold border-bottom border-dark py-1" style={{ letterSpacing: '0.2em' }}>
          ORIGINAL
        </div>
        <DocumentHeader
          letterhead={issuer}
          letter={document.voucherClass}
          letterCode={document.voucherType}
          title={VOUCHER_TYPE_LABEL[document.voucherType]?.replace(/ [ABCE]$/, '') ?? 'Comprobante'}
          number={formattedNumber ?? '—'}
          issuedAt={date(document.issueDate)}
        />

        <CustomerBlock
          customer={receiver}
          sellerName={operation?.sellerName}
          saleCondition={operation ? saleConditionLabel(operation.payments) : 'Contado'}
          vatConditionLabel={RECEIVER_CONDITION[document.receiverConditionId] ?? `Código ${document.receiverConditionId}`}
          documentType={document.docType}
          documentNumber={document.docNumber}
        >
          {operation && <div>Cajero: <strong>{operation.cashierName ?? '—'}</strong></div>}
          {associated && (
            <div className="mt-1">
              Comprobante asociado: {VOUCHER_TYPE_LABEL[associated.voucherType] ?? associated.voucherType}{' '}
              <span className="mono">
                {String(associated.pointOfSale).padStart(5, '0')}-{String(associated.number ?? 0).padStart(8, '0')}
              </span>{' '}
              del {date(associated.issueDate)}
            </div>
          )}
        </CustomerBlock>

        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Producto / servicio</th>
              <th className="text-end">Cant.</th>
              {isClassA && <th className="text-end">Alíc. IVA</th>}
              <th className="text-end">{isClassA ? 'Subtotal neto' : 'Subtotal'}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const net = toNumber(item.netAmount) + toNumber(item.exemptAmount) + toNumber(item.notTaxedAmount);
              return (
                <tr key={item.id}>
                  <td className="mono">{item.skuSnapshot ?? ''}</td>
                  <td>{item.nameSnapshot ?? 'Ítem devuelto'}</td>
                  <td className="text-end mono">{qty(item.quantity)}</td>
                  {isClassA && <td className="text-end mono">{item.taxRate !== undefined ? `${toNumber(item.taxRate).toLocaleString('es-AR')} %` : '—'}</td>}
                  <td className="text-end mono">{money(isClassA ? net : item.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="invoice-block d-flex justify-content-end">
          <table style={{ width: 'auto', minWidth: 300 }}>
            <tbody>
              {isClassA && (
                <>
                  <tr>
                    <td>Importe neto gravado</td>
                    <td className="text-end mono">{money(document.netTaxed)}</td>
                  </tr>
                  {document.vatRates.map((rate) => (
                    <tr key={rate.arcaId}>
                      <td>IVA {ARCA_VAT_RATE[rate.arcaId] ?? ''}</td>
                      <td className="text-end mono">{money(rate.amount)}</td>
                    </tr>
                  ))}
                  {toNumber(document.exempt) > 0 && (
                    <tr>
                      <td>Importe exento</td>
                      <td className="text-end mono">{money(document.exempt)}</td>
                    </tr>
                  )}
                  {toNumber(document.notTaxed) > 0 && (
                    <tr>
                      <td>Importe no gravado</td>
                      <td className="text-end mono">{money(document.notTaxed)}</td>
                    </tr>
                  )}
                </>
              )}
              <tr>
                <td className="fw-bold fs-6">Importe total</td>
                <td className="text-end mono fw-bold fs-6">{money(document.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {document.voucherClass === 'B' && toNumber(document.vatTotal) > 0 && (
          <div className="invoice-block">
            <strong>Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</strong>
            <div>
              IVA contenido: <span className="mono">{money(document.vatTotal)}</span> · Otros impuestos nacionales indirectos: <span className="mono">{money(0)}</span>
            </div>
          </div>
        )}

        <div className="d-flex align-items-center gap-3 p-3">
          {qrImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrImage} alt="Código QR de ARCA para verificar el comprobante" width={110} height={110} />
          ) : (
            <div className="border d-flex align-items-center justify-content-center text-muted-2 small" style={{ width: 110, height: 110 }}>
              Sin QR
            </div>
          )}
          <div className="flex-grow-1">
            <div className="fw-bold">Comprobante autorizado</div>
            <div className="small">Esta administración federal no se responsabiliza por los datos ingresados en el detalle de la operación.</div>
          </div>
          <div className="text-end">
            <div>
              CAE n.º: <strong className="mono">{document.cae ?? '—'}</strong>
            </div>
            <div>
              Vto. de CAE: <strong className="mono">{date(document.caeExpiration)}</strong>
            </div>
          </div>
        </div>
      </article>
    </>
  );
}
