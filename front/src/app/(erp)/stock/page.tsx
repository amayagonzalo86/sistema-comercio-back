'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { inventoryApi, productsApi } from '@/lib/api/endpoints';
import { useBranchName, useSession } from '@/lib/auth/session';
import { qty, toNumber } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useDebounce } from '@/lib/hooks/useDebounce';

export default function StockPage() {
  return (
    <RequireCapability capability="stock.view">
      <Stock />
    </RequireCapability>
  );
}

function Stock() {
  const [view, setView] = useState<'matrix' | 'low'>('matrix');

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('bajo')) setView('low');
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Mercadería"
        title="Stock por sucursal"
        subtitle="Existencias de todas las sucursales en una sola vista, con alertas de mínimo."
        actions={
          <>
            <div className="segmented">
              <button type="button" className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')}>
                Matriz
              </button>
              <button type="button" className={view === 'low' ? 'active' : ''} onClick={() => setView('low')}>
                Bajo mínimo
              </button>
            </div>
            <Link href="/stock/reposicion" className="btn btn-sm btn-outline-primary">
              <i className="bi bi-lightning-charge me-1" aria-hidden="true" />
              Reposición sugerida
            </Link>
            <Link href="/stock/transferencias" className="btn btn-sm btn-primary">
              <i className="bi bi-truck me-1" aria-hidden="true" />
              Transferencias
            </Link>
          </>
        }
      />
      {view === 'matrix' ? <Matrix /> : <LowStock />}
    </>
  );
}

function Matrix() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounce(search, 300);
  const facets = useApiQuery(() => productsApi.facets(), []);
  const matrix = useApiQuery((signal) => inventoryApi.matrix({ page, limit: 50, search: term.trim() || undefined, category: category || undefined }, signal), [page, term, category]);
  const branches = matrix.data?.branches ?? [];

  return (
    <section className="surface">
      <div className="toolbar">
        <div className="search-field">
          <i className="bi bi-search" aria-hidden="true" />
          <input className="form-control form-control-sm" placeholder="Buscar producto o SKU" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </div>
        <select className="form-select form-select-sm w-auto" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} aria-label="Rubro">
          <option value="">Todos los rubros</option>
          {facets.data?.categories.map((item) => (
            <option key={item.name} value={item.name}>{item.name}</option>
          ))}
        </select>
        <div className="ms-auto d-flex gap-3 small text-muted-2">
          <span><span className="stock-cell ok">12</span> normal</span>
          <span><span className="stock-cell low">3</span> bajo mínimo</span>
          <span><span className="stock-cell out">0</span> sin stock</span>
        </div>
      </div>
      {matrix.error && <div className="p-3 pb-0"><ErrorAlert message={matrix.error} onRetry={matrix.reload} /></div>}
      <div className="table-scroll">
        <table className="table table-erp">
          <thead>
            <tr>
              <th>Producto</th>
              {branches.map((branch) => (
                <th key={branch.id} className="num" title={branch.name}>{branch.code}</th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          {matrix.loading && !matrix.data ? (
            <SkeletonRows columns={5} rows={10} />
          ) : matrix.data && matrix.data.items.length === 0 ? (
            <TableMessage colSpan={branches.length + 2}>
              <EmptyState icon="bi-boxes" title="Sin productos para mostrar" />
            </TableMessage>
          ) : (
            <tbody>
              {matrix.data?.items.map((row) => (
                <tr key={row.productId}>
                  <td>
                    <Link href={`/catalogo/${row.productId}`} className="cell-title text-decoration-none">{row.name}</Link>
                    <div className="cell-sub"><span className="mono">{row.sku}</span>{row.category ? ` · ${row.category}` : ''}</div>
                  </td>
                  {branches.map((branch) => {
                    const cell = row.branches[branch.id];
                    if (!cell) return <td key={branch.id} className="num"><span className="stock-cell none">—</span></td>;
                    const stock = toNumber(cell.stock);
                    const tone = stock <= 0 ? 'out' : cell.belowMinimum ? 'low' : 'ok';
                    return (
                      <td key={branch.id} className="num" title={`Mínimo ${qty(cell.minStock)}`}>
                        <span className={`stock-cell ${tone}`}>{qty(stock)}</span>
                      </td>
                    );
                  })}
                  <td className="num fw-semibold">{qty(row.totalStock)}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {matrix.data && <Pagination page={matrix.data.page} pages={matrix.data.pages} total={matrix.data.total} limit={matrix.data.limit} onPage={setPage} />}
    </section>
  );
}

function LowStock() {
  const { activeBranchId } = useSession();
  const branchName = useBranchName();
  const [page, setPage] = useState(1);
  const low = useApiQuery(() => inventoryApi.lowStock({ page, limit: 50, branchId: activeBranchId ?? undefined }), [page, activeBranchId]);

  return (
    <section className="surface">
      {low.error && <div className="p-3 pb-0"><ErrorAlert message={low.error} onRetry={low.reload} /></div>}
      <div className="table-responsive">
        <table className="table table-erp">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Sucursal</th>
              <th className="num">Stock</th>
              <th className="num">Mínimo</th>
              <th className="num">Faltante</th>
            </tr>
          </thead>
          {low.loading && !low.data ? (
            <SkeletonRows columns={5} />
          ) : low.data && low.data.items.length === 0 ? (
            <TableMessage colSpan={5}>
              <EmptyState icon="bi-check2-circle" title="Todo en orden">Ningún producto está por debajo del mínimo.</EmptyState>
            </TableMessage>
          ) : (
            <tbody>
              {low.data?.items.map((row) => (
                <tr key={`${row.productId}-${row.branchId}`}>
                  <td>
                    <Link href={`/catalogo/${row.productId}`} className="cell-title text-decoration-none">{row.name}</Link>
                    <div className="cell-sub mono">{row.sku}</div>
                  </td>
                  <td>{branchName(row.branchId)}</td>
                  <td className="num"><span className={`stock-cell ${toNumber(row.stock) <= 0 ? 'out' : 'low'}`}>{qty(row.stock)}</span></td>
                  <td className="num text-muted-2">{qty(row.minStock)}</td>
                  <td className="num fw-semibold text-danger">{qty(row.missing)}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {low.data && <Pagination page={low.data.page} pages={low.data.pages} total={low.data.total} limit={low.data.limit} onPage={setPage} />}
    </section>
  );
}
