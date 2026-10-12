'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PurchaseLinesEditor, type PurchaseLineDraft } from '@/components/forms/PurchaseLinesEditor';
import { ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { purchaseOrdersApi, receiptsApi } from '@/lib/api/endpoints';
import type { PurchaseOrder } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { date, dateTime, money, parseLocaleNumber, qty, toNumber } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { usePersonNames } from '@/lib/hooks/usePersonNames';
import { ORDER_STATUS } from '@/lib/labels';

function draftsFromOrder(order: PurchaseOrder): PurchaseLineDraft[] {
  return (order.items ?? []).map((item) => ({
    productId: item.productId,
    sku: item.skuSnapshot,
    name: item.nameSnapshot,
    quantity: String(toNumber(item.quantityOrdered)),
    unitCost: String(toNumber(item.unitCost)),
    taxRate: toNumber(item.taxRate),
  }));
}

export default function PurchaseOrderPage() {
  return (
    <RequireCapability capability="purchases.view">
      <PurchaseOrderDetail />
    </RequireCapability>
  );
}

function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { can } = useSession();
  const branchName = useBranchName();
  const supplierName = usePersonNames('suppliers');
  const order = useApiQuery(() => purchaseOrdersApi.get(id), [id]);
  const receipts = useApiQuery(() => receiptsApi.list({ purchaseOrderId: id, limit: 50 }), [id, order.data?.status]);
  const [lines, setLines] = useState<PurchaseLineDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (order.data) {
      setLines(draftsFromOrder(order.data));
      setDirty(false);
    }
  }, [order.data]);

  if (order.loading && !order.data) return <Spinner label="Cargando pedido…" />;
  if (order.error || !order.data) return <ErrorAlert message={order.error ?? 'Pedido no encontrado.'} onRetry={order.reload} />;
  const data = order.data;
  const isDraft = data.status === 'DRAFT';
  const canReceive = can('purchases.receive') && (data.status === 'SENT' || data.status === 'PARTIALLY_RECEIVED');

  const run = async (action: () => Promise<PurchaseOrder>, message: string) => {
    setBusy(true);
    try {
      const updated = await action();
      order.setData(updated);
      toast.success(message);
    } catch (caught) {
      toast.error('No se pudo completar la acción', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveLines = () => {
    const parsed = lines.map((line) => ({ productId: line.productId, quantity: parseLocaleNumber(line.quantity), unitCost: parseLocaleNumber(line.unitCost), taxRate: line.taxRate }));
    if (parsed.some((line) => Number.isNaN(line.quantity) || line.quantity <= 0 || Number.isNaN(line.unitCost))) {
      toast.error('Revisá cantidades y costos');
      return;
    }
    void run(
      () => purchaseOrdersApi.update(data.id, { lines: parsed.map((line) => ({ ...line, quantity: Math.round(line.quantity * 1000) / 1000, unitCost: Math.round(line.unitCost * 100) / 100 })) }),
      'Borrador actualizado',
    );
  };

  return (
    <>
      <PageHeader
        eyebrow={`Pedido de compra · ${branchName(data.branchId)}`}
        title={`#${data.number} · ${supplierName(data.supplierPersonId)}`}
        subtitle={<>Creado {dateTime(data.createdAt)}{data.expectedDate ? ` · entrega estimada ${date(data.expectedDate)}` : ''}</>}
        actions={
          <>
            <Link href="/compras/pedidos" className="btn btn-sm btn-light">
              <i className="bi bi-arrow-left me-1" aria-hidden="true" />
              Pedidos
            </Link>
            {isDraft && can('purchases.manage') && (
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={saveLines} disabled={!dirty || busy}>
                Guardar cambios
              </button>
            )}
            {isDraft && can('purchases.approve') && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void run(() => purchaseOrdersApi.send(data.id), 'Pedido enviado al proveedor')} disabled={busy || dirty}>
                <i className="bi bi-send me-1" aria-hidden="true" />
                Marcar como enviado
              </button>
            )}
            {canReceive && (
              <Link href={`/compras/recepciones/nueva?pedido=${data.id}`} className="btn btn-sm btn-success">
                <i className="bi bi-box-arrow-in-down me-1" aria-hidden="true" />
                Recibir mercadería
              </Link>
            )}
            {(isDraft || data.status === 'SENT') && can('purchases.approve') && (
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setCancelOpen(true)} disabled={busy}>
                Cancelar pedido
              </button>
            )}
          </>
        }
      />

      <div className="row g-3">
        <div className="col-xl-9">
          {isDraft && can('purchases.manage') ? (
            <Surface title="Renglones (borrador editable)">
              <PurchaseLinesEditor branchId={data.branchId} lines={lines} onChange={(next) => { setLines(next); setDirty(true); }} />
            </Surface>
          ) : (
            <Surface title="Renglones" padded={false}>
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Pedido</th>
                    <th className="num">Recibido</th>
                    <th className="num">Costo</th>
                    <th className="num">IVA</th>
                    <th style={{ width: 160 }}>Avance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items?.map((item) => {
                    const ordered = toNumber(item.quantityOrdered);
                    const receivedQty = toNumber(item.quantityReceived);
                    const progress = ordered > 0 ? Math.min(100, (receivedQty / ordered) * 100) : 0;
                    return (
                      <tr key={item.id}>
                        <td><div className="cell-title">{item.nameSnapshot}</div><div className="cell-sub mono">{item.skuSnapshot}</div></td>
                        <td className="num">{qty(ordered)}</td>
                        <td className="num">{qty(receivedQty)}</td>
                        <td className="num">{money(item.unitCost)}</td>
                        <td className="num text-muted-2">{toNumber(item.taxRate).toLocaleString('es-AR')} %</td>
                        <td>
                          <div className="progress" style={{ height: 6 }} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                            <div className={`progress-bar ${progress >= 100 ? 'bg-success' : ''}`} style={{ width: `${progress}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Surface>
          )}
        </div>
        <div className="col-xl-3 d-flex flex-column gap-3">
          <Surface>
            <div className="eyebrow mb-1">Estado</div>
            <StatusBadge tone={ORDER_STATUS[data.status].tone}>{ORDER_STATUS[data.status].label}</StatusBadge>
            <div className="eyebrow mt-3 mb-1">Total estimado</div>
            <div className="mono fs-4 fw-semibold text-ink">{money(data.estimatedTotal)}</div>
            {data.notes && <div className="legal-note mt-3">{data.notes}</div>}
            {data.cancelReason && <div className="alert alert-danger small py-2 mt-3 mb-0">Cancelado: {data.cancelReason}</div>}
          </Surface>
          <Surface title="Recepciones" padded={false}>
            {(receipts.data?.items ?? []).length === 0 ? (
              <div className="small text-muted-2 p-3">Todavía no se recibió mercadería.</div>
            ) : (
              <ul className="list-unstyled mb-0">
                {receipts.data?.items.map((receipt) => (
                  <li key={receipt.id} className="px-3 py-2 border-bottom small d-flex justify-content-between">
                    <span>{dateTime(receipt.createdAt)}{receipt.sourceDocumentNumber ? <span className="d-block text-muted-2">{receipt.sourceDocumentType ?? 'Doc.'} {receipt.sourceDocumentNumber}</span> : null}</span>
                    <span className="mono fw-semibold">{money(receipt.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>
      </div>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} busy={busy} size="sm" title="Cancelar pedido" footer={<><button type="button" className="btn btn-light" onClick={() => setCancelOpen(false)}>Volver</button><button type="button" className="btn btn-danger" disabled={reason.trim().length < 3 || busy} onClick={() => { setCancelOpen(false); void run(() => purchaseOrdersApi.cancel(data.id, reason.trim()), 'Pedido cancelado'); }}>Cancelar pedido</button></>}>
        <Field label="Motivo" required>
          <input className="form-control" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </Modal>
    </>
  );
}
