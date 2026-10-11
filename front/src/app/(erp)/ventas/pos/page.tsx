'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PersonFormModal } from '@/components/forms/PersonFormModal';
import { PersonPicker } from '@/components/forms/PersonPicker';
import { ProductSearch, type ProductSearchHandle } from '@/components/forms/ProductSearch';
import { EmptyState } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireBranch, RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { VoucherLetter } from '@/components/ui/VoucherLetter';
import { ApiError, errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { cashApi, fiscalApi, salesApi } from '@/lib/api/endpoints';
import type {
  CashRegister,
  FiscalDocument,
  Person,
  ProductListItem,
  QuoteSaleRequest,
  SaleDetail,
  SalePaymentMethod,
  SaleQuote,
  SaleVatExemption,
  UnitOfMeasure,
  VatExemptionReason,
} from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { money, PAYMENT_ICON, PAYMENT_SHORT, parseLocaleNumber, personName, qty, toDecimalString, toNumber, VAT_EXEMPTION_LABEL } from '@/lib/format';
import { useHotkey } from '@/lib/hooks/useHotkey';
import { usePersistentState } from '@/lib/hooks/usePersistentState';

interface CartLine {
  productId: string;
  sku: string;
  name: string;
  unit: UnitOfMeasure;
  listPrice: number;
  quantity: number;
}

interface PaymentRow {
  id: number;
  method: SalePaymentMethod;
  amount: string;
}

interface SaleResult {
  sale: SaleDetail;
  change: number;
  document: FiscalDocument | null;
  fiscalError: string | null;
}

const METHODS: SalePaymentMethod[] = ['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'QR', 'BANK_TRANSFER', 'OTHER'];
const UNIT_SHORT: Record<UnitOfMeasure, string> = { UNIT: 'u.', KG: 'kg', LITER: 'l', METER: 'm', PACK: 'pack' };

export default function PosPage() {
  return (
    <RequireCapability capability="pos.sell">
      <RequireBranch reason="El punto de venta cobra, descuenta stock y factura en una sucursal concreta.">{(branchId) => <PointOfSale branchId={branchId} />}</RequireBranch>
    </RequireCapability>
  );
}

function PointOfSale({ branchId }: { branchId: string }) {
  const { can, activeBranch } = useSession();
  const toast = useToast();
  const searchRef = useRef<ProductSearchHandle>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Person | null>(null);
  const [exemption, setExemption] = useState<SaleVatExemption | null>(null);
  const [quote, setQuote] = useState<SaleQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [customerModal, setCustomerModal] = useState(false);
  const [exemptionModal, setExemptionModal] = useState(false);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [autoInvoice, setAutoInvoice] = usePersistentState<boolean>('pos.autoInvoice', true);

  const request: QuoteSaleRequest | null = useMemo(
    () =>
      cart.length === 0
        ? null
        : {
            branchId,
            customerPersonId: customer?.id,
            lines: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
            vatExemption: exemption ?? undefined,
          },
    [cart, customer, exemption, branchId],
  );

  // Cotización en vivo: promociones vigentes, IVA, letra del comprobante y total exacto que se va a cobrar.
  useEffect(() => {
    if (!request) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setQuoting(true);
      salesApi
        .quote(request, controller.signal)
        .then((value) => {
          setQuote(value);
          setQuoteError(null);
        })
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) {
            setQuote(null);
            setQuoteError(errorMessage(caught));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoting(false);
        });
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [request]);

  useEffect(() => {
    setCart([]);
    setCustomer(null);
    setExemption(null);
  }, [branchId]);

  const addProduct = (product: ProductListItem) => {
    setResult(null);
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) return current.map((line) => (line.productId === product.id ? { ...line, quantity: round3(line.quantity + 1) } : line));
      return [
        ...current,
        { productId: product.id, sku: product.sku, name: product.name, unit: product.unitOfMeasure, listPrice: product.branch?.sellingPrice ?? 0, quantity: 1 },
      ];
    });
  };

  const setQuantity = (productId: string, quantity: number) => {
    if (!Number.isFinite(quantity)) return;
    if (quantity <= 0) setCart((current) => current.filter((line) => line.productId !== productId));
    else setCart((current) => current.map((line) => (line.productId === productId ? { ...line, quantity: round3(quantity) } : line)));
  };

  const clearSale = () => {
    setCart([]);
    setCustomer(null);
    setExemption(null);
    setQuote(null);
    searchRef.current?.focus();
  };

  const quoteLine = (productId: string) => quote?.lines.find((line) => line.productId === productId);
  const blockers: string[] = [];
  if (quote?.requiresCustomerCuit && !quote.customerCuitValid) blockers.push('El comprobante A requiere un cliente con CUIT válida.');
  if (quote?.lines.some((line) => !line.stockSufficient)) blockers.push('Hay productos sin stock suficiente en esta sucursal.');
  const canCharge = Boolean(quote) && !quoting && blockers.length === 0 && !quoteError;

  useHotkey('F2', () => searchRef.current?.focus());
  useHotkey('F9', () => canCharge && setPayOpen(true), !payOpen);
  useHotkey('F4', () => setCustomerModal(true), can('contacts.create') && !payOpen);

  return (
    <>
      <PageHeader
        eyebrow={`Punto de venta · ${activeBranch?.name ?? ''}`}
        title="Nueva venta"
        actions={
          <>
            {can('fiscal.issue') && (
              <div className="form-check form-switch mb-0 me-2">
                <input id="auto-invoice" className="form-check-input" type="checkbox" checked={autoInvoice} onChange={(event) => setAutoInvoice(event.target.checked)} />
                <label className="form-check-label small" htmlFor="auto-invoice">
                  Facturar en ARCA al cobrar
                </label>
              </div>
            )}
            <Link href="/caja" className="btn btn-sm btn-outline-secondary">
              <i className="bi bi-safe2 me-1" aria-hidden="true" />
              Caja
            </Link>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={clearSale} disabled={cart.length === 0}>
              <i className="bi bi-x-lg me-1" aria-hidden="true" />
              Anular
            </button>
          </>
        }
      />

      <div className="pos-grid">
        <div className="d-flex flex-column gap-3 min-w-0">
          <ProductSearch ref={searchRef} branchId={branchId} onPick={addProduct} large autoFocus shortcutHint="F2" />

          <section className="surface">
            <div className="surface-header">
              <h2>
                Detalle <span className="text-muted-2 fw-normal">· {cart.length} {cart.length === 1 ? 'artículo' : 'artículos'}</span>
              </h2>
              {quoting && <span className="small text-muted-2"><span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />Calculando…</span>}
            </div>
            {cart.length === 0 ? (
              <EmptyState icon="bi-upc-scan" title="Escaneá o buscá un producto">
                Usá el lector de código de barras o escribí nombre/SKU. <kbd className="k">F2</kbd> busca, <kbd className="k">F9</kbd> cobra.
              </EmptyState>
            ) : (
              <div>
                {cart.map((line) => {
                  const priced = quoteLine(line.productId);
                  const discount = toNumber(priced?.discount);
                  return (
                    <div key={line.productId} className="cart-line">
                      <div className="min-w-0">
                        <div className="text-ink fw-medium text-truncate">{line.name}</div>
                        <div className="small text-muted-2">
                          <span className="mono">{line.sku}</span> · {money(priced?.unitPrice ?? line.listPrice)} / {UNIT_SHORT[line.unit]}
                          {priced?.promotion && (
                            <span className="badge rounded-pill text-bg-warning ms-2">
                              <i className="bi bi-stars me-1" aria-hidden="true" />
                              {priced.promotion.name}
                            </span>
                          )}
                          {priced && !priced.stockSufficient && <span className="text-danger ms-2">Stock disponible: {qty(priced.availableStock)}</span>}
                        </div>
                      </div>
                      <div className="qty-stepper">
                        <button type="button" onClick={() => setQuantity(line.productId, line.quantity - 1)} aria-label="Restar">
                          <i className="bi bi-dash" />
                        </button>
                        <input
                          value={String(line.quantity).replace('.', ',')}
                          inputMode="decimal"
                          aria-label={`Cantidad de ${line.name}`}
                          onChange={(event) => {
                            const parsed = parseLocaleNumber(event.target.value);
                            if (!Number.isNaN(parsed)) setQuantity(line.productId, parsed);
                          }}
                        />
                        <button type="button" onClick={() => setQuantity(line.productId, line.quantity + 1)} aria-label="Sumar">
                          <i className="bi bi-plus" />
                        </button>
                      </div>
                      <div className="text-end line-total">
                        <div className="mono fw-semibold text-ink">{money(priced?.total ?? line.listPrice * line.quantity)}</div>
                        {discount > 0 && <div className="small text-success mono">−{money(discount)}</div>}
                      </div>
                      <button type="button" className="btn btn-sm btn-link text-muted-2 p-0" onClick={() => setQuantity(line.productId, 0)} aria-label={`Quitar ${line.name}`}>
                        <i className="bi bi-trash3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="ticket d-flex flex-column gap-3">
          <section className="surface surface-body">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="eyebrow">Cliente</span>
              {can('contacts.create') && (
                <button type="button" className="btn btn-sm btn-link p-0" onClick={() => setCustomerModal(true)}>
                  <i className="bi bi-person-plus me-1" aria-hidden="true" />
                  Nuevo <kbd className="k ms-1">F4</kbd>
                </button>
              )}
            </div>
            <PersonPicker role="customers" value={customer} onChange={setCustomer} placeholder="Consumidor final · buscar cliente…" clearLabel="Consumidor final" />
            {can('sales.vatExemption') && (
              <div className="mt-2">
                {exemption ? (
                  <div className="d-flex align-items-center justify-content-between small bg-warning-subtle rounded-2 px-2 py-1">
                    <span>
                      <i className="bi bi-shield-exclamation me-1" aria-hidden="true" />
                      Sin IVA: {VAT_EXEMPTION_LABEL[exemption.reason]}
                    </span>
                    <button type="button" className="btn btn-sm btn-link p-0" onClick={() => setExemption(null)}>
                      Quitar
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-sm btn-link p-0 text-muted-2" onClick={() => setExemptionModal(true)}>
                    <i className="bi bi-percent me-1" aria-hidden="true" />
                    Quitar IVA por causa legal
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="surface surface-body">
            <div className="d-flex align-items-center gap-3 mb-3">
              <VoucherLetter letter={quote?.voucherClass ?? '–'} size="md" />
              <div className="lh-sm">
                <div className="fw-semibold text-ink">{quote ? `Factura ${quote.voucherClass}` : 'Comprobante'}</div>
                <div className="small text-muted-2">{customer ? personName(customer) : 'Consumidor final'}</div>
              </div>
            </div>

            <div className="ticket-row">
              <span className="text-muted-2">Subtotal neto</span>
              <span className="value">{money(quote?.subtotal)}</span>
            </div>
            {toNumber(quote?.discountTotal) > 0 && (
              <div className="ticket-row text-success">
                <span>Ahorro en promociones (incluido)</span>
                <span className="value">{money(quote?.discountTotal)}</span>
              </div>
            )}
            {quote?.vatBreakdown.map((rate) => (
              <div key={rate.arcaVatRateId} className="ticket-row">
                <span className="text-muted-2">IVA {toNumber(rate.rate).toLocaleString('es-AR')} %</span>
                <span className="value">{money(rate.vat)}</span>
              </div>
            ))}

            <div className="ticket-total mt-3">
              <div className="label">Total a cobrar</div>
              <div className="amount">{money(quote?.total ?? 0)}</div>
            </div>

            {quote?.fiscalNotes.fiscalTransparency && (
              <div className="legal-note mt-3">
                <strong>{quote.fiscalNotes.fiscalTransparency.title}</strong>
                <br />
                IVA contenido: <span className="mono">{money(quote.fiscalNotes.fiscalTransparency.vatContained)}</span> · Otros impuestos nacionales indirectos:{' '}
                <span className="mono">{money(quote.fiscalNotes.fiscalTransparency.otherNationalIndirectTaxes)}</span>
              </div>
            )}
            {quote?.fiscalNotes.legend && <div className="legal-note mt-3">{quote.fiscalNotes.legend}</div>}

            {[...blockers, ...(quoteError ? [quoteError] : [])].map((message) => (
              <div key={message} className="alert alert-warning small py-2 mt-3 mb-0 d-flex gap-2">
                <i className="bi bi-exclamation-triangle" aria-hidden="true" />
                <span>{message}</span>
              </div>
            ))}

            <button type="button" className="btn btn-primary btn-lg w-100 mt-3 d-flex align-items-center justify-content-center gap-2" disabled={!canCharge} onClick={() => setPayOpen(true)}>
              <i className="bi bi-cash-coin" aria-hidden="true" />
              Cobrar
              <kbd className="k ms-1">F9</kbd>
            </button>
          </section>
        </aside>
      </div>

      {quote && request && (
        <PaymentModal
          open={payOpen}
          onClose={() => setPayOpen(false)}
          branchId={branchId}
          quote={quote}
          request={request}
          autoInvoice={autoInvoice && can('fiscal.issue')}
          canUseCash={can('cash.operate')}
          onDone={(saleResult) => {
            setPayOpen(false);
            setResult(saleResult);
            setCart([]);
            setCustomer(null);
            setExemption(null);
            toast.success('Venta registrada', saleResult.document?.status === 'AUTHORIZED' ? `CAE ${saleResult.document.cae ?? ''}` : undefined);
          }}
        />
      )}

      <SaleResultModal result={result} onClose={() => { setResult(null); searchRef.current?.focus(); }} onInvoiced={(document) => setResult((current) => (current ? { ...current, document, fiscalError: null } : current))} />

      <PersonFormModal
        open={customerModal}
        onClose={() => setCustomerModal(false)}
        onSaved={(person) => {
          setCustomerModal(false);
          setCustomer(person);
          toast.success('Cliente guardado', personName(person));
        }}
      />

      <ExemptionModal open={exemptionModal} onClose={() => setExemptionModal(false)} onApply={(value) => { setExemption(value); setExemptionModal(false); }} />
    </>
  );
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ── Cobro ───────────────────────────────────────────────────────

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  branchId: string;
  quote: SaleQuote;
  request: QuoteSaleRequest;
  autoInvoice: boolean;
  canUseCash: boolean;
  onDone: (result: SaleResult) => void;
}

function PaymentModal({ open, onClose, branchId, quote, request, autoInvoice, canUseCash, onDone }: PaymentModalProps) {
  const total = toNumber(quote.total);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [tendered, setTendered] = useState('');
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [registerId, setRegisterId] = usePersistentState<string>(`pos.register.${branchId}`, '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotency = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows([{ id: 1, method: canUseCash ? 'CASH' : 'DEBIT_CARD', amount: toDecimalString(total) }]);
    setTendered('');
    setError(null);
    if (canUseCash) {
      cashApi
        .registers(branchId)
        .then(setRegisters)
        .catch(() => setRegisters([]));
    }
  }, [open, total, branchId, canUseCash]);

  const openRegisters = registers.filter((register) => register.openSession);
  const selectedRegister = openRegisters.find((register) => register.id === registerId) ?? openRegisters[0];
  const paid = rows.reduce((sum, row) => sum + (Number.isNaN(parseLocaleNumber(row.amount)) ? 0 : parseLocaleNumber(row.amount)), 0);
  const remaining = Math.round((total - paid) * 100) / 100;
  const cashAmount = rows.filter((row) => row.method === 'CASH').reduce((sum, row) => sum + (parseLocaleNumber(row.amount) || 0), 0);
  const tenderedValue = parseLocaleNumber(tendered);
  const change = !Number.isNaN(tenderedValue) && tenderedValue > cashAmount ? Math.round((tenderedValue - cashAmount) * 100) / 100 : 0;
  const usesCash = rows.some((row) => row.method === 'CASH');
  const cashBlocked = usesCash && !selectedRegister;

  const updateRow = (id: number, patch: Partial<PaymentRow>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addSplit = () => {
    if (remaining <= 0) return;
    const used = new Set(rows.map((row) => row.method));
    const method = METHODS.find((item) => !used.has(item) && (item !== 'CASH' || canUseCash)) ?? 'OTHER';
    setRows((current) => [...current, { id: Date.now(), method, amount: toDecimalString(remaining) }]);
  };

  const confirm = async () => {
    if (Math.abs(remaining) >= 0.005) {
      setError(`Los pagos deben sumar exactamente ${money(total)}.`);
      return;
    }
    if (cashBlocked) {
      setError('No hay una caja abierta en esta sucursal para cobrar en efectivo.');
      return;
    }
    const body = {
      ...request,
      payments: rows
        .filter((row) => parseLocaleNumber(row.amount) > 0)
        .map((row) => ({
          method: row.method,
          amount: Number(toDecimalString(row.amount)),
          cashSessionId: row.method === 'CASH' ? selectedRegister?.openSession?.id : undefined,
        })),
    };
    // Misma operación = misma clave: si la red se corta y se reintenta, el backend no duplica la venta.
    const signature = JSON.stringify(body);
    if (!idempotency.current || idempotency.current.signature !== signature) idempotency.current = { signature, key: newIdempotencyKey() };

    setBusy(true);
    setError(null);
    try {
      const sale = await salesApi.create(body, idempotency.current.key);
      idempotency.current = null;
      if (selectedRegister) setRegisterId(selectedRegister.id);
      let document: FiscalDocument | null = null;
      let fiscalError: string | null = null;
      if (autoInvoice) {
        try {
          document = await fiscalApi.invoiceSale(sale.id);
          if (document.status !== 'AUTHORIZED') fiscalError = document.errorMessage ?? 'ARCA no autorizó el comprobante.';
        } catch (caught) {
          fiscalError = errorMessage(caught);
        }
      }
      onDone({ sale, change, document, fiscalError });
    } catch (caught) {
      const retryable = caught instanceof ApiError && (caught.isNetworkError || caught.status >= 500);
      setError(retryable ? `${errorMessage(caught)} Podés reintentar: la venta no se va a duplicar.` : errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="md"
      title="Cobrar venta"
      subtitle={`Factura ${quote.voucherClass} · ${quote.lines.length} artículos`}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Volver
          </button>
          <button type="button" className="btn btn-primary px-4" onClick={() => void confirm()} disabled={busy || Math.abs(remaining) >= 0.005 || cashBlocked} data-autofocus>
            {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : <i className="bi bi-check2-circle me-2" aria-hidden="true" />}
            Confirmar {money(total)}
          </button>
        </>
      }
    >
      <div className="ticket-total mb-3" style={{ background: 'var(--ink-900)', color: '#fff', borderRadius: '0.6rem', padding: '0.9rem 1rem' }}>
        <div className="small text-uppercase" style={{ color: 'var(--ink-300)', letterSpacing: '0.08em' }}>
          Total
        </div>
        <div className="mono fs-2 fw-semibold">{money(total)}</div>
      </div>

      {rows.map((row, index) => (
        <div key={row.id} className="mb-3">
          <div className="row g-2 mb-2">
            {METHODS.map((method) => (
              <div key={method} className="col-4 col-md-2">
                <button
                  type="button"
                  className={`pay-method ${row.method === method ? 'selected' : ''}`}
                  disabled={method === 'CASH' && !canUseCash}
                  onClick={() => updateRow(row.id, { method })}
                  title={method === 'CASH' && !canUseCash ? 'Tu rol no opera caja' : undefined}
                >
                  <i className={`bi ${PAYMENT_ICON[method]}`} aria-hidden="true" />
                  {PAYMENT_SHORT[method]}
                </button>
              </div>
            ))}
          </div>
          <div className="input-group">
            <span className="input-group-text">$</span>
            <input className="form-control mono" inputMode="decimal" value={row.amount} onChange={(event) => updateRow(row.id, { amount: event.target.value })} aria-label={`Importe ${index + 1}`} />
            {rows.length > 1 && (
              <button type="button" className="btn btn-outline-secondary" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} aria-label="Quitar pago">
                <i className="bi bi-x-lg" />
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="d-flex justify-content-between align-items-center mb-3">
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={addSplit} disabled={remaining <= 0}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />
          Dividir pago
        </button>
        <span className={`small mono ${Math.abs(remaining) < 0.005 ? 'text-success' : 'text-danger'}`}>
          {Math.abs(remaining) < 0.005 ? 'Pagos completos' : remaining > 0 ? `Falta ${money(remaining)}` : `Sobra ${money(-remaining)}`}
        </span>
      </div>

      {usesCash && (
        <div className="border rounded-3 p-3 bg-light-subtle">
          {openRegisters.length > 1 && (
            <Field label="Caja" className="mb-2">
              <select className="form-select form-select-sm" value={selectedRegister?.id ?? ''} onChange={(event) => setRegisterId(event.target.value)}>
                {openRegisters.map((register) => (
                  <option key={register.id} value={register.id}>
                    {register.name} ({register.code})
                  </option>
                ))}
              </select>
            </Field>
          )}
          {selectedRegister ? (
            <div className="row g-2 align-items-end">
              <Field label="Paga con" className="col-7">
                <div className="input-group input-group-sm">
                  <span className="input-group-text">$</span>
                  <input className="form-control mono" inputMode="decimal" value={tendered} onChange={(event) => setTendered(event.target.value)} placeholder={toDecimalString(cashAmount)} />
                </div>
              </Field>
              <div className="col-5 text-end">
                <div className="small text-muted-2">Vuelto</div>
                <div className="mono fs-5 fw-semibold text-ink">{money(change)}</div>
              </div>
              <div className="col-12 small text-muted-2">
                <i className="bi bi-safe2 me-1" aria-hidden="true" />
                Se imputa a {selectedRegister.name}
              </div>
            </div>
          ) : (
            <div className="small text-danger">
              <i className="bi bi-exclamation-circle me-1" aria-hidden="true" />
              No hay caja abierta en esta sucursal. <Link href="/caja">Abrí una caja</Link> o cobrá con otro medio.
            </div>
          )}
        </div>
      )}

      {autoInvoice && <div className="form-hint mt-3"><i className="bi bi-receipt me-1" aria-hidden="true" />Al confirmar se solicitará el CAE a ARCA.</div>}
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}

// ── Resultado ───────────────────────────────────────────────────

function SaleResultModal({ result, onClose, onInvoiced }: { result: SaleResult | null; onClose: () => void; onInvoiced: (document: FiscalDocument) => void }) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(result?.fiscalError ?? null), [result]);

  if (!result) return null;
  const { sale, change, document } = result;
  const authorized = document?.status === 'AUTHORIZED';

  const invoice = async () => {
    setBusy(true);
    setError(null);
    try {
      const issued = await fiscalApi.invoiceSale(sale.id);
      if (issued.status === 'AUTHORIZED') onInvoiced(issued);
      else setError(issued.errorMessage ?? 'ARCA no autorizó el comprobante. Revisá las observaciones en Comprobantes.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      size="sm"
      title="Venta registrada"
      footer={
        <>
          <Link href={`/ventas/${sale.id}`} className="btn btn-light">
            Ver venta
          </Link>
          <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>
            Nueva venta
          </button>
        </>
      }
    >
      <div className="text-center mb-3">
        <div className="avatar mx-auto mb-2" style={{ width: 48, height: 48, background: 'var(--verde)' }}>
          <i className="bi bi-check-lg fs-4" aria-hidden="true" />
        </div>
        <div className="mono fs-3 fw-semibold text-ink">{money(sale.total)}</div>
        {change > 0 && (
          <div className="mt-1">
            Vuelto: <span className="mono fw-semibold">{money(change)}</span>
          </div>
        )}
      </div>

      {authorized && document ? (
        <div className="border rounded-3 p-3 d-flex align-items-center gap-3">
          <VoucherLetter letter={document.voucherClass} size="md" />
          <div className="small flex-grow-1">
            <div className="fw-semibold text-ink">
              {String(document.pointOfSale).padStart(5, '0')}-{String(document.number ?? 0).padStart(8, '0')}
            </div>
            <div className="text-muted-2">
              CAE <span className="mono">{document.cae}</span>
            </div>
          </div>
          <Link href={`/comprobantes/${document.id}`} className="btn btn-sm btn-outline-primary">
            <i className="bi bi-printer me-1" aria-hidden="true" />
            Imprimir
          </Link>
        </div>
      ) : (
        can('fiscal.issue') && (
          <div className="border rounded-3 p-3">
            <div className="small text-muted-2 mb-2">{error ? 'La factura quedó pendiente. La venta está registrada y se puede facturar más tarde.' : 'Venta sin factura electrónica.'}</div>
            {error && <div className="alert alert-warning small py-2">{error}</div>}
            <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={() => void invoice()} disabled={busy}>
              {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : <i className="bi bi-receipt me-2" aria-hidden="true" />}
              Emitir factura {sale.voucherClass ?? ''} en ARCA
            </button>
          </div>
        )
      )}
    </Modal>
  );
}

// ── Quitar IVA por causa legal (solo titular / administración) ─────

function ExemptionModal({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (value: SaleVatExemption) => void }) {
  const [reason, setReason] = useState<VatExemptionReason>('EXPORT');
  const [note, setNote] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Quitar IVA de la venta"
      subtitle="Queda registrado en la venta y en la auditoría."
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-warning" disabled={note.trim().length < 5} onClick={() => onApply({ reason, note: note.trim() })}>
            Aplicar
          </button>
        </>
      }
    >
      <Field label="Causa legal" className="mb-3">
        <select className="form-select" value={reason} onChange={(event) => setReason(event.target.value as VatExemptionReason)}>
          {(Object.keys(VAT_EXEMPTION_LABEL) as VatExemptionReason[]).map((key) => (
            <option key={key} value={key}>
              {VAT_EXEMPTION_LABEL[key]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Respaldo documental" hint="Ej.: número de permiso de embarque, resolución o certificado. Mínimo 5 caracteres.">
        <textarea className="form-control" rows={3} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </Modal>
  );
}
