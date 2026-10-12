'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { VoucherLetter } from '@/components/ui/VoucherLetter';
import { fiscalApi } from '@/lib/api/endpoints';
import type { PrintableFiscalDocument } from '@/lib/api/types';
import { ARCA_VAT_RATE, cuit, date, money, qty, TAX_CONDITION_LABEL, toNumber, VOUCHER_TYPE_LABEL } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { DOCUMENT_STATUS } from '@/lib/labels';

/** Código de documento ARCA → nombre para el receptor. */
const DOC_TYPE: Record<number, string> = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 94: 'Pasaporte', 99: 'Consumidor final' };
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
  const { document, issuer, items, formattedNumber, qrUrl, associated, receiver } = data;
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
        <div className="invoice-head">
          <div>
            <div className="fs-5 fw-bold">{issuer?.legalName ?? '—'}</div>
            <div>{issuer?.commercialAddress ?? ''}</div>
            <div>Condición frente al IVA: {issuer ? TAX_CONDITION_LABEL[issuer.vatCondition as keyof typeof TAX_CONDITION_LABEL] ?? issuer.vatCondition : '—'}</div>
          </div>
          <div className="invoice-letter-col">
            <VoucherLetter letter={document.voucherClass} code={document.voucherType} size="lg" />
          </div>
          <div>
            <div className="fs-5 fw-bold text-uppercase">{VOUCHER_TYPE_LABEL[document.voucherType]?.replace(/ [ABCE]$/, '') ?? 'Comprobante'}</div>
            <div>
              Punto de venta y n.º: <strong className="mono">{formattedNumber ?? '—'}</strong>
            </div>
            <div>Fecha de emisión: {date(document.issueDate)}</div>
            <div>CUIT: <span className="mono">{cuit(issuer?.cuit)}</span></div>
            <div>Ingresos Brutos: {issuer?.grossIncomeRegistration ?? '—'}</div>
            <div>Inicio de actividades: {date(issuer?.activityStartDate)}</div>
          </div>
        </div>

        <div className="invoice-block">
          <div className="mb-1">
            Apellido y nombre / Razón social: <strong>{receiver?.name ?? 'Consumidor final'}</strong>
            {receiver?.address && <span> · Domicilio: {receiver.address}</span>}
          </div>
          <div className="row">
            <div className="col-7">
              {DOC_TYPE[document.docType] ?? 'Doc.'}: <span className="mono">{document.docType === 80 || document.docType === 86 ? cuit(document.docNumber) : document.docNumber === '0' ? '—' : document.docNumber}</span>
            </div>
            <div className="col-5">Condición frente al IVA: {RECEIVER_CONDITION[document.receiverConditionId] ?? `Código ${document.receiverConditionId}`}</div>
          </div>
          {associated && (
            <div className="mt-1">
              Comprobante asociado: {VOUCHER_TYPE_LABEL[associated.voucherType] ?? associated.voucherType}{' '}
              <span className="mono">
                {String(associated.pointOfSale).padStart(5, '0')}-{String(associated.number ?? 0).padStart(8, '0')}
              </span>{' '}
              del {date(associated.issueDate)}
            </div>
          )}
        </div>

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
