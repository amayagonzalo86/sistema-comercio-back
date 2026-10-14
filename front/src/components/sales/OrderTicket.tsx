import { StatusBadge } from '@/components/ui/StatusBadge';
import type { SalesOrderDetail } from '@/lib/api/types';
import { dateTime, money, qty, toNumber } from '@/lib/format';
import { SALES_ORDER_STATUS } from '@/lib/labels';

/** Ticket del pedido: es lo que el vendedor imprime o muestra para que el cliente pague en caja. */
export function OrderTicket({ order }: { order: SalesOrderDetail }) {
  const status = SALES_ORDER_STATUS[order.status];
  return (
    <section className="surface surface-body order-ticket mx-auto" style={{ maxWidth: 560 }}>
      <div className="text-center mb-3">
        <div className="eyebrow">Pedido de venta · {order.branchName ?? ''}</div>
        <div className="mono fw-bold text-ink" style={{ fontSize: '3rem', lineHeight: 1.1 }}>
          N.º {order.number}
        </div>
        <div className="small text-muted-2">{dateTime(order.createdAt)}</div>
        <div className="mt-2 no-print">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
      </div>

      <div className="d-flex justify-content-between small mb-1">
        <span className="text-muted-2">Vendedor</span>
        <span className="fw-medium">{order.sellerName ?? '—'}</span>
      </div>
      <div className="d-flex justify-content-between small mb-3">
        <span className="text-muted-2">Cliente</span>
        <span className="fw-medium">{order.customerName ?? 'Consumidor final'}</span>
      </div>

      <table className="table table-sm mb-2">
        <thead>
          <tr>
            <th>Artículo</th>
            <th className="text-end">Cant.</th>
            <th className="text-end">Importe</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id}>
              <td>
                <div className="fw-medium">{item.nameSnapshot}</div>
                <div className="small text-muted-2 mono">
                  {item.skuSnapshot} · {money(item.unitPrice)}
                  {toNumber(item.discountAmount) > 0 && <span className="text-success"> · −{money(item.discountAmount)}</span>}
                </div>
              </td>
              <td className="text-end mono">{qty(item.quantity)}</td>
              <td className="text-end mono">{money(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="d-flex justify-content-between align-items-baseline border-top pt-2">
        <span className="fw-semibold">Total estimado</span>
        <span className="mono fs-4 fw-semibold text-ink">{money(order.estimatedTotal)}</span>
      </div>
      {order.notes && <div className="small mt-2"><i className="bi bi-chat-left-text me-1" aria-hidden="true" />{order.notes}</div>}
      <div className="legal-note mt-3">
        Presentá este número en caja para pagar. El importe final se confirma al cobrar con los precios y promociones vigentes.
        Este pedido no es un comprobante fiscal.
      </div>
      {order.status === 'CANCELLED' && order.cancelReason && (
        <div className="alert alert-secondary small mt-3 mb-0">
          Anulado {order.cancelledAt ? dateTime(order.cancelledAt) : ''}: {order.cancelReason}
        </div>
      )}
      {order.status === 'CHARGED' && order.chargedAt && (
        <div className="alert alert-success small mt-3 mb-0">Cobrado en caja el {dateTime(order.chargedAt)}.</div>
      )}
    </section>
  );
}
