'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { OrderTicket } from '@/components/sales/OrderTicket';
import { errorMessage } from '@/lib/api/client';
import { salesOrdersApi } from '@/lib/api/endpoints';
import type { SalesOrderDetail } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

export default function SalesOrderDetailPage() {
  return (
    <RequireCapability capability="salesOrders.view">
      <SalesOrderView />
    </RequireCapability>
  );
}

function SalesOrderView() {
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const { can, user } = useSession();
  const [cancelOpen, setCancelOpen] = useState(false);
  const order = useApiQuery(() => salesOrdersApi.get(params.id), [params.id]);

  if (order.loading && !order.data) return <Spinner label="Cargando pedido…" />;
  if (order.error || !order.data) return <ErrorAlert message={order.error ?? 'Pedido no encontrado.'} onRetry={order.reload} />;

  const data = order.data;
  const pending = data.status === 'PENDING';
  const canCancel = pending && (can('salesOrders.cancelAny') || (can('salesOrders.create') && data.sellerUserId === user?.id));

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3 no-print">
        <Link href="/ventas/pedidos" className="btn btn-sm btn-link px-0">
          <i className="bi bi-arrow-left me-1" aria-hidden="true" />
          Pedidos de venta
        </Link>
        <div className="d-flex flex-wrap gap-2">
          {canCancel && (
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setCancelOpen(true)}>
              <i className="bi bi-x-circle me-1" aria-hidden="true" />
              Anular
            </button>
          )}
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => window.print()}>
            <i className="bi bi-printer me-1" aria-hidden="true" />
            Imprimir
          </button>
          {pending && can('pos.charge') && (
            <Link href={`/ventas/pos?pedido=${data.number}`} className="btn btn-sm btn-primary">
              <i className="bi bi-cash-coin me-1" aria-hidden="true" />
              Cobrar en caja
            </Link>
          )}
          {data.saleId && (
            <Link href={`/ventas/${data.saleId}`} className="btn btn-sm btn-primary">
              Ver venta
            </Link>
          )}
        </div>
      </div>

      <OrderTicket order={data} />

      <CancelOrderModal
        open={cancelOpen}
        order={data}
        onClose={() => setCancelOpen(false)}
        onCancelled={(updated) => {
          setCancelOpen(false);
          order.setData(updated);
          toast.success(`Pedido N.º ${updated.number} anulado`);
        }}
      />
    </>
  );
}

function CancelOrderModal({ open, order, onClose, onCancelled }: { open: boolean; order: SalesOrderDetail; onClose: () => void; onCancelled: (order: SalesOrderDetail) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await salesOrdersApi.cancel(order.id, reason.trim());
      setReason('');
      onCancelled(updated);
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
      size="sm"
      title={`Anular pedido N.º ${order.number}`}
      subtitle="El pedido deja de aparecer en la cola de caja. Queda registrado en la auditoría."
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Volver
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void submit()} disabled={busy || reason.trim().length < 3}>
            {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
            Anular pedido
          </button>
        </>
      }
    >
      <Field label="Motivo" hint="Ej.: el cliente no se presentó, cambió de opinión.">
        <input className="form-control" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} data-autofocus />
      </Field>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
