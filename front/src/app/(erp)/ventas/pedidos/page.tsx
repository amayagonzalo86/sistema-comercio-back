'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { errorMessage } from '@/lib/api/client';
import { salesOrdersApi } from '@/lib/api/endpoints';
import type { SalesOrder, SalesOrderStatus } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { dateTime, int, money, time } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { SALES_ORDER_STATUS } from '@/lib/labels';

const REFRESH_MS = 15_000;
const FILTERS: ReadonlyArray<readonly [SalesOrderStatus | '', string]> = [
  ['PENDING', 'Esperando cobro'],
  ['CHARGED', 'Cobrados'],
  ['CANCELLED', 'Anulados'],
  ['', 'Todos'],
];

export default function SalesOrdersPage() {
  return (
    <RequireCapability capability="salesOrders.view">
      <SalesOrders />
    </RequireCapability>
  );
}

function SalesOrders() {
  const router = useRouter();
  const { activeBranchId, can, user } = useSession();
  const canCharge = can('pos.charge');
  const [status, setStatus] = useState<SalesOrderStatus | ''>('PENDING');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [numberInput, setNumberInput] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const orders = useApiQuery(
    () =>
      salesOrdersApi.list({
        page,
        limit: 25,
        status: status || undefined,
        branchId: activeBranchId ?? undefined,
        sellerUserId: mine && user ? user.id : undefined,
      }),
    [page, status, activeBranchId, mine, user?.id],
  );
  const { reload } = orders;

  // La cola de caja se actualiza sola: el cajero ve aparecer los pedidos que van armando los vendedores.
  useEffect(() => {
    if (status !== 'PENDING') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [status, reload]);

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const number = Number(numberInput.trim());
    if (!Number.isInteger(number) || number < 1) {
      setLookupError('Ingresá el número de pedido.');
      return;
    }
    setLookingUp(true);
    setLookupError(null);
    try {
      const order = await salesOrdersApi.byNumber(number);
      router.push(`/ventas/pedidos/${order.id}`);
    } catch (caught) {
      setLookupError(errorMessage(caught));
    } finally {
      setLookingUp(false);
    }
  };

  const charge = (order: SalesOrder) => router.push(`/ventas/pos?pedido=${order.number}`);

  return (
    <>
      <PageHeader
        eyebrow="Ventas"
        title="Pedidos de venta"
        subtitle="Preventa: el vendedor arma el pedido, el cliente lo paga en caja con el número y la venta queda a nombre del vendedor."
        actions={
          can('salesOrders.create') && (
            <Link href="/ventas/pos" className="btn btn-sm btn-primary">
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              {canCharge ? 'Punto de venta' : 'Nuevo pedido'}
            </Link>
          )
        }
      />

      <section className="surface">
        <div className="toolbar flex-wrap gap-2">
          <div className="segmented">
            {FILTERS.map(([value, label]) => (
              <button key={label} type="button" className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setPage(1); }}>
                {label}
              </button>
            ))}
          </div>
          {user && (
            <div className="form-check form-switch mb-0">
              <input id="orders-mine" className="form-check-input" type="checkbox" checked={mine} onChange={(event) => { setMine(event.target.checked); setPage(1); }} />
              <label className="form-check-label small" htmlFor="orders-mine">
                Solo mis pedidos
              </label>
            </div>
          )}
          <form className="ms-auto d-flex gap-2 align-items-start" onSubmit={(event) => void lookup(event)}>
            <div>
              <div className="input-group input-group-sm" style={{ maxWidth: 220 }}>
                <span className="input-group-text">N.º</span>
                <input
                  className="form-control mono"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Buscar pedido"
                  value={numberInput}
                  onChange={(event) => setNumberInput(event.target.value.replace(/\D/g, '').slice(0, 10))}
                  aria-label="Número de pedido"
                />
                <button type="submit" className="btn btn-outline-primary" disabled={lookingUp}>
                  {lookingUp ? <span className="spinner-border spinner-border-sm" aria-hidden="true" /> : <i className="bi bi-search" aria-hidden="true" />}
                </button>
              </div>
              {lookupError && <div className="small text-danger mt-1">{lookupError}</div>}
            </div>
          </form>
        </div>

        {orders.error && (
          <div className="p-3 pb-0">
            <ErrorAlert message={orders.error} onRetry={orders.reload} />
          </div>
        )}

        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>N.º</th>
                <th>Hora</th>
                <th>Vendedor</th>
                <th>Cliente</th>
                <th className="num">Artículos</th>
                <th>Estado</th>
                <th className="num">Total estimado</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            {orders.loading && !orders.data ? (
              <SkeletonRows columns={8} />
            ) : orders.data && orders.data.items.length === 0 ? (
              <TableMessage colSpan={8}>
                <EmptyState icon="bi-card-checklist" title={status === 'PENDING' ? 'No hay pedidos esperando cobro' : 'Sin pedidos'}>
                  {status === 'PENDING' ? 'Los pedidos que armen los vendedores aparecen acá automáticamente.' : 'Probá con otro filtro.'}
                </EmptyState>
              </TableMessage>
            ) : (
              <tbody>
                {orders.data?.items.map((order) => {
                  const label = SALES_ORDER_STATUS[order.status];
                  return (
                    <tr key={order.id} className="clickable" onClick={() => router.push(`/ventas/pedidos/${order.id}`)}>
                      <td className="mono fw-semibold fs-6">#{order.number}</td>
                      <td title={dateTime(order.createdAt)}>
                        {time(order.createdAt)}
                        {order.status === 'PENDING' && <div className="small text-muted-2">{waitingFor(order.createdAt)}</div>}
                      </td>
                      <td className="cell-title">{order.sellerName ?? '—'}</td>
                      <td>{order.customerName ?? <span className="text-muted-2">Consumidor final</span>}</td>
                      <td className="num">{int(order.itemsCount)}</td>
                      <td>
                        <StatusBadge tone={label.tone}>{label.label}</StatusBadge>
                      </td>
                      <td className="num fw-semibold">{money(order.estimatedTotal)}</td>
                      <td className="text-end" onClick={(event) => event.stopPropagation()}>
                        {order.status === 'PENDING' && canCharge && (
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => charge(order)}>
                            <i className="bi bi-cash-coin me-1" aria-hidden="true" />
                            Cobrar
                          </button>
                        )}
                        {order.status === 'CHARGED' && order.saleId && (
                          <Link href={`/ventas/${order.saleId}`} className="btn btn-sm btn-outline-secondary">
                            Ver venta
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
        {orders.data && <Pagination page={orders.data.page} pages={orders.data.pages} total={orders.data.total} limit={orders.data.limit} onPage={setPage} />}
      </section>
    </>
  );
}

/** "hace 7 min" para que el cajero vea cuánto hace que espera el cliente. */
function waitingFor(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `hace ${hours} h` : `hace ${Math.floor(hours / 24)} d`;
}
