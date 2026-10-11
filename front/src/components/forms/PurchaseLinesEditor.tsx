'use client';

import { VAT_RATES, type ProductListItem, type Uuid } from '@/lib/api/types';
import { money, parseLocaleNumber } from '@/lib/format';
import { ProductSearch } from './ProductSearch';

export interface PurchaseLineDraft {
  productId: Uuid;
  sku: string;
  name: string;
  quantity: string;
  unitCost: string;
  taxRate: number;
  /** Solo informativo en recepciones de pedidos: cantidad pendiente de recibir. */
  pending?: string;
}

export function draftFromProduct(product: ProductListItem): PurchaseLineDraft {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    quantity: '1',
    unitCost: product.branch ? String(product.branch.costPrice) : '',
    taxRate: product.vatTreatment === 'TAXED' ? product.taxRate : 0,
  };
}

export function lineTotals(lines: PurchaseLineDraft[]): { net: number; vat: number; total: number } {
  let net = 0;
  let vat = 0;
  for (const line of lines) {
    const amount = (parseLocaleNumber(line.quantity) || 0) * (parseLocaleNumber(line.unitCost) || 0);
    net += amount;
    vat += amount * (line.taxRate / 100);
  }
  return { net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100, total: Math.round((net + vat) * 100) / 100 };
}

interface PurchaseLinesEditorProps {
  branchId: Uuid | null;
  lines: PurchaseLineDraft[];
  onChange: (lines: PurchaseLineDraft[]) => void;
  /** Permite agregar productos que no estaban en el pedido. */
  allowAdd?: boolean;
  costLabel?: string;
}

/** Grilla de renglones de compra (pedido o recepción): cantidad, costo unitario sin IVA y alícuota. */
export function PurchaseLinesEditor({ branchId, lines, onChange, allowAdd = true, costLabel = 'Costo unit. sin IVA' }: PurchaseLinesEditorProps) {
  const update = (productId: Uuid, patch: Partial<PurchaseLineDraft>) => onChange(lines.map((line) => (line.productId === productId ? { ...line, ...patch } : line)));
  const totals = lineTotals(lines);

  return (
    <div>
      {allowAdd && (
        <div className="mb-3">
          <ProductSearch
            branchId={branchId}
            onPick={(product) => {
              if (lines.some((line) => line.productId === product.id)) return;
              onChange([...lines, draftFromProduct(product)]);
            }}
            placeholder="Agregar producto al pedido…"
          />
        </div>
      )}
      <div className="table-responsive">
        <table className="table table-erp">
          <thead>
            <tr>
              <th>Producto</th>
              {lines.some((line) => line.pending !== undefined) && <th className="num">Pendiente</th>}
              <th className="num" style={{ width: 120 }}>Cantidad</th>
              <th className="num" style={{ width: 150 }}>{costLabel}</th>
              <th className="num" style={{ width: 110 }}>IVA</th>
              <th className="num">Subtotal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const subtotal = (parseLocaleNumber(line.quantity) || 0) * (parseLocaleNumber(line.unitCost) || 0);
              return (
                <tr key={line.productId}>
                  <td>
                    <div className="cell-title">{line.name}</div>
                    <div className="cell-sub mono">{line.sku}</div>
                  </td>
                  {lines.some((item) => item.pending !== undefined) && <td className="num text-muted-2">{line.pending ?? '—'}</td>}
                  <td>
                    <input className="form-control form-control-sm mono text-end" inputMode="decimal" value={line.quantity} onChange={(event) => update(line.productId, { quantity: event.target.value })} aria-label={`Cantidad de ${line.name}`} />
                  </td>
                  <td>
                    <input className="form-control form-control-sm mono text-end" inputMode="decimal" value={line.unitCost} onChange={(event) => update(line.productId, { unitCost: event.target.value })} aria-label={`Costo de ${line.name}`} />
                  </td>
                  <td>
                    <select className="form-select form-select-sm" value={line.taxRate} onChange={(event) => update(line.productId, { taxRate: Number(event.target.value) })} aria-label={`IVA de ${line.name}`}>
                      {VAT_RATES.map((rate) => (
                        <option key={rate} value={rate}>{rate.toLocaleString('es-AR')} %</option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{money(subtotal)}</td>
                  <td className="text-end">
                    <button type="button" className="btn btn-sm btn-link text-muted-2" onClick={() => onChange(lines.filter((item) => item.productId !== line.productId))} aria-label={`Quitar ${line.name}`}>
                      <i className="bi bi-trash3" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted-2 py-4">Todavía no hay productos.</td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={lines.some((line) => line.pending !== undefined) ? 5 : 4} className="text-end text-muted-2">Neto</td>
                <td className="num">{money(totals.net)}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={lines.some((line) => line.pending !== undefined) ? 5 : 4} className="text-end text-muted-2">IVA crédito fiscal</td>
                <td className="num">{money(totals.vat)}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={lines.some((line) => line.pending !== undefined) ? 5 : 4} className="text-end fw-semibold">Total</td>
                <td className="num fw-semibold">{money(totals.total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
