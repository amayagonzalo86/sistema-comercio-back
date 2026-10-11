'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { PersonPicker } from '@/components/forms/PersonPicker';
import { EmptyState, ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { inventoryApi, purchaseOrdersApi, transfersApi } from '@/lib/api/endpoints';
import type { Person, ReplenishmentPlan } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { int, qty } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

type TransferGroup = { key: string; from: string; to: string; lines: ReplenishmentPlan['transfers'] };
type PurchaseGroup = { branchId: string; lines: ReplenishmentPlan['purchases'] };

export default function ReplenishmentPage() {
  return (
    <RequireCapability capability="stock.replenishment">
      <Replenishment />
    </RequireCapability>
  );
}

function Replenishment() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const branchName = useBranchName();
  const [target, setTarget] = useState(200);
  const plan = useApiQuery(() => inventoryApi.replenishment({ targetPercent: target }), [target]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [orderFor, setOrderFor] = useState<PurchaseGroup | null>(null);
  const keys = useRef(new Map<string, string>());

  const transferGroups: TransferGroup[] = [];
  for (const line of plan.data?.transfers ?? []) {
    const key = `${line.fromBranchId}>${line.toBranchId}`;
    const group = transferGroups.find((item) => item.key === key);
    if (group) group.lines.push(line);
    else transferGroups.push({ key, from: line.fromBranchId, to: line.toBranchId, lines: [line] });
  }
  const purchaseGroups: PurchaseGroup[] = [];
  for (const line of plan.data?.purchases ?? []) {
    const group = purchaseGroups.find((item) => item.branchId === line.branchId);
    if (group) group.lines.push(line);
    else purchaseGroups.push({ branchId: line.branchId, lines: [line] });
  }

  const dispatch = async (group: TransferGroup) => {
    // Clave por grupo: si se corta la red y se vuelve a tocar, no se despacha dos veces.
    const idempotencyKey = keys.current.get(group.key) ?? newIdempotencyKey();
    keys.current.set(group.key, idempotencyKey);
    setBusyKey(group.key);
    try {
      const transfer = await transfersApi.create(
        {
          originBranchId: group.from,
          destinationBranchId: group.to,
          lines: group.lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
          notes: `Reposición sugerida (objetivo ${target} % del mínimo)`,
        },
        idempotencyKey,
      );
      keys.current.delete(group.key);
      toast.success(`Transferencia #${transfer.number} despachada`, `${branchName(group.from)} → ${branchName(group.to)}`);
      plan.reload();
    } catch (caught) {
      toast.error('No se pudo despachar', errorMessage(caught));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Stock entre sucursales"
        title="Reposición sugerida"
        subtitle="Primero se mueve stock sobrante entre sucursales; lo que falta se sugiere comprar."
        actions={
          <label className="d-flex align-items-center gap-2 small mb-0">
            Llevar al
            <select className="form-select form-select-sm w-auto" value={target} onChange={(event) => setTarget(Number(event.target.value))}>
              {[100, 150, 200, 300].map((value) => (
                <option key={value} value={value}>{value} %</option>
              ))}
            </select>
            del mínimo
          </label>
        }
      />
      {plan.error && <ErrorAlert message={plan.error} onRetry={plan.reload} />}
      {plan.loading && !plan.data && <Spinner label="Calculando plan…" />}
      {plan.data && transferGroups.length === 0 && purchaseGroups.length === 0 && (
        <div className="surface"><EmptyState icon="bi-check2-circle" title="No hay nada para reponer">Todas las sucursales están sobre su stock mínimo.</EmptyState></div>
      )}

      <div className="row g-3">
        {transferGroups.length > 0 && (
          <div className="col-xl-6">
            <div className="eyebrow mb-2">Mover entre sucursales · {int(plan.data?.transfers.length ?? 0)} productos</div>
            {transferGroups.map((group) => (
              <Surface
                key={group.key}
                className="mb-3"
                padded={false}
                title={<h2>{branchName(group.from)} <i className="bi bi-arrow-right mx-1 text-muted-2" aria-hidden="true" /> {branchName(group.to)}</h2>}
                actions={
                  can('stock.transfer') && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void dispatch(group)} disabled={busyKey !== null}>
                      {busyKey === group.key ? <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" /> : <i className="bi bi-truck me-1" aria-hidden="true" />}
                      Despachar
                    </button>
                  )
                }
              >
                <table className="table table-erp">
                  <tbody>
                    {group.lines.map((line) => (
                      <tr key={line.productId}>
                        <td><div className="cell-title">{line.name}</div><div className="cell-sub mono">{line.sku}</div></td>
                        <td className="num fw-semibold">{qty(line.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Surface>
            ))}
          </div>
        )}
        {purchaseGroups.length > 0 && (
          <div className="col-xl-6">
            <div className="eyebrow mb-2">Comprar · {int(plan.data?.purchases.length ?? 0)} productos</div>
            {purchaseGroups.map((group) => (
              <Surface
                key={group.branchId}
                className="mb-3"
                padded={false}
                title={branchName(group.branchId)}
                actions={
                  can('purchases.manage') && (
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setOrderFor(group)}>
                      <i className="bi bi-clipboard-plus me-1" aria-hidden="true" />
                      Generar pedido
                    </button>
                  )
                }
              >
                <table className="table table-erp">
                  <tbody>
                    {group.lines.map((line) => (
                      <tr key={line.productId}>
                        <td><div className="cell-title">{line.name}</div><div className="cell-sub mono">{line.sku}</div></td>
                        <td className="num fw-semibold">{qty(line.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Surface>
            ))}
          </div>
        )}
      </div>

      {orderFor && (
        <OrderFromPlanModal
          group={orderFor}
          target={target}
          onClose={() => setOrderFor(null)}
          onCreated={(orderId) => {
            setOrderFor(null);
            toast.success('Pedido en borrador creado');
            router.push(`/compras/pedidos/${orderId}`);
          }}
        />
      )}
    </>
  );
}

function OrderFromPlanModal({ group, target, onClose, onCreated }: { group: PurchaseGroup; target: number; onClose: () => void; onCreated: (orderId: string) => void }) {
  const branchName = useBranchName();
  const [supplier, setSupplier] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!supplier) return setError('Elegí el proveedor.');
    setBusy(true);
    setError(null);
    try {
      const order = await purchaseOrdersApi.fromReplenishment({
        supplierPersonId: supplier.id,
        branchId: group.branchId,
        productIds: group.lines.map((line) => line.productId),
        targetPercent: target,
      });
      onCreated(order.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} busy={busy} size="md" title={`Pedido de compra · ${branchName(group.branchId)}`} subtitle={`${group.lines.length} productos faltantes. Se crea en borrador para revisar antes de enviar.`} footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !supplier}>Crear borrador</button></>}>
      <Field label="Proveedor" required>
        <PersonPicker role="suppliers" value={supplier} onChange={setSupplier} placeholder="Buscar proveedor…" />
      </Field>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
