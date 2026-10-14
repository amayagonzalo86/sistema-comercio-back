import { CustomerBlock, DocumentHeader } from '@/components/print/DocumentHeader';
import type { Letterhead, PrintCustomer, SalesQuote } from '@/lib/api/types';
import { dateTime, money, qty, toNumber } from '@/lib/format';

/** "vence en 5 h 12 min" a partir de los milisegundos restantes. */
export function remainingLabel(ms: number): string {
  if (ms <= 0) return 'vencido';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * Presupuesto X imprimible: no es un comprobante fiscal. En el sistema se borra a las 24 horas,
 * pero al cliente se le informa la validez comercial que define la empresa (printedValidityHours).
 */
export function QuoteTicket({ quote, letterhead, fallbackName }: { quote: SalesQuote; letterhead?: Letterhead | null; fallbackName?: string | null }) {
  const validity = quote.printedValidityHours ?? 72;
  const customer: PrintCustomer | null =
    quote.customer ??
    (quote.customerPersonId && quote.customerName
      ? { id: quote.customerPersonId, accountNumber: null, name: quote.customerName, address: null, city: null, province: null, vatCondition: 'CONSUMIDOR_FINAL', documentType: null, nationalId: null }
      : null);
  return (
    <article className="invoice-sheet mx-auto">
      <DocumentHeader
        letterhead={letterhead}
        fallbackName={fallbackName}
        letter="X"
        letterNote="No válido como factura"
        title="Presupuesto"
        number={String(quote.number).padStart(8, '0')}
        issuedAt={dateTime(quote.createdAt)}
        extra={<div className="fw-semibold">Validez: {validity} horas</div>}
      />
      <CustomerBlock customer={customer} sellerName={quote.sellerName} saleCondition="Contado" />

      <table>
        <thead>
          <tr>
            <th>Artículo</th>
            <th className="text-end">Cant.</th>
            <th className="text-end">Precio</th>
            <th className="text-end">Importe</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((line) => (
            <tr key={line.productId}>
              <td>
                <div>{line.name}</div>
                <div className="small text-muted-2 mono">
                  {line.sku}
                  {toNumber(line.discount) > 0 && <span className="text-success"> · promoción −{money(line.discount)}</span>}
                </div>
              </td>
              <td className="text-end mono">{qty(line.quantity)}</td>
              <td className="text-end mono">{money(line.unitPrice)}</td>
              <td className="text-end mono">{money(line.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="invoice-block d-flex justify-content-end">
        <div style={{ minWidth: 260 }}>
          {toNumber(quote.taxTotal) > 0 && (
            <div className="d-flex justify-content-between small">
              <span>IVA incluido</span>
              <span className="mono">{money(quote.taxTotal)}</span>
            </div>
          )}
          {quote.vatRegime === 'TIERRA_DEL_FUEGO' && <div className="small text-muted-2 text-end">Sin IVA · Ley 19.640</div>}
          <div className="d-flex justify-content-between border-top pt-1 mt-1">
            <strong>Total</strong>
            <strong className="mono fs-5">{money(quote.total)}</strong>
          </div>
        </div>
      </div>
      {quote.notes && <div className="small px-3 pb-2">Nota: {quote.notes}</div>}
      <p className="legal-note m-3">
        Presupuesto válido por {validity} horas desde su emisión. Documento no válido como factura. Precios sujetos a
        disponibilidad de stock; al comprar se emite la factura correspondiente.
      </p>
    </article>
  );
}
