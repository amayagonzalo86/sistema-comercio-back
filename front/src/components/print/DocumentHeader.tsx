import type { ReactNode } from 'react';
import { VoucherLetter } from '@/components/ui/VoucherLetter';
import { fiscalApi } from '@/lib/api/endpoints';
import type { DocumentType, Letterhead, PrintCustomer, SalePaymentMethod, TaxCondition, Uuid } from '@/lib/api/types';
import { cuit, date, DOCUMENT_TYPE_LABEL, money, PAYMENT_LABEL, TAX_CONDITION_LABEL } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

/** Encabezado de la empresa para la sucursal indicada (presupuestos y remitos X). */
export function useLetterhead(branchId: Uuid | null | undefined) {
  return useApiQuery(() => fiscalApi.letterhead(branchId), [branchId ?? ''], Boolean(branchId));
}

const join = (parts: Array<string | null | undefined>, separator: string) => parts.filter((part) => part && part.trim()).join(separator);

function conditionLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return TAX_CONDITION_LABEL[code as TaxCondition] ?? code;
}

/**
 * Encabezado común de los comprobantes (factura A/B/C, remito X, presupuesto X):
 *   empresa · domicilio · localidad - provincia · responsabilidad y teléfono   |  letra  |  tipo · n.º · fecha · CUIT e IIBB · inicio de actividad
 */
export function DocumentHeader({
  letterhead,
  fallbackName,
  letter,
  letterCode,
  letterNote,
  title,
  subtitle,
  number,
  issuedAt,
  extra,
}: {
  letterhead: Letterhead | null | undefined;
  /** Nombre a mostrar mientras no se cargó el encabezado (o si la empresa no completó sus datos). */
  fallbackName?: string | null;
  letter: string;
  /** Código ARCA del comprobante (se imprime "COD. 001" bajo la letra). */
  letterCode?: number;
  /** Leyenda bajo la letra, por ejemplo "No válido como factura". */
  letterNote?: string;
  /** Factura, Nota de crédito, Remito, Presupuesto… */
  title: string;
  subtitle?: string;
  number: ReactNode;
  issuedAt: string;
  extra?: ReactNode;
}) {
  const location = join([letterhead?.city, letterhead?.province], ' - ');
  return (
    <div className="invoice-head">
      <div>
        <div className="fs-5 fw-bold lh-sm">{letterhead?.name || fallbackName || '—'}</div>
        {letterhead && letterhead.legalName !== letterhead.name && <div className="small">{letterhead.legalName}</div>}
        <div>{letterhead?.address ?? ''}</div>
        <div>{location}</div>
        <div className="d-flex flex-wrap column-gap-3">
          <span>{conditionLabel(letterhead?.vatCondition)}</span>
          {letterhead?.phone && <span>Tel.: {letterhead.phone}</span>}
        </div>
      </div>
      <div className="invoice-letter-col">
        <VoucherLetter letter={letter} code={letterCode} size="lg" />
        {letterNote && <div className="invoice-letter-note">{letterNote}</div>}
      </div>
      <div>
        <div className="fs-5 fw-bold text-uppercase lh-sm">{title}</div>
        {subtitle && <div className="small">{subtitle}</div>}
        <div>
          N.º: <strong className="mono">{number}</strong>
        </div>
        <div>Fecha: {issuedAt}</div>
        <div>
          CUIT: <span className="mono">{cuit(letterhead?.cuit)}</span>
          <span className="ms-2">IIBB: {letterhead?.grossIncomeRegistration ?? '—'}</span>
        </div>
        <div>Inicio de actividad: {date(letterhead?.activityStartDate)}</div>
        {extra}
      </div>
    </div>
  );
}

/** "Contado · Efectivo $ 1.000 / Débito $ 500" a partir de los pagos de la venta. */
export function saleConditionLabel(payments: Array<{ method: SalePaymentMethod; amount: string | number }> | null | undefined): string {
  if (!payments || payments.length === 0) return 'Contado';
  const detail = payments.map((payment) => (payments.length > 1 ? `${PAYMENT_LABEL[payment.method]} ${money(payment.amount)}` : PAYMENT_LABEL[payment.method]));
  return `Contado · ${detail.join(' / ')}`;
}

function documentLine(documentType: DocumentType | number | null | undefined, number: string | null | undefined): { label: string; value: string } {
  if (!number || number === '0') return { label: 'DNI', value: '—' };
  if (documentType === 80 || documentType === 86) return { label: DOCUMENT_TYPE_LABEL[documentType as DocumentType], value: cuit(number) };
  if (documentType === 96 || documentType === 94) return { label: DOCUMENT_TYPE_LABEL[documentType as DocumentType], value: number };
  return { label: 'Doc.', value: number };
}

/**
 * Bloque de datos del cliente:
 *   Señor · Cuenta / Dirección - localidad - provincia / IVA · DNI · Vendedor / Cond. de Vta.
 */
export function CustomerBlock({
  customer,
  sellerName,
  saleCondition,
  vatConditionLabel,
  documentType,
  documentNumber,
  children,
}: {
  customer: PrintCustomer | null | undefined;
  sellerName?: string | null;
  saleCondition?: string | null;
  /** Condición IVA tal como se informó a ARCA (factura); si no, la del cliente. */
  vatConditionLabel?: string;
  /** Documento informado a ARCA (factura); si no, el del cliente. */
  documentType?: DocumentType | number | null;
  documentNumber?: string | null;
  children?: ReactNode;
}) {
  const doc = documentLine(documentType ?? customer?.documentType ?? null, documentNumber ?? customer?.nationalId ?? null);
  const address = join([customer?.address, customer?.city, customer?.province], ' - ');
  return (
    <div className="invoice-block invoice-customer">
      <div className="row g-1">
        <div className="col-8">
          Señor: <strong>{customer?.name ?? 'Consumidor final'}</strong>
        </div>
        <div className="col-4">
          Cuenta: <span className="mono">{customer?.accountNumber ?? '—'}</span>
        </div>
        <div className="col-12">Dirección: {address || '—'}</div>
        <div className="col-4">IVA: {vatConditionLabel ?? TAX_CONDITION_LABEL[customer?.vatCondition ?? 'CONSUMIDOR_FINAL']}</div>
        <div className="col-4">
          {doc.label}: <span className="mono">{doc.value}</span>
        </div>
        <div className="col-4">
          Vendedor: <strong>{sellerName ?? '—'}</strong>
        </div>
        <div className="col-12">Cond. de Vta.: {saleCondition ?? 'Contado'}</div>
      </div>
      {children}
    </div>
  );
}
