'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLetterhead } from '@/components/print/DocumentHeader';
import { QuoteTicket, remainingLabel } from '@/components/sales/QuoteTicket';
import { ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { salesQuotesApi } from '@/lib/api/endpoints';
import { useSession } from '@/lib/auth/session';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

export default function SalesQuoteDetailPage() {
  return (
    <RequireCapability capability="salesQuotes.create">
      <SalesQuoteDetail />
    </RequireCapability>
  );
}

function SalesQuoteDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { user, tenant } = useSession();
  const [busy, setBusy] = useState(false);
  const quote = useApiQuery(() => salesQuotesApi.get(params.id), [params.id]);
  const letterhead = useLetterhead(quote.data?.branchId);

  if (quote.loading && !quote.data) return <Spinner label="Cargando presupuesto…" />;
  if (quote.error || !quote.data) {
    return (
      <ErrorAlert message={quote.status === 404 ? 'El presupuesto no existe o ya venció (se guardan 24 horas en el sistema).' : quote.error ?? 'Presupuesto no encontrado.'} onRetry={quote.reload} />
    );
  }
  const data = quote.data;
  const mine = data.sellerUserId === user?.id;

  const convert = async () => {
    setBusy(true);
    try {
      const order = await salesQuotesApi.convert(data.id);
      toast.success(`Presupuesto N.º ${data.number} pasado a pedido`, `Pedido N.º ${order.number}: el cliente lo paga en caja.`);
      router.push(`/ventas/pedidos/${order.id}`);
    } catch (caught) {
      toast.error('No se pudo pasar a pedido', errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3 no-print">
        <Link href="/ventas/presupuestos" className="btn btn-sm btn-link px-0">
          <i className="bi bi-arrow-left me-1" aria-hidden="true" />
          Presupuestos X
        </Link>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="small text-muted-2" title="Plazo interno del sistema; el impreso informa al cliente la validez comercial.">Se borra del sistema en {remainingLabel(data.remainingMs)}</span>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => window.print()}>
            <i className="bi bi-printer me-1" aria-hidden="true" />
            Imprimir
          </button>
          {mine ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void convert()} disabled={busy}>
              {busy ? <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" /> : <i className="bi bi-card-checklist me-1" aria-hidden="true" />}
              Pasar a pedido
            </button>
          ) : (
            <span className="small text-muted-2">Solo {data.sellerName ?? 'quien lo emitió'} puede pasarlo a pedido.</span>
          )}
        </div>
      </div>
      <QuoteTicket quote={data} letterhead={letterhead.data} fallbackName={tenant?.tradeName || tenant?.legalName} />
    </>
  );
}
