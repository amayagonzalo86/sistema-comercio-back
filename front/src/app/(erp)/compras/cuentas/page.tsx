'use client';

import { useEffect, useRef, useState } from 'react';
import { PersonPicker } from '@/components/forms/PersonPicker';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { KpiCard } from '@/components/ui/KpiCard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { cashApi, payablesApi } from '@/lib/api/endpoints';
import type { CashRegister, Person, SupplierPayable, SupplierPaymentMethod } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { date, int, money, parseLocaleNumber, todayLocal, toNumber } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { usePersonNames } from '@/lib/hooks/usePersonNames';
import { PAYABLE_STATUS } from '@/lib/labels';

const METHOD_LABEL: Record<SupplierPaymentMethod, string> = {
  BANK_TRANSFER: 'Transferencia',
  CASH: 'Efectivo de caja',
  CHECK: 'Cheque / e-cheq',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
};

export default function PayablesPage() {
  return (
    <RequireCapability capability="payables.manage">
      <Payables />
    </RequireCapability>
  );
}

function Payables() {
  const toast = useToast();
  const { activeBranchId } = useSession();
  const branchName = useBranchName();
  const supplierName = usePersonNames('suppliers');
  const [supplier, setSupplier] = useState<Person | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<SupplierPayable[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const page = useApiQuery(
    () => payablesApi.list({ supplierPersonId: supplier?.id, branchId: activeBranchId ?? undefined, limit: 50, cursor }),
    [supplier?.id, activeBranchId, cursor],
  );

  useEffect(() => {
    const data = page.data;
    if (!data) return;
    setItems((current) => (cursor ? [...current, ...data.items] : data.items));
  }, [page.data, cursor]);

  const reset = () => {
    setCursor(undefined);
    setSelected([]);
  };

  const visible = items.filter((item) => !onlyOpen || item.status !== 'PAID');
  const today = todayLocal();
  const outstanding = visible.reduce((sum, item) => sum + toNumber(item.outstanding), 0);
  const overdue = visible.filter((item) => item.dueDate && item.dueDate < today && item.status !== 'PAID').reduce((sum, item) => sum + toNumber(item.outstanding), 0);
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const sameGroup = selectedItems.every((item) => item.supplierPersonId === selectedItems[0]?.supplierPersonId && item.branchId === selectedItems[0]?.branchId);

  return (
    <>
      <PageHeader
        eyebrow="Compras"
        title="Cuentas a pagar"
        subtitle="Deuda con proveedores por recepción, vencimientos y pagos con imputación."
        actions={
          <button type="button" className="btn btn-sm btn-primary" disabled={selectedItems.length === 0 || !sameGroup} onClick={() => setPayOpen(true)} title={!sameGroup ? 'Seleccioná deudas del mismo proveedor y sucursal' : undefined}>
            <i className="bi bi-cash-coin me-1" aria-hidden="true" />
            Registrar pago {selectedItems.length > 0 && `(${selectedItems.length})`}
          </button>
        }
      />
      <div className="row g-3 mb-3">
        <div className="col-md-4"><KpiCard label="Saldo pendiente (vista)" icon="bi-wallet2" value={money(outstanding)} /></div>
        <div className="col-md-4"><KpiCard label="Vencido" icon="bi-alarm" value={<span className={overdue > 0 ? 'text-danger' : ''}>{money(overdue)}</span>} /></div>
        <div className="col-md-4"><KpiCard label="Comprobantes" icon="bi-files" value={int(visible.length)} /></div>
      </div>
      <section className="surface">
        <div className="toolbar">
          <div style={{ minWidth: 320 }}>
            <PersonPicker role="suppliers" value={supplier} onChange={(person) => { setSupplier(person); reset(); }} placeholder="Filtrar por proveedor…" clearLabel="Todos" />
          </div>
          <div className="form-check form-switch mb-0">
            <input id="open" className="form-check-input" type="checkbox" checked={onlyOpen} onChange={(event) => setOnlyOpen(event.target.checked)} />
            <label htmlFor="open" className="form-check-label small">Solo impagas</label>
          </div>
        </div>
        {page.error && <div className="p-3 pb-0"><ErrorAlert message={page.error} onRetry={page.reload} /></div>}
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Proveedor</th>
                <th>Sucursal</th>
                <th>Alta</th>
                <th>Vence</th>
                <th>Estado</th>
                <th className="num">Original</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            {page.loading && items.length === 0 ? (
              <SkeletonRows columns={8} />
            ) : visible.length === 0 ? (
              <TableMessage colSpan={8}><EmptyState icon="bi-emoji-smile" title="No hay deudas pendientes" /></TableMessage>
            ) : (
              <tbody>
                {visible.map((item) => {
                  const isOverdue = Boolean(item.dueDate && item.dueDate < today && item.status !== 'PAID');
                  return (
                    <tr key={item.id}>
                      <td>
                        <input type="checkbox" className="form-check-input" disabled={item.status === 'PAID'} checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => (event.target.checked ? [...current, item.id] : current.filter((value) => value !== item.id)))} aria-label="Seleccionar" />
                      </td>
                      <td className="cell-title">{supplierName(item.supplierPersonId)}</td>
                      <td>{branchName(item.branchId)}</td>
                      <td>{date(item.createdAt)}</td>
                      <td className={isOverdue ? 'text-danger fw-semibold' : ''}>{item.dueDate ? date(item.dueDate) : '—'}</td>
                      <td><StatusBadge tone={isOverdue ? 'red' : PAYABLE_STATUS[item.status].tone}>{isOverdue ? 'Vencida' : PAYABLE_STATUS[item.status].label}</StatusBadge></td>
                      <td className="num text-muted-2">{money(item.originalAmount)}</td>
                      <td className="num fw-semibold">{money(item.outstanding)}</td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
        {page.data?.nextCursor && (
          <div className="p-2 text-center border-top">
            <button type="button" className="btn btn-sm btn-light" onClick={() => setCursor(page.data?.nextCursor ?? undefined)} disabled={page.loading}>Cargar más</button>
          </div>
        )}
      </section>
      {payOpen && selectedItems.length > 0 && (
        <PaymentModal
          payables={selectedItems}
          onClose={() => setPayOpen(false)}
          onPaid={() => {
            setPayOpen(false);
            toast.success('Pago registrado');
            reset();
            page.reload();
          }}
        />
      )}
    </>
  );
}

function PaymentModal({ payables, onClose, onPaid }: { payables: SupplierPayable[]; onClose: () => void; onPaid: () => void }) {
  const branchId = payables[0]?.branchId ?? '';
  const [method, setMethod] = useState<SupplierPaymentMethod>('BANK_TRANSFER');
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(payables.map((item) => [item.id, String(toNumber(item.outstanding))])));
  const [reference, setReference] = useState('');
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    if (method === 'CASH') cashApi.registers(branchId).then(setRegisters).catch(() => setRegisters([]));
  }, [method, branchId]);

  const session = registers.find((register) => register.openSession)?.openSession ?? null;
  const total = payables.reduce((sum, item) => sum + (parseLocaleNumber(amounts[item.id] ?? '') || 0), 0);

  const submit = async () => {
    const allocations = payables.map((item) => ({ payableId: item.id, amount: Math.round((parseLocaleNumber(amounts[item.id] ?? '') || 0) * 100) / 100 })).filter((item) => item.amount > 0);
    if (allocations.length === 0) return setError('Ingresá al menos un importe.');
    if (allocations.some((allocation) => allocation.amount > toNumber(payables.find((item) => item.id === allocation.payableId)?.outstanding) + 0.001)) return setError('Un importe supera el saldo del comprobante.');
    if (method === 'CASH' && !session) return setError('No hay caja abierta en la sucursal para pagar en efectivo.');
    const body = { branchId, supplierPersonId: payables[0]?.supplierPersonId ?? '', method, cashSessionId: method === 'CASH' ? session?.id : undefined, externalReference: reference.trim() || undefined, allocations };
    const signature = JSON.stringify(body);
    if (!key.current || key.current.signature !== signature) key.current = { signature, key: newIdempotencyKey() };
    setBusy(true);
    setError(null);
    try {
      await payablesApi.pay(body, key.current.key);
      key.current = null;
      onPaid();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} busy={busy} size="md" title="Registrar pago a proveedor" subtitle={`${payables.length} comprobantes · total ${money(total)}`} footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}Pagar {money(total)}</button></>}>
      <div className="row g-3 mb-3">
        <Field label="Medio de pago" className="col-md-6">
          <select className="form-select" value={method} onChange={(event) => setMethod(event.target.value as SupplierPaymentMethod)}>
            {(Object.keys(METHOD_LABEL) as SupplierPaymentMethod[]).map((key) => <option key={key} value={key}>{METHOD_LABEL[key]}</option>)}
          </select>
        </Field>
        <Field label="Referencia" className="col-md-6" hint="N.º de transferencia o cheque.">
          <input className="form-control" value={reference} maxLength={100} onChange={(event) => setReference(event.target.value)} />
        </Field>
      </div>
      {method === 'CASH' && !session && <div className="alert alert-warning small py-2">No hay una caja abierta en esta sucursal.</div>}
      <table className="table table-erp">
        <thead>
          <tr>
            <th>Comprobante</th>
            <th className="num">Saldo</th>
            <th className="num" style={{ width: 150 }}>A pagar</th>
          </tr>
        </thead>
        <tbody>
          {payables.map((item) => (
            <tr key={item.id}>
              <td>{date(item.createdAt)}{item.dueDate && <div className="cell-sub">Vence {date(item.dueDate)}</div>}</td>
              <td className="num">{money(item.outstanding)}</td>
              <td><input className="form-control form-control-sm mono text-end" inputMode="decimal" value={amounts[item.id] ?? ''} onChange={(event) => setAmounts((current) => ({ ...current, [item.id]: event.target.value }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
