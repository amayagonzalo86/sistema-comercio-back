'use client';

import { useEffect, useRef, useState } from 'react';
import { ProductSearch } from '@/components/forms/ProductSearch';
import { EmptyState, ErrorAlert, SkeletonRows, Spinner, TableMessage } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { transfersApi } from '@/lib/api/endpoints';
import type { ProductListItem, StockTransfer, StockTransferStatus } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { dateTime, int, money, parseLocaleNumber, qty, toNumber } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { TRANSFER_STATUS } from '@/lib/labels';

export default function TransfersPage() {
  return (
    <RequireCapability capability="stock.view">
      <Transfers />
    </RequireCapability>
  );
}

function Transfers() {
  const { activeBranchId, can } = useSession();
  const branchName = useBranchName();
  const toast = useToast();
  const [status, setStatus] = useState<StockTransferStatus | ''>('SENT');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useApiQuery(() => transfersApi.list({ page, limit: 25, status: status || undefined, branchId: activeBranchId ?? undefined }), [page, status, activeBranchId]);

  return (
    <>
      <PageHeader
        eyebrow="Stock entre sucursales"
        title="Transferencias"
        subtitle="La mercadería sale del origen al despachar y entra al destino al recibir. Los faltantes quedan registrados."
        actions={
          can('stock.transfer') && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>
              <i className="bi bi-truck me-1" aria-hidden="true" />
              Nueva transferencia
            </button>
          )
        }
      />
      <section className="surface">
        <div className="toolbar">
          <div className="segmented">
            {([['SENT', 'En tránsito'], ['RECEIVED', 'Recibidas'], ['CANCELLED', 'Anuladas'], ['', 'Todas']] as const).map(([value, label]) => (
              <button key={label} type="button" className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setPage(1); }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {list.error && <div className="p-3 pb-0"><ErrorAlert message={list.error} onRetry={list.reload} /></div>}
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>N.º</th>
                <th>Fecha</th>
                <th>Origen</th>
                <th />
                <th>Destino</th>
                <th>Estado</th>
              </tr>
            </thead>
            {list.loading && !list.data ? (
              <SkeletonRows columns={6} />
            ) : list.data && list.data.items.length === 0 ? (
              <TableMessage colSpan={6}>
                <EmptyState icon="bi-truck" title="No hay transferencias con ese estado" />
              </TableMessage>
            ) : (
              <tbody>
                {list.data?.items.map((transfer) => (
                  <tr key={transfer.id} className="clickable" onClick={() => setOpenId(transfer.id)}>
                    <td className="mono fw-semibold">#{transfer.number}</td>
                    <td>{dateTime(transfer.createdAt)}</td>
                    <td>{branchName(transfer.originBranchId)}</td>
                    <td className="text-muted-2"><i className="bi bi-arrow-right" aria-hidden="true" /></td>
                    <td>{branchName(transfer.destinationBranchId)}</td>
                    <td><StatusBadge tone={TRANSFER_STATUS[transfer.status].tone}>{TRANSFER_STATUS[transfer.status].label}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={setPage} />}
      </section>

      <CreateTransferModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(transfer) => {
          setCreateOpen(false);
          toast.success(`Transferencia #${transfer.number} despachada`);
          setStatus('SENT');
          list.reload();
        }}
      />
      {openId && (
        <TransferDetailModal
          transferId={openId}
          onClose={() => setOpenId(null)}
          onChanged={(message) => {
            setOpenId(null);
            toast.success(message);
            list.reload();
          }}
        />
      )}
    </>
  );
}

interface DraftLine {
  product: ProductListItem;
  quantity: string;
}

function CreateTransferModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (transfer: StockTransfer) => void }) {
  const { branches, activeBranchId, branchLocked } = useSession();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const first = activeBranchId ?? branches[0]?.id ?? '';
    setOrigin(first);
    setDestination(branches.find((branch) => branch.id !== first)?.id ?? '');
    setLines([]);
    setNotes('');
    setError(null);
  }, [open, activeBranchId, branches]);

  const add = (product: ProductListItem) => {
    setLines((current) => (current.some((line) => line.product.id === product.id) ? current : [...current, { product, quantity: '1' }]));
  };

  const submit = async () => {
    if (!origin || !destination || origin === destination) return setError('Elegí sucursales de origen y destino distintas.');
    const parsed = lines.map((line) => ({ productId: line.product.id, quantity: parseLocaleNumber(line.quantity) }));
    if (parsed.length === 0) return setError('Agregá al menos un producto.');
    if (parsed.some((line) => Number.isNaN(line.quantity) || line.quantity <= 0)) return setError('Las cantidades deben ser mayores a cero.');
    const body = { originBranchId: origin, destinationBranchId: destination, lines: parsed.map((line) => ({ ...line, quantity: Math.round(line.quantity * 1000) / 1000 })), notes: notes.trim() || undefined };
    const signature = JSON.stringify(body);
    if (!key.current || key.current.signature !== signature) key.current = { signature, key: newIdempotencyKey() };
    setBusy(true);
    setError(null);
    try {
      const transfer = await transfersApi.create(body, key.current.key);
      key.current = null;
      onCreated(transfer);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} size="lg" title="Nueva transferencia" subtitle="Al despachar, el stock sale de la sucursal de origen y queda en tránsito." footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}Despachar</button></>}>
      <div className="row g-3 mb-3">
        <Field label="Origen" className="col-md-6">
          <select className="form-select" value={origin} disabled={branchLocked} onChange={(event) => { setOrigin(event.target.value); setLines([]); }}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </Field>
        <Field label="Destino" className="col-md-6">
          <select className="form-select" value={destination} onChange={(event) => setDestination(event.target.value)}>
            <option value="">Elegir…</option>
            {branches.filter((branch) => branch.id !== origin).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </Field>
      </div>
      <ProductSearch branchId={origin} onPick={add} placeholder="Agregar producto (stock del origen)…" />
      <table className="table table-erp mt-3">
        <thead>
          <tr>
            <th>Producto</th>
            <th className="num">Disponible</th>
            <th className="num" style={{ width: 140 }}>Enviar</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.product.id}>
              <td>
                <div className="cell-title">{line.product.name}</div>
                <div className="cell-sub mono">{line.product.sku}</div>
              </td>
              <td className="num">{qty(line.product.branch?.stock ?? 0)}</td>
              <td>
                <input className="form-control form-control-sm mono text-end" inputMode="decimal" value={line.quantity} onChange={(event) => setLines((current) => current.map((item) => (item.product.id === line.product.id ? { ...item, quantity: event.target.value } : item)))} />
              </td>
              <td className="text-end">
                <button type="button" className="btn btn-sm btn-link text-muted-2" onClick={() => setLines((current) => current.filter((item) => item.product.id !== line.product.id))} aria-label="Quitar">
                  <i className="bi bi-trash3" />
                </button>
              </td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr><td colSpan={4} className="text-center text-muted-2 py-3">Buscá productos para agregarlos.</td></tr>
          )}
        </tbody>
      </table>
      <Field label="Observaciones (remito, transporte)">
        <input className="form-control" value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}

function TransferDetailModal({ transferId, onClose, onChanged }: { transferId: string; onClose: () => void; onChanged: (message: string) => void }) {
  const { can } = useSession();
  const branchName = useBranchName();
  const detail = useApiQuery(() => transfersApi.get(transferId), [transferId]);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [mode, setMode] = useState<'view' | 'cancel'>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transfer = detail.data;

  const receive = async () => {
    if (!transfer) return;
    const lines = (transfer.items ?? [])
      .filter((item) => received[item.productId] !== undefined && received[item.productId] !== '')
      .map((item) => ({ productId: item.productId, quantityReceived: parseLocaleNumber(received[item.productId] ?? '') }));
    if (lines.some((line) => Number.isNaN(line.quantityReceived) || line.quantityReceived < 0)) return setError('Revisá las cantidades recibidas.');
    setBusy(true);
    setError(null);
    try {
      await transfersApi.receive(transfer.id, { lines: lines.length ? lines : undefined, notes: notes.trim() || undefined });
      onChanged(`Transferencia #${transfer.number} recibida`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!transfer) return;
    if (cancelReason.trim().length < 3) return setError('Indicá el motivo de la anulación.');
    setBusy(true);
    setError(null);
    try {
      await transfersApi.cancel(transfer.id, cancelReason.trim());
      onChanged(`Transferencia #${transfer.number} anulada`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const inTransit = transfer?.status === 'SENT';
  const totalCost = (transfer?.items ?? []).reduce((sum, item) => sum + toNumber(item.unitCost) * toNumber(item.quantitySent), 0);

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      size="lg"
      title={transfer ? `Transferencia #${transfer.number}` : 'Transferencia'}
      subtitle={transfer ? `${branchName(transfer.originBranchId)} → ${branchName(transfer.destinationBranchId)} · ${dateTime(transfer.createdAt)}` : undefined}
      footer={
        inTransit && (
          mode === 'cancel' ? (
            <>
              <button type="button" className="btn btn-light" onClick={() => setMode('view')} disabled={busy}>Volver</button>
              <button type="button" className="btn btn-danger" onClick={() => void cancel()} disabled={busy}>Anular y devolver al origen</button>
            </>
          ) : (
            <>
              {can('stock.cancelTransfer') && <button type="button" className="btn btn-outline-danger me-auto" onClick={() => setMode('cancel')} disabled={busy}>Anular</button>}
              {can('stock.transfer') && <button type="button" className="btn btn-success" onClick={() => void receive()} disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}Confirmar recepción</button>}
            </>
          )
        )
      }
    >
      {detail.loading && !transfer && <Spinner />}
      {detail.error && <ErrorAlert message={detail.error} />}
      {transfer && (
        <>
          <div className="d-flex gap-2 align-items-center mb-3">
            <StatusBadge tone={TRANSFER_STATUS[transfer.status].tone}>{TRANSFER_STATUS[transfer.status].label}</StatusBadge>
            <span className="small text-muted-2">Valor a costo: <span className="mono">{money(totalCost)}</span> · {int(transfer.items?.length ?? 0)} ítems</span>
          </div>
          {transfer.notes && <div className="legal-note mb-3">{transfer.notes}</div>}
          {mode === 'cancel' ? (
            <Field label="Motivo de la anulación" required>
              <input className="form-control" value={cancelReason} maxLength={200} onChange={(event) => setCancelReason(event.target.value)} />
            </Field>
          ) : (
            <>
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Enviado</th>
                    <th className="num" style={{ width: 150 }}>{inTransit ? 'Recibido' : 'Recibido'}</th>
                  </tr>
                </thead>
                <tbody>
                  {transfer.items?.map((item) => {
                    const receivedQty = item.quantityReceived;
                    const short = receivedQty !== null && receivedQty !== undefined && toNumber(receivedQty) < toNumber(item.quantitySent);
                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="cell-title">{item.nameSnapshot}</div>
                          <div className="cell-sub mono">{item.skuSnapshot}</div>
                        </td>
                        <td className="num">{qty(item.quantitySent)}</td>
                        <td className="num">
                          {inTransit && can('stock.transfer') ? (
                            <input className="form-control form-control-sm mono text-end" inputMode="decimal" placeholder={qty(item.quantitySent)} value={received[item.productId] ?? ''} onChange={(event) => setReceived((current) => ({ ...current, [item.productId]: event.target.value }))} />
                          ) : (
                            <span className={short ? 'text-danger fw-semibold' : ''}>{receivedQty !== null && receivedQty !== undefined ? qty(receivedQty) : '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {inTransit && can('stock.transfer') && (
                <>
                  <div className="form-hint mb-2">Dejá vacío lo que llegó completo. Si falta algo, cargá la cantidad real: la diferencia queda registrada como faltante.</div>
                  <Field label="Observaciones de recepción">
                    <input className="form-control" value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />
                  </Field>
                </>
              )}
              {transfer.receiptNotes && <div className="legal-note mt-2">Recepción: {transfer.receiptNotes}</div>}
              {transfer.cancelReason && <div className="legal-note mt-2">Anulada: {transfer.cancelReason}</div>}
            </>
          )}
          {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
        </>
      )}
    </Modal>
  );
}
