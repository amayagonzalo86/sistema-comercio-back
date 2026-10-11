'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PersonPicker } from '@/components/forms/PersonPicker';
import { PurchaseLinesEditor, type PurchaseLineDraft } from '@/components/forms/PurchaseLinesEditor';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { purchaseOrdersApi } from '@/lib/api/endpoints';
import type { Person, PurchaseOrderStatus } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { date, money, parseLocaleNumber } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { usePersonNames } from '@/lib/hooks/usePersonNames';
import { ORDER_STATUS } from '@/lib/labels';

export default function PurchaseOrdersPage() {
  return (
    <RequireCapability capability="purchases.view">
      <PurchaseOrders />
    </RequireCapability>
  );
}

function PurchaseOrders() {
  const router = useRouter();
  const toast = useToast();
  const { activeBranchId, can } = useSession();
  const branchName = useBranchName();
  const supplierName = usePersonNames('suppliers');
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const orders = useApiQuery(() => purchaseOrdersApi.list({ page, limit: 25, status: status || undefined, branchId: activeBranchId ?? undefined }), [page, status, activeBranchId]);

  return (
    <>
      <PageHeader
        eyebrow="Compras"
        title="Pedidos a proveedores"
        subtitle="Del borrador al envío y la recepción parcial o total, con seguimiento de lo pendiente."
        actions={
          can('purchases.manage') && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              Nuevo pedido
            </button>
          )
        }
      />
      <section className="surface">
        <div className="toolbar">
          <div className="segmented">
            {([['', 'Todos'], ['DRAFT', 'Borradores'], ['SENT', 'Enviados'], ['PARTIALLY_RECEIVED', 'Parciales'], ['RECEIVED', 'Recibidos']] as const).map(([value, label]) => (
              <button key={label} type="button" className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setPage(1); }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {orders.error && <div className="p-3 pb-0"><ErrorAlert message={orders.error} onRetry={orders.reload} /></div>}
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>N.º</th>
                <th>Proveedor</th>
                <th>Sucursal</th>
                <th>Entrega</th>
                <th>Estado</th>
                <th className="num">Estimado</th>
              </tr>
            </thead>
            {orders.loading && !orders.data ? (
              <SkeletonRows columns={6} />
            ) : orders.data && orders.data.items.length === 0 ? (
              <TableMessage colSpan={6}>
                <EmptyState icon="bi-clipboard-check" title="Sin pedidos" action={can('purchases.manage') && <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>Crear pedido</button>}>
                  También podés generarlos desde Reposición sugerida.
                </EmptyState>
              </TableMessage>
            ) : (
              <tbody>
                {orders.data?.items.map((order) => (
                  <tr key={order.id} className="clickable" onClick={() => router.push(`/compras/pedidos/${order.id}`)}>
                    <td className="mono fw-semibold">#{order.number}</td>
                    <td className="cell-title">{supplierName(order.supplierPersonId)}</td>
                    <td>{branchName(order.branchId)}</td>
                    <td>{order.expectedDate ? date(order.expectedDate) : <span className="text-muted-2">—</span>}</td>
                    <td><StatusBadge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</StatusBadge></td>
                    <td className="num fw-semibold">{money(order.estimatedTotal)}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {orders.data && <Pagination page={orders.data.page} pages={orders.data.pages} total={orders.data.total} limit={orders.data.limit} onPage={setPage} />}
      </section>
      <CreateOrderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(orderId) => {
          setCreateOpen(false);
          toast.success('Pedido creado en borrador');
          router.push(`/compras/pedidos/${orderId}`);
        }}
      />
    </>
  );
}

function CreateOrderModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (orderId: string) => void }) {
  const { branches, activeBranchId, branchLocked } = useSession();
  const [supplier, setSupplier] = useState<Person | null>(null);
  const [branchId, setBranchId] = useState<string>('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseLineDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectiveBranch = branchId || activeBranchId || branches[0]?.id || '';

  const submit = async () => {
    if (!supplier) return setError('Elegí el proveedor.');
    if (lines.length === 0) return setError('Agregá al menos un producto.');
    const parsed = lines.map((line) => ({ productId: line.productId, quantity: parseLocaleNumber(line.quantity), unitCost: line.unitCost ? parseLocaleNumber(line.unitCost) : undefined, taxRate: line.taxRate }));
    if (parsed.some((line) => Number.isNaN(line.quantity) || line.quantity <= 0 || (line.unitCost !== undefined && Number.isNaN(line.unitCost)))) return setError('Revisá cantidades y costos.');
    setBusy(true);
    setError(null);
    try {
      const order = await purchaseOrdersApi.create({
        supplierPersonId: supplier.id,
        branchId: effectiveBranch,
        expectedDate: expectedDate || undefined,
        notes: notes.trim() || undefined,
        lines: parsed.map((line) => ({ ...line, quantity: Math.round(line.quantity * 1000) / 1000, unitCost: line.unitCost !== undefined ? Math.round(line.unitCost * 100) / 100 : undefined })),
      });
      setLines([]);
      setSupplier(null);
      onCreated(order.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} size="xl" title="Nuevo pedido de compra" subtitle="Se guarda como borrador: podés revisarlo antes de enviarlo al proveedor." footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}Guardar borrador</button></>}>
      <div className="row g-3 mb-3">
        <Field label="Proveedor" className="col-lg-5" required>
          <PersonPicker role="suppliers" value={supplier} onChange={setSupplier} placeholder="Buscar proveedor…" />
        </Field>
        <Field label="Sucursal que recibe" className="col-lg-3">
          <select className="form-select" value={effectiveBranch} disabled={branchLocked} onChange={(event) => setBranchId(event.target.value)}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </Field>
        <Field label="Entrega estimada" className="col-lg-2">
          <input type="date" className="form-control" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
        </Field>
        <Field label="Notas" className="col-lg-2">
          <input className="form-control" value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
      <PurchaseLinesEditor branchId={effectiveBranch} lines={lines} onChange={setLines} />
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
