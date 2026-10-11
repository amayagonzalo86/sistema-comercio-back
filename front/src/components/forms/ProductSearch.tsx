'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { productsApi } from '@/lib/api/endpoints';
import type { ProductListItem, Uuid } from '@/lib/api/types';
import { money, qty } from '@/lib/format';
import { useDebounce } from '@/lib/hooks/useDebounce';

export interface ProductSearchHandle {
  focus: () => void;
}

interface ProductSearchProps {
  branchId?: Uuid | null;
  onPick: (product: ProductListItem) => void;
  placeholder?: string;
  /** Variante grande para el punto de venta (lector de código de barras). */
  large?: boolean;
  shortcutHint?: string;
  autoFocus?: boolean;
}

/**
 * Buscador de productos por nombre, SKU o código de barras. Con lector: el código + Enter agrega directo
 * si hay coincidencia exacta. Flechas y Enter para elegir sin mouse.
 */
export const ProductSearch = forwardRef<ProductSearchHandle, ProductSearchProps>(function ProductSearch(
  { branchId, onPick, placeholder = 'Buscar producto por nombre, SKU o código de barras…', large = false, shortcutHint, autoFocus = false },
  ref,
) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ProductListItem[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounce(term, 200);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  useEffect(() => {
    const search = debounced.trim();
    if (search.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    productsApi
      .list({ search, branchId: branchId ?? undefined, limit: 8, status: 'active' }, controller.signal)
      .then((page) => {
        setResults(page.items);
        setActive(0);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResults([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [debounced, branchId]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (product: ProductListItem) => {
    onPick(product);
    setTerm('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  /** Enter con un código escaneado: busca coincidencia exacta aunque la búsqueda diferida no haya terminado. */
  const pickExact = async (code: string) => {
    const page = await productsApi.list({ search: code, branchId: branchId ?? undefined, limit: 5, status: 'active' });
    const exact = page.items.find((item) => item.barcode === code || item.sku.toLowerCase() === code.toLowerCase());
    if (exact) pick(exact);
    else {
      setResults(page.items);
      setOpen(true);
    }
  };

  const visible = open && term.trim().length >= 2;

  return (
    <div className={large ? 'pos-search' : 'position-relative'} ref={wrapperRef}>
      {large ? <i className="bi bi-upc-scan" aria-hidden="true" /> : null}
      <div className={large ? '' : 'search-field mw-100'}>
        {!large && <i className="bi bi-search" aria-hidden="true" />}
        <input
          ref={inputRef}
          className="form-control"
          value={term}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((value) => Math.min(results.length - 1, value + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((value) => Math.max(0, value - 1));
            } else if (event.key === 'Escape') {
              setOpen(false);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const code = term.trim();
              const exact = results.find((item) => item.barcode === code || item.sku.toLowerCase() === code.toLowerCase());
              if (exact) pick(exact);
              else if (results[active] && debounced.trim() === code) pick(results[active]);
              else if (code.length >= 2) void pickExact(code);
            }
          }}
          aria-label="Buscar producto"
        />
      </div>
      {large && shortcutHint && <kbd className="k pos-kbd">{shortcutHint}</kbd>}
      {visible && (
        <div className="surface pos-results" role="listbox">
          {loading && results.length === 0 && <div className="small text-muted-2 p-3">Buscando…</div>}
          {!loading && results.length === 0 && <div className="small text-muted-2 p-3">Sin coincidencias para “{term.trim()}”.</div>}
          {results.map((product, index) => {
            const stock = product.branch?.stock ?? product.totalStock;
            const price = product.branch?.sellingPrice;
            return (
              <div
                key={product.id}
                className={`result ${index === active ? 'active' : ''}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(product);
                }}
              >
                <div className="flex-grow-1 min-w-0">
                  <div className="text-ink fw-medium text-truncate">{product.name}</div>
                  <div className="small text-muted-2 mono">
                    {product.sku}
                    {product.barcode ? ` · ${product.barcode}` : ''}
                    {product.brand ? <span className="font-sans"> · {product.brand}</span> : null}
                  </div>
                </div>
                {stock !== undefined && (
                  <span className={`stock-cell ${stock <= 0 ? 'out' : product.branch?.belowMinimum ? 'low' : 'ok'}`} title="Stock">
                    {qty(stock)}
                  </span>
                )}
                {price !== undefined && <span className="mono fw-semibold text-ink" style={{ minWidth: 96, textAlign: 'right' }}>{money(price)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
