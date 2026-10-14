'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { remainingLabel } from '@/components/sales/QuoteTicket';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { salesQuotesApi } from '@/lib/api/endpoints';
import type { SalesQuote } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { dateTime, money } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

export default function SalesQuotesPage() {
  return (
    <RequireCapability capability="salesQuotes.create">
      <SalesQuotes />
    </RequireCapability>
  );
}

function SalesQuotes() {
  const router = useRouter();
  const toast = useToast();
  const { activeBranchId, user } = useSession();
  const [page, setPage] = useState(1);
  const [numberInput, setNumberInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const quotes = useApiQuery(() => salesQuotesApi.list({ page, limit: 25, branchId: activeBranchId ?? undefined }), [page, activeBranchId]);
  const loadedAt = useLoadedAt(quotes.data);

  // Cuenta regresiva: se actualiza cada 30 s; al vencer, el presupuesto desaparece de la lista.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = (quote: SalesQuote) => quote.remainingMs - (now - loadedAt);

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const number = Number(numberInput.trim());
    if (!Number.isInteger(number) || number < 1) return;
    try {
      const quote = await salesQuotesApi.byNumber(number);
      router.push(`/ventas/presupuestos/${quote.id}`);
    } catch (caught) {
      toast.error('No se encontró el presupuesto', errorMessage(caught));
    }
  };

  const convert = async (quote: SalesQuote) => {
    setBusy(quote.id);
    try {
      const order = await salesQuotesApi.convert(quote.id);
      toast.success(`Presupuesto N.º ${quote.number} pasado a pedido`, `Pedido N.º ${order.number}: el cliente lo paga en caja.`);
      router.push(`/ventas/pedidos/${order.id}`);
    } catch (caught) {
      toast.error('No se pudo pasar a pedido', errorMessage(caught));
      quotes.reload();
    } finally {
      setBusy(null);
    }
  };

  const discard = async (quote: SalesQuote) => {
    setBusy(quote.id);
    try {
      await salesQuotesApi.remove(quote.id);
      toast.success(`Presupuesto N.º ${quote.number} descartado`);
      quotes.reload();
    } catch (caught) {
      toast.error('No se pudo descartar', errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const visible = (quotes.data?.items ?? []).filter((quote) => remaining(quote) > 0);

  return (
    <>
      <PageHeader
        eyebrow="Ventas"
        title="Presupuestos X"
        subtitle="Se guardan 24 horas en el sistema y después se borran solos (el impreso le informa al cliente 72 horas de validez). Si el cliente vuelve a tiempo, quien emitió el presupuesto lo pasa a pedido para cobrarlo en caja."
        actions={
          <Link href="/ventas/pos" className="btn btn-sm btn-primary">
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            Nuevo presupuesto
          </Link>
        }
      />
      <section className="surface">
        <div className="toolbar">
          <form className="ms-auto" onSubmit={(event) => void lookup(event)}>
            <div className="input-group input-group-sm" style={{ maxWidth: 240 }}>
              <span className="input-group-text">N.º</span>
              <input
                className="form-control mono"
                inputMode="numeric"
                placeholder="Buscar presupuesto"
                value={numberInput}
                onChange={(event) => setNumberInput(event.target.value.replace(/\D/g, '').slice(0, 10))}
                aria-label="Número de presupuesto"
              />
              <button type="submit" className="btn btn-outline-primary" aria-label="Buscar">
                <i className="bi bi-search" aria-hidden="true" />
              </button>
            </div>
          </form>
        </div>
        {quotes.error && (
          <div className="p-3 pb-0">
            <ErrorAlert message={quotes.error} onRetry={quotes.reload} />
          </div>
        )}
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>N.º</th>
                <th>Emitido</th>
                <th>Cliente</th>
                <th>Vendedor</th>
                <th className="num">Total</th>
                <th>Vence en</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            {quotes.loading && !quotes.data ? (
              <SkeletonRows columns={7} />
            ) : visible.length === 0 ? (
              <TableMessage colSpan={7}>
                <EmptyState icon="bi-file-earmark-text" title="No hay presupuestos vigentes">
                  Se emiten desde el punto de venta con «Presupuesto X».
                </EmptyState>
              </TableMessage>
            ) : (
              <tbody>
                {visible.map((quote) => {
                  const left = remaining(quote);
                  const mine = quote.sellerUserId === user?.id;
                  return (
                    <tr key={quote.id} className="clickable" onClick={() => router.push(`/ventas/presupuestos/${quote.id}`)}>
                      <td className="mono fw-semibold">#{quote.number}</td>
                      <td>{dateTime(quote.createdAt)}</td>
                      <td>{quote.customerName ?? <span className="text-muted-2">Consumidor final</span>}</td>
                      <td>{quote.sellerName ?? '—'}</td>
                      <td className="num fw-semibold">{money(quote.total)}</td>
                      <td className={left < 3_600_000 ? 'text-danger fw-semibold' : ''}>{remainingLabel(left)}</td>
                      <td className="text-end text-nowrap" onClick={(event) => event.stopPropagation()}>
                        {mine && (
                          <button type="button" className="btn btn-sm btn-primary me-1" disabled={busy === quote.id} onClick={() => void convert(quote)}>
                            <i className="bi bi-card-checklist me-1" aria-hidden="true" />
                            Pasar a pedido
                          </button>
                        )}
                        <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy === quote.id} onClick={() => void discard(quote)} aria-label={`Descartar presupuesto ${quote.number}`}>
                          <i className="bi bi-trash3" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
        {quotes.data && <Pagination page={quotes.data.page} pages={quotes.data.pages} total={quotes.data.total} limit={quotes.data.limit} onPage={setPage} />}
      </section>
    </>
  );
}

/** Momento en que llegaron los datos: la cuenta regresiva se calcula desde ahí. */
function useLoadedAt(data: unknown): number {
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  useEffect(() => {
    setLoadedAt(Date.now());
  }, [data]);
  return loadedAt;
}
