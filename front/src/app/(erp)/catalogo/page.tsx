'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { productsApi } from '@/lib/api/endpoints';
import type { ProductSort } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { money, pct, qty } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useDebounce } from '@/lib/hooks/useDebounce';

export default function CatalogPage() {
  return (
    <RequireCapability capability="catalog.view">
      <Catalog />
    </RequireCapability>
  );
}

function vatLabel(treatment: string, rate: number): string {
  if (treatment === 'EXEMPT') return 'Exento';
  if (treatment === 'NOT_TAXED') return 'No gravado';
  return `${rate.toLocaleString('es-AR')} %`;
}

function Catalog() {
  const router = useRouter();
  const { activeBranchId, activeBranch, can } = useSession();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [lowStock, setLowStock] = useState(false);
  const [sort, setSort] = useState<ProductSort>('name');
  const [page, setPage] = useState(1);
  const term = useDebounce(search, 300);

  const facets = useApiQuery(() => productsApi.facets(), []);
  const products = useApiQuery(
    (signal) =>
      productsApi.list(
        { page, limit: 25, search: term.trim() || undefined, category: category || undefined, brand: brand || undefined, status, lowStock: lowStock || undefined, sort, branchId: activeBranchId ?? undefined },
        signal,
      ),
    [page, term, category, brand, status, lowStock, sort, activeBranchId],
  );

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const showBranch = Boolean(activeBranchId);
  const canOpen = can('catalog.manage') || can('stock.adjust') || can('catalog.create');

  return (
    <>
      <PageHeader
        eyebrow="Mercadería"
        title="Catálogo y precios"
        subtitle={showBranch ? `Precios y stock de ${activeBranch?.name}` : 'Stock total de todas las sucursales. Elegí una sucursal arriba para ver sus precios.'}
        actions={
          <>
            {can('catalog.manage') && (
              <Link href="/catalogo/aumentos" className="btn btn-sm btn-outline-primary">
                <i className="bi bi-percent me-1" aria-hidden="true" />
                Actualizar precios
              </Link>
            )}
            {can('catalog.create') && (
              <Link href="/catalogo/nuevo" className="btn btn-sm btn-primary">
                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                Nuevo producto
              </Link>
            )}
          </>
        }
      />

      <section className="surface">
        <div className="toolbar">
          <div className="search-field">
            <i className="bi bi-search" aria-hidden="true" />
            <input className="form-control form-control-sm" placeholder="Nombre, SKU o código de barras" value={search} onChange={(event) => resetPage(setSearch)(event.target.value)} />
          </div>
          <select className="form-select form-select-sm w-auto" value={category} onChange={(event) => resetPage(setCategory)(event.target.value)} aria-label="Rubro">
            <option value="">Todos los rubros</option>
            {facets.data?.categories.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name} ({item.count})
              </option>
            ))}
          </select>
          <select className="form-select form-select-sm w-auto" value={brand} onChange={(event) => resetPage(setBrand)(event.target.value)} aria-label="Marca">
            <option value="">Todas las marcas</option>
            {facets.data?.brands.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name} ({item.count})
              </option>
            ))}
          </select>
          <select className="form-select form-select-sm w-auto" value={status} onChange={(event) => resetPage(setStatus)(event.target.value as 'active' | 'inactive' | 'all')} aria-label="Estado">
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </select>
          <select className="form-select form-select-sm w-auto" value={sort} onChange={(event) => resetPage(setSort)(event.target.value as ProductSort)} aria-label="Orden">
            <option value="name">Orden: nombre</option>
            <option value="sku">Orden: SKU</option>
            <option value="stock">Orden: stock</option>
            <option value="updated">Orden: últimos modificados</option>
          </select>
          <div className="form-check form-switch mb-0 ms-1">
            <input id="low" className="form-check-input" type="checkbox" checked={lowStock} onChange={(event) => resetPage(setLowStock)(event.target.checked)} />
            <label className="form-check-label small" htmlFor="low">
              Bajo mínimo
            </label>
          </div>
        </div>

        {products.error && (
          <div className="p-3 pb-0">
            <ErrorAlert message={products.error} onRetry={products.reload} />
          </div>
        )}

        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Rubro / marca</th>
                <th>IVA</th>
                {showBranch && <th className="num">Costo</th>}
                {showBranch && <th className="num">Margen</th>}
                {showBranch && <th className="num">Precio</th>}
                <th className="num">{showBranch ? 'Stock' : 'Stock total'}</th>
                <th />
              </tr>
            </thead>
            {products.loading && !products.data ? (
              <SkeletonRows columns={showBranch ? 8 : 5} />
            ) : products.data && products.data.items.length === 0 ? (
              <TableMessage colSpan={showBranch ? 8 : 5}>
                <EmptyState icon="bi-tags" title="No hay productos con esos filtros" action={can('catalog.create') && <Link href="/catalogo/nuevo" className="btn btn-sm btn-primary">Cargar producto</Link>} />
              </TableMessage>
            ) : (
              <tbody>
                {products.data?.items.map((product) => {
                  const branch = product.branch;
                  const stock = branch?.stock ?? product.totalStock ?? 0;
                  const stockTone = stock <= 0 ? 'out' : branch?.belowMinimum ? 'low' : 'ok';
                  return (
                    <tr key={product.id} className={canOpen ? 'clickable' : ''} onClick={() => canOpen && router.push(`/catalogo/${product.id}`)}>
                      <td>
                        <div className="cell-title">{product.name}</div>
                        <div className="cell-sub mono">
                          {product.sku}
                          {product.barcode ? ` · ${product.barcode}` : ''}
                        </div>
                      </td>
                      <td>
                        <div>{product.category ?? <span className="text-muted-2">Sin rubro</span>}</div>
                        <div className="cell-sub">{product.brand ?? ''}</div>
                      </td>
                      <td>
                        <span className="small">{vatLabel(product.vatTreatment, product.taxRate)}</span>
                        <div className="cell-sub">{product.priceIncludesVat ? 'Precio final' : 'Precio + IVA'}</div>
                      </td>
                      {showBranch && <td className="num text-muted-2">{branch ? money(branch.costPrice) : '—'}</td>}
                      {showBranch && <td className="num text-muted-2">{branch ? pct(branch.profitMargin) : '—'}</td>}
                      {showBranch && <td className="num fw-semibold">{branch ? money(branch.sellingPrice) : <span className="text-muted-2 small">No se vende aquí</span>}</td>}
                      <td className="num">
                        <span className={`stock-cell ${stockTone}`}>{qty(stock)}</span>
                      </td>
                      <td className="text-end">{!product.status && <StatusBadge tone="slate">Inactivo</StatusBadge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
        {products.data && <Pagination page={products.data.page} pages={products.data.pages} total={products.data.total} limit={products.data.limit} onPage={setPage} />}
      </section>
    </>
  );
}
