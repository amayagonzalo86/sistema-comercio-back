'use client';

import { useRef, useState } from 'react';
import { EmptyState, ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireBranch, RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { cashApi } from '@/lib/api/endpoints';
import type { CashMovement, CashMovementType, CashRegister, CashSession } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { dateTime, money, parseLocaleNumber, time, toDecimalString, toNumber } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

const MOVEMENT_LABEL: Record<CashMovementType, string> = {
  OPENING: 'Apertura',
  SALE: 'Venta',
  REFUND: 'Devolución',
  INCOME: 'Ingreso',
  EXPENSE: 'Egreso',
  ADJUSTMENT: 'Ajuste',
};

/** Clave estable por operación: un doble clic o un reintento tras corte de red no duplica el movimiento. */
function useOperationKey() {
  const ref = useRef<{ signature: string; key: string } | null>(null);
  return {
    keyFor: (signature: string) => {
      if (!ref.current || ref.current.signature !== signature) ref.current = { signature, key: newIdempotencyKey() };
      return ref.current.key;
    },
    reset: () => {
      ref.current = null;
    },
  };
}

export default function CashPage() {
  return (
    <RequireCapability capability="cash.operate">
      <RequireBranch reason="Cada caja pertenece a una sucursal: elegí en cuál vas a operar.">{(branchId) => <CashDesk branchId={branchId} />}</RequireBranch>
    </RequireCapability>
  );
}

function CashDesk({ branchId }: { branchId: string }) {
  const { can, activeBranch } = useSession();
  const toast = useToast();
  const registers = useApiQuery(() => cashApi.registers(branchId), [branchId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const list = registers.data ?? [];
  const selected = list.find((register) => register.id === selectedId) ?? list[0] ?? null;

  return (
    <>
      <PageHeader
        eyebrow={`Tesorería · ${activeBranch?.name ?? ''}`}
        title="Caja"
        subtitle="Apertura, ingresos y egresos, y cierre con arqueo. Cada movimiento queda auditado."
        actions={
          can('cash.manageRegisters') && (
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setCreateOpen(true)}>
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              Nueva caja
            </button>
          )
        }
      />

      {registers.error && <ErrorAlert message={registers.error} onRetry={registers.reload} />}
      {registers.loading && !registers.data && <Spinner />}

      {registers.data && list.length === 0 && (
        <div className="surface">
          <EmptyState icon="bi-safe2" title="Esta sucursal todavía no tiene cajas" action={can('cash.manageRegisters') && <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>Crear la primera caja</button>}>
            Creá una caja por cada puesto de cobro (por ejemplo, Caja 1 y Caja 2).
          </EmptyState>
        </div>
      )}

      {list.length > 0 && (
        <div className="row g-3">
          <div className="col-lg-4 col-xl-3">
            <div className="d-flex flex-column gap-2">
              {list.map((register) => (
                <button
                  key={register.id}
                  type="button"
                  className={`ops-tile text-start w-100 ${selected?.id === register.id ? 'border-primary' : ''}`}
                  style={selected?.id === register.id ? { boxShadow: '0 0 0 1px var(--belgrano) inset' } : undefined}
                  onClick={() => setSelectedId(register.id)}
                >
                  <span className={`ops-icon ${register.openSession ? 'tone-green' : 'tone-slate'}`}>
                    <i className="bi bi-safe2" aria-hidden="true" />
                  </span>
                  <span className="flex-grow-1 min-w-0">
                    <span className="d-block fw-semibold text-ink">{register.name}</span>
                    <span className="d-block small text-muted-2 mono">{register.code}</span>
                  </span>
                  {register.openSession ? <StatusBadge tone="green">Abierta</StatusBadge> : <StatusBadge tone="slate">Cerrada</StatusBadge>}
                </button>
              ))}
            </div>
          </div>
          <div className="col-lg-8 col-xl-9">{selected && <RegisterPanel key={selected.id} register={selected} onChanged={registers.reload} notify={toast} />}</div>
        </div>
      )}

      <CreateRegisterModal
        open={createOpen}
        branchId={branchId}
        onClose={() => setCreateOpen(false)}
        onCreated={(register) => {
          setCreateOpen(false);
          setSelectedId(register.id);
          registers.reload();
          toast.success('Caja creada', register.name);
        }}
      />
    </>
  );
}

function RegisterPanel({ register, onChanged, notify }: { register: CashRegister; onChanged: () => void; notify: ReturnType<typeof useToast> }) {
  const session = register.openSession;
  const [openingAmount, setOpeningAmount] = useState('');
  const [movementOpen, setMovementOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opening = useOperationKey();
  const movements = useApiQuery(() => cashApi.movements(session?.id as string, { limit: 100 }), [session?.id], Boolean(session));
  const detail = useApiQuery(() => cashApi.session(session?.id as string), [session?.id, movements.data], Boolean(session));

  const open = async () => {
    const amount = parseLocaleNumber(openingAmount || '0');
    if (Number.isNaN(amount) || amount < 0) {
      setError('Ingresá el fondo inicial (puede ser 0).');
      return;
    }
    const decimal = toDecimalString(amount);
    setBusy(true);
    setError(null);
    try {
      await cashApi.openSession(register.id, decimal, opening.keyFor(`${register.id}:${decimal}`));
      opening.reset();
      setOpeningAmount('');
      notify.success('Caja abierta', `Fondo inicial ${money(decimal)}`);
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <Surface title={register.name} subtitle="Caja cerrada">
        <div className="row g-3 align-items-end" style={{ maxWidth: 520 }}>
          <Field label="Fondo inicial en efectivo" className="col-sm-7" hint="El cambio con el que arranca el turno.">
            <div className="input-group">
              <span className="input-group-text">$</span>
              <input className="form-control mono" inputMode="decimal" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} placeholder="0,00" />
            </div>
          </Field>
          <div className="col-sm-5">
            <button type="button" className="btn btn-primary w-100" onClick={() => void open()} disabled={busy}>
              {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : <i className="bi bi-unlock me-2" aria-hidden="true" />}
              Abrir caja
            </button>
          </div>
        </div>
        {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
      </Surface>
    );
  }

  const current = detail.data ?? null;
  const expected = toNumber(current?.expectedAmount ?? session.expectedAmount);
  const items = movements.data?.items ?? [];
  const totalIn = items.filter((item) => item.direction === 'IN' && item.type !== 'OPENING').reduce((sum, item) => sum + toNumber(item.amount), 0);
  const totalOut = items.filter((item) => item.direction === 'OUT').reduce((sum, item) => sum + toNumber(item.amount), 0);

  return (
    <>
      <div className="row g-3 mb-3">
        <div className="col-sm-6 col-xl-3">
          <div className="surface kpi">
            <div className="kpi-label"><i className="bi bi-cash-stack" aria-hidden="true" />Efectivo esperado</div>
            <div className="kpi-value">{money(expected)}</div>
            <div className="kpi-foot">Abierta {dateTime(session.openedAt)}</div>
          </div>
        </div>
        <div className="col-sm-6 col-xl-3">
          <div className="surface kpi">
            <div className="kpi-label"><i className="bi bi-box-arrow-in-down" aria-hidden="true" />Fondo inicial</div>
            <div className="kpi-value">{money(session.openingAmount)}</div>
          </div>
        </div>
        <div className="col-sm-6 col-xl-3">
          <div className="surface kpi">
            <div className="kpi-label"><i className="bi bi-arrow-down-left" aria-hidden="true" />Ingresos</div>
            <div className="kpi-value text-success">{money(totalIn)}</div>
          </div>
        </div>
        <div className="col-sm-6 col-xl-3">
          <div className="surface kpi">
            <div className="kpi-label"><i className="bi bi-arrow-up-right" aria-hidden="true" />Egresos</div>
            <div className="kpi-value text-danger">{money(totalOut)}</div>
          </div>
        </div>
      </div>

      <Surface
        title={`${register.name} · movimientos del turno`}
        padded={false}
        actions={
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMovementOpen(true)}>
              <i className="bi bi-plus-slash-minus me-1" aria-hidden="true" />
              Ingreso / egreso
            </button>
            <button type="button" className="btn btn-sm btn-dark" onClick={() => setCloseOpen(true)}>
              <i className="bi bi-lock me-1" aria-hidden="true" />
              Cerrar caja
            </button>
          </>
        }
      >
        {movements.error && <div className="p-3"><ErrorAlert message={movements.error} onRetry={movements.reload} /></div>}
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Tipo</th>
                <th>Detalle</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: CashMovement) => (
                <tr key={item.id}>
                  <td className="mono">{time(item.createdAt)}</td>
                  <td>
                    <StatusBadge tone={item.direction === 'IN' ? 'green' : 'red'}>{MOVEMENT_LABEL[item.type]}</StatusBadge>
                  </td>
                  <td>
                    {item.reason}
                    {item.externalReference && <div className="cell-sub">Ref. {item.externalReference}</div>}
                  </td>
                  <td className={`num fw-semibold ${item.direction === 'IN' ? 'text-success' : 'text-danger'}`}>
                    {item.direction === 'IN' ? '+' : '−'}
                    {money(item.amount)}
                  </td>
                </tr>
              ))}
              {movements.data && items.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted-2 py-4">Sin movimientos todavía.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Surface>

      <MovementModal open={movementOpen} session={session.id} onClose={() => setMovementOpen(false)} onSaved={() => { setMovementOpen(false); movements.reload(); onChanged(); notify.success('Movimiento registrado'); }} />
      <CloseModal open={closeOpen} sessionId={session.id} expected={expected} onClose={() => setCloseOpen(false)} onClosed={(closed) => { setCloseOpen(false); onChanged(); notify.success('Caja cerrada', `Diferencia ${money(closed.differenceAmount ?? 0)}`); }} />
    </>
  );
}

function MovementModal({ open, session, onClose, onSaved }: { open: boolean; session: string; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<'INCOME' | 'EXPENSE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useOperationKey();

  const submit = async () => {
    const value = parseLocaleNumber(amount);
    if (Number.isNaN(value) || value <= 0) return setError('Ingresá un importe mayor a cero.');
    if (reason.trim().length < 3) return setError('Detallá el motivo (queda en la auditoría).');
    const type = kind.startsWith('ADJUSTMENT') ? 'ADJUSTMENT' : (kind as 'INCOME' | 'EXPENSE');
    const direction = kind === 'INCOME' || kind === 'ADJUSTMENT_IN' ? 'IN' : 'OUT';
    const body = { type, direction, amount: toDecimalString(value), reason: reason.trim(), externalReference: reference.trim() || undefined } as const;
    setBusy(true);
    setError(null);
    try {
      await cashApi.addMovement(session, body, operation.keyFor(JSON.stringify(body)));
      operation.reset();
      setAmount('');
      setReason('');
      setReference('');
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} size="sm" title="Movimiento de caja" footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}Registrar</button></>}>
      <div className="segmented w-100 mb-3" role="group">
        {([
          ['EXPENSE', 'Egreso'],
          ['INCOME', 'Ingreso'],
          ['ADJUSTMENT_IN', 'Ajuste +'],
          ['ADJUSTMENT_OUT', 'Ajuste −'],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" className={`flex-fill ${kind === value ? 'active' : ''}`} onClick={() => setKind(value)}>
            {label}
          </button>
        ))}
      </div>
      <Field label="Importe" className="mb-3" required>
        <div className="input-group">
          <span className="input-group-text">$</span>
          <input className="form-control mono" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
      </Field>
      <Field label="Motivo" className="mb-3" required>
        <input className="form-control" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder={kind === 'EXPENSE' ? 'Ej.: pago de flete, compra de insumos' : 'Ej.: refuerzo de cambio'} />
      </Field>
      <Field label="Comprobante / referencia" hint="Opcional: n.º de ticket o recibo.">
        <input className="form-control" value={reference} maxLength={100} onChange={(event) => setReference(event.target.value)} />
      </Field>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}

function CloseModal({ open, sessionId, expected, onClose, onClosed }: { open: boolean; sessionId: string; expected: number; onClose: () => void; onClosed: (session: CashSession) => void }) {
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useOperationKey();
  const countedValue = parseLocaleNumber(counted);
  const difference = Number.isNaN(countedValue) ? null : Math.round((countedValue - expected) * 100) / 100;

  const submit = async () => {
    if (Number.isNaN(countedValue) || countedValue < 0) return setError('Ingresá el efectivo contado.');
    const decimal = toDecimalString(countedValue);
    setBusy(true);
    setError(null);
    try {
      const closed = await cashApi.close(sessionId, decimal, operation.keyFor(`${sessionId}:${decimal}`));
      operation.reset();
      setCounted('');
      onClosed(closed);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} size="sm" title="Cierre de caja (arqueo)" subtitle="Contá el efectivo físico antes de confirmar." footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-dark" onClick={() => void submit()} disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}Cerrar caja</button></>}>
      <div className="ticket-row mb-2">
        <span className="text-muted-2">Efectivo esperado</span>
        <span className="value fw-semibold">{money(expected)}</span>
      </div>
      <Field label="Efectivo contado" required>
        <div className="input-group">
          <span className="input-group-text">$</span>
          <input className="form-control mono" inputMode="decimal" value={counted} onChange={(event) => setCounted(event.target.value)} />
        </div>
      </Field>
      {difference !== null && counted && (
        <div className={`alert small py-2 mt-3 mb-0 ${difference === 0 ? 'alert-success' : 'alert-warning'}`}>
          {difference === 0 ? 'La caja cierra sin diferencias.' : difference > 0 ? `Sobrante de ${money(difference)}.` : `Faltante de ${money(-difference)}.`}
        </div>
      )}
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}

function CreateRegisterModal({ open, branchId, onClose, onCreated }: { open: boolean; branchId: string; onClose: () => void; onCreated: (register: CashRegister) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await cashApi.createRegister({ branchId, code: code.trim().toUpperCase(), name: name.trim() });
      setCode('');
      setName('');
      onCreated(created);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} size="sm" title="Nueva caja" footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !code.trim() || !name.trim()}>Crear</button></>}>
      <Field label="Código" className="mb-3" hint="Corto y único en la sucursal, por ejemplo CAJA-1.">
        <input className="form-control mono text-uppercase" value={code} maxLength={20} onChange={(event) => setCode(event.target.value)} />
      </Field>
      <Field label="Nombre">
        <input className="form-control" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Caja principal" />
      </Field>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
