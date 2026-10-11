'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { VoucherLetter } from '@/components/ui/VoucherLetter';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { cashApi, fiscalApi, personsApi, salesApi } from '@/lib/api/endpoints';
import type { CashRegister, CreateSaleReturnRequest, RefundMethod, SaleDetail, SaleReturn } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { cuit, dateTime, money, PAYMENT_LABEL, parseLocaleNumber, personName, qty, TAX_CONDITION_LABEL, toNumber, VAT_EXEMPTION_LABEL } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { FISCAL_STATUS, REFUND_METHOD_LABEL, RETURN_STATUS } from '@/lib/labels';

export default function SaleDetailPage() {
  return (
    <RequireCapability capability="sales.view">
      <SaleDetailView />
    </RequireCapability>
  );
}

function SaleDetailView() {
  const params = useParams<{ id: string }>();
  const saleId = params.id;
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const branchName = useBranchName();
  const [returnOpen, setReturnOpen] = useState(false);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);

  const sale = useApiQuery(() => salesApi.get(saleId), [saleId]);
  const returns = useApiQuery(() => salesApi.returns(saleId), [saleId]);
  const customerId = sale.data?.customerPersonId ?? null;
  const customer = useApiQuery(() => personsApi.get(customerId as string), [customerId], Boolean(customerId));

  if (sale.loading && !sale.data) return <Spinner label="Cargando venta…" />;
  if (sale.error || !sale.data) {
    return <ErrorAlert message={sale.status === 403 ? 'Tu rol no puede ver el detalle de ventas.' : sale.error ?? 'Venta no encontrada.'} onRetry={sale.reload} />;
  }
  const data = sale.data;
  const fiscal = FISCAL_STATUS[data.fiscalStatus];
  const returned = RETURN_STATUS[data.returnStatus];
  const canReturn = can('sales.return') && data.returnStatus !== 'FULL';

  const openInvoice = async () => {
    setBusyDoc('sale');
    try {
      // Emitir es idempotente: si ya está autorizada, ARCA no se vuelve a llamar y se devuelve el comprobante.
      const document = await fiscalApi.invoiceSale(data.id);
      if (document.status === 'AUTHORIZED') router.push(`/comprobantes/${document.id}`);
      else {
        toast.error('ARCA no autorizó el comprobante', document.errorMessage ?? undefined);
        sale.reload();
      }
    } catch (caught) {
      toast.error('No se pudo emitir la factura', errorMessage(caught));
    } finally {
      setBusyDoc(null);
    }
  };

  const creditNote = async (saleReturn: SaleReturn) => {
    setBusyDoc(saleReturn.id);
    try {
      const document = await fiscalApi.creditNote(saleReturn.id);
      if (document.status === 'AUTHORIZED') router.push(`/comprobantes/${document.id}`);
      else toast.error('ARCA no autorizó la nota de crédito', document.errorMessage ?? undefined);
      returns.reload();
    } catch (caught) {
      toast.error('No se pudo emitir la nota de crédito', errorMessage(caught));
    } finally {
      setBusyDoc(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={`Venta #${data.id.slice(0, 8)} · ${branchName(data.branchId)}`}
        title={money(data.total)}
        subtitle={dateTime(data.createdAt)}
        actions={
          <>
            <Link href="/ventas" className="btn btn-sm btn-light">
              <i className="bi bi-arrow-left me-1" aria-hidden="true" />
              Ventas
            </Link>
            {can('fiscal.issue') && data.voucherClass && (
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void openInvoice()} disabled={busyDoc !== null}>
                {busyDoc === 'sale' ? <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" /> : <i className="bi bi-receipt me-1" aria-hidden="true" />}
                {data.fiscalStatus === 'AUTHORIZED' ? 'Ver factura' : `Emitir factura ${data.voucherClass}`}
              </button>
            )}
            {canReturn && (
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setReturnOpen(true)}>
                <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
                Devolución
              </button>
            )}
          </>
        }
      />

      <div className="row g-3">
        <div className="col-xl-8">
          <Surface title="Artículos" padded={false}>
            <div className="table-responsive">
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Cant.</th>
                    <th className="num">Precio</th>
                    <th className="num">Desc.</th>
                    <th className="num">IVA</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="cell-title">{item.nameSnapshot}</div>
                        <div className="cell-sub">
                          <span className="mono">{item.skuSnapshot}</span>
                          {item.promotionName && <span className="ms-2 text-warning-emphasis"><i className="bi bi-stars me-1" aria-hidden="true" />{item.promotionName}</span>}
                        </div>
                      </td>
                      <td className="num">{qty(item.quantity)}</td>
                      <td className="num">{money(item.unitPrice)}</td>
                      <td className="num text-success">{toNumber(item.discountAmount) > 0 ? `−${money(item.discountAmount)}` : '—'}</td>
                      <td className="num text-muted-2">{toNumber(item.taxRate).toLocaleString('es-AR')} %</td>
                      <td className="num fw-semibold">{money(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="text-end text-muted-2">Neto gravado + exento + no gravado</td>
                    <td className="num">{money(toNumber(data.subtotal))}</td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="text-end text-muted-2">IVA</td>
                    <td className="num">{money(data.taxTotal)}</td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="text-end fw-semibold">Total</td>
                    <td className="num fw-semibold">{money(data.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Surface>

          {(returns.data?.length ?? 0) > 0 && (
            <Surface title="Devoluciones" padded={false} className="mt-3">
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>N.º</th>
                    <th>Fecha</th>
                    <th>Motivo</th>
                    <th>Reintegro</th>
                    <th className="num">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {returns.data?.map((item) => (
                    <tr key={item.id}>
                      <td className="mono">{item.number}</td>
                      <td>{dateTime(item.createdAt)}</td>
                      <td>
                        {item.reason}
                        {!item.restock && <div className="cell-sub">Sin reingreso a stock</div>}
                      </td>
                      <td>{REFUND_METHOD_LABEL[item.refundMethod]}</td>
                      <td className="num">{money(item.total)}</td>
                      <td className="text-end">
                        {can('fiscal.issue') && data.fiscalStatus === 'AUTHORIZED' && (
                          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void creditNote(item)} disabled={busyDoc !== null}>
                            {busyDoc === item.id && <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />}
                            {item.fiscalStatus === 'AUTHORIZED' ? 'Ver nota de crédito' : 'Emitir nota de crédito'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Surface>
          )}
        </div>

        <div className="col-xl-4 d-flex flex-column gap-3">
          <Surface>
            <div className="d-flex align-items-center gap-3">
              <VoucherLetter letter={data.voucherClass ?? '–'} size="md" />
              <div>
                <div className="fw-semibold text-ink">Factura {data.voucherClass ?? '—'}</div>
                <div className="d-flex flex-wrap gap-1 mt-1">
                  <StatusBadge tone={fiscal.tone}>{fiscal.label}</StatusBadge>
                  {returned && <StatusBadge tone={returned.tone}>{returned.label}</StatusBadge>}
                </div>
              </div>
            </div>
            {data.vatExemptionReason && (
              <div className="legal-note mt-3">Venta sin IVA por {VAT_EXEMPTION_LABEL[data.vatExemptionReason]}.</div>
            )}
            {data.fiscalNotes.fiscalTransparency && (
              <div className="legal-note mt-3">
                {data.fiscalNotes.fiscalTransparency.title}: IVA contenido <span className="mono">{money(data.fiscalNotes.fiscalTransparency.vatContained)}</span>
              </div>
            )}
            {data.fiscalNotes.legend && <div className="legal-note mt-3">{data.fiscalNotes.legend}</div>}
          </Surface>

          <Surface title="Cliente">
            {customer.data ? (
              <>
                <div className="fw-semibold text-ink">{personName(customer.data)}</div>
                <div className="small text-muted-2">{TAX_CONDITION_LABEL[customer.data.vatCondition]}</div>
                {customer.data.nationalId && <div className="small mono">{cuit(customer.data.nationalId)}</div>}
              </>
            ) : (
              <div className="text-muted-2">{customerId ? 'Cargando…' : 'Consumidor final'}</div>
            )}
          </Surface>

          <Surface title="Pagos">
            {data.payments.map((payment) => (
              <div key={payment.id} className="ticket-row">
                <span>{PAYMENT_LABEL[payment.method]}</span>
                <span className="value">{money(payment.amount)}</span>
              </div>
            ))}
            {toNumber(data.refundedTotal) > 0 && (
              <div className="ticket-row text-danger mt-2">
                <span>Reintegrado</span>
                <span className="value">−{money(data.refundedTotal)}</span>
              </div>
            )}
          </Surface>
        </div>
      </div>

      <ReturnModal
        open={returnOpen}
        sale={data}
        onClose={() => setReturnOpen(false)}
        onDone={() => {
          setReturnOpen(false);
          toast.success('Devolución registrada');
          sale.reload();
          returns.reload();
        }}
      />
    </>
  );
}

function ReturnModal({ open, sale, onClose, onDone }: { open: boolean; sale: SaleDetail; onClose: () => void; onDone: () => void }) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('CASH');
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [registerId, setRegisterId] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotency = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuantities({});
    setReason('');
    setError(null);
    cashApi
      .registers(sale.branchId)
      .then((list) => {
        setRegisters(list);
        setRegisterId(list.find((register) => register.openSession)?.id ?? '');
      })
      .catch(() => setRegisters([]));
  }, [open, sale.branchId]);

  const openRegisters = registers.filter((register) => register.openSession);
  const partialLines = Object.entries(quantities)
    .map(([saleItemId, value]) => ({ saleItemId, quantity: parseLocaleNumber(value) }))
    .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);

  const submit = async () => {
    if (reason.trim().length < 3) {
      setError('Indicá el motivo de la devolución.');
      return;
    }
    const register = openRegisters.find((item) => item.id === registerId);
    if (refundMethod === 'CASH' && !register?.openSession) {
      setError('Para reintegrar en efectivo tiene que haber una caja abierta en la sucursal de la venta.');
      return;
    }
    const body: CreateSaleReturnRequest = {
      lines: partialLines.length > 0 ? partialLines : undefined,
      reason: reason.trim(),
      restock,
      refundMethod,
      cashSessionId: refundMethod === 'CASH' ? register?.openSession?.id : undefined,
      externalReference: refundMethod === 'ORIGINAL_METHOD' && reference.trim() ? reference.trim() : undefined,
    };
    const signature = JSON.stringify(body);
    if (!idempotency.current || idempotency.current.signature !== signature) idempotency.current = { signature, key: newIdempotencyKey() };
    setBusy(true);
    setError(null);
    try {
      await salesApi.createReturn(sale.id, body, idempotency.current.key);
      idempotency.current = null;
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Registrar devolución"
      subtitle="Sin cantidades se devuelve todo lo pendiente. El stock vuelve a la sucursal si marcás reingreso."
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void submit()} disabled={busy}>
            {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
            {partialLines.length > 0 ? 'Devolver selección' : 'Devolver todo'}
          </button>
        </>
      }
    >
      <table className="table table-erp mb-3">
        <thead>
          <tr>
            <th>Producto</th>
            <th className="num">Vendido</th>
            <th className="num" style={{ width: 140 }}>
              A devolver
            </th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id}>
              <td>{item.nameSnapshot}</td>
              <td className="num">{qty(item.quantity)}</td>
              <td>
                <input
                  className="form-control form-control-sm mono text-end"
                  inputMode="decimal"
                  placeholder="0"
                  value={quantities[item.id] ?? ''}
                  onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                  aria-label={`Cantidad a devolver de ${item.nameSnapshot}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row g-3">
        <Field label="Motivo" className="col-12" required>
          <input className="form-control" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Ej.: producto fallado, cambio de talle" />
        </Field>
        <Field label="Reintegro" className="col-md-6">
          <select className="form-select" value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as RefundMethod)}>
            {(Object.keys(REFUND_METHOD_LABEL) as RefundMethod[]).map((method) => (
              <option key={method} value={method}>
                {REFUND_METHOD_LABEL[method]}
              </option>
            ))}
          </select>
        </Field>
        {refundMethod === 'CASH' && (
          <Field label="Caja" className="col-md-6">
            <select className="form-select" value={registerId} onChange={(event) => setRegisterId(event.target.value)}>
              {openRegisters.length === 0 && <option value="">Sin cajas abiertas</option>}
              {openRegisters.map((register) => (
                <option key={register.id} value={register.id}>
                  {register.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {refundMethod === 'ORIGINAL_METHOD' && (
          <Field label="Referencia del reverso" className="col-md-6" hint="N.º de operación de la tarjeta, transferencia o billetera.">
            <input className="form-control" value={reference} maxLength={100} onChange={(event) => setReference(event.target.value)} />
          </Field>
        )}
        <div className="col-12">
          <div className="form-check">
            <input id="restock" type="checkbox" className="form-check-input" checked={restock} onChange={(event) => setRestock(event.target.checked)} />
            <label htmlFor="restock" className="form-check-label small">
              Reingresar la mercadería al stock de la sucursal
            </label>
          </div>
        </div>
      </div>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
