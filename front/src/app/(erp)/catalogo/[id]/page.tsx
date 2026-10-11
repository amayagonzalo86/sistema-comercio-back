'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { productsApi } from '@/lib/api/endpoints';
import { VAT_RATES, type Product, type ProductBranchSetting, type VatTreatment } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { dateTime, money, parseLocaleNumber, pct, qty, toNumber } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { MOVEMENT_LABEL } from '@/lib/labels';

export default function ProductPage() {
  return (
    <RequireCapability capability="catalog.view">
      <ProductDetail />
    </RequireCapability>
  );
}

function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const { can, branches, activeBranchId } = useSession();
  const branchName = useBranchName();
  const toast = useToast();
  const product = useApiQuery(() => productsApi.get(id), [id]);
  const [priceRow, setPriceRow] = useState<{ branchId: string; setting: ProductBranchSetting | null } | null>(null);
  const [adjustBranch, setAdjustBranch] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [vatOpen, setVatOpen] = useState(false);
  const [kardexBranch, setKardexBranch] = useState<string>('');
  const history = useApiQuery(() => productsApi.priceHistory(id, { limit: 15 }), [id, product.data?.updatedAt], can('reports.view') || can('catalog.manage'));
  const kardexBranchId = kardexBranch || activeBranchId || branches[0]?.id || '';
  const kardex = useApiQuery(() => productsApi.movements(id, kardexBranchId, { limit: 30 }), [id, kardexBranchId, product.data?.updatedAt], can('stock.adjust') && Boolean(kardexBranchId));

  if (product.loading && !product.data) return <Spinner label="Cargando producto…" />;
  if (product.error || !product.data) return <ErrorAlert message={product.error ?? 'Producto no encontrado.'} onRetry={product.reload} />;
  const data = product.data;
  const settings = data.branchSettings ?? [];
  const totalStock = settings.reduce((sum, setting) => sum + toNumber(setting.stock), 0);

  const toggleStatus = async () => {
    const reason = data.status ? 'Producto discontinuado' : 'Producto reactivado';
    try {
      await productsApi.setStatus(data.id, !data.status, reason);
      toast.success(data.status ? 'Producto desactivado' : 'Producto activado');
      product.reload();
    } catch (caught) {
      toast.error('No se pudo cambiar el estado', errorMessage(caught));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={`${data.category ?? 'Sin rubro'}${data.brand ? ` · ${data.brand}` : ''}`}
        title={data.name}
        subtitle={
          <>
            <span className="mono">{data.sku}</span>
            {data.barcode && <span className="mono"> · EAN {data.barcode}</span>}
            {!data.status && <span className="ms-2"><StatusBadge tone="slate">Inactivo</StatusBadge></span>}
          </>
        }
        actions={
          <>
            <Link href="/catalogo" className="btn btn-sm btn-light">
              <i className="bi bi-arrow-left me-1" aria-hidden="true" />
              Catálogo
            </Link>
            {can('catalog.manage') && (
              <>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditOpen(true)}>
                  <i className="bi bi-pencil me-1" aria-hidden="true" />
                  Editar datos
                </button>
                <button type="button" className={`btn btn-sm ${data.status ? 'btn-outline-danger' : 'btn-outline-success'}`} onClick={() => void toggleStatus()}>
                  {data.status ? 'Desactivar' : 'Activar'}
                </button>
              </>
            )}
          </>
        }
      />

      <div className="row g-3 mb-3">
        <div className="col-md-4">
          <div className="surface kpi">
            <div className="kpi-label"><i className="bi bi-boxes" aria-hidden="true" />Stock total</div>
            <div className="kpi-value">{qty(totalStock)}</div>
            <div className="kpi-foot">{settings.length} sucursales</div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="surface kpi">
            <div className="kpi-label"><i className="bi bi-percent" aria-hidden="true" />IVA</div>
            <div className="kpi-value">{data.vatTreatment === 'TAXED' ? `${data.taxRate.toLocaleString('es-AR')} %` : data.vatTreatment === 'EXEMPT' ? 'Exento' : 'No gravado'}</div>
            <div className="kpi-foot">
              {data.priceIncludesVat ? 'Precio final con IVA' : 'Precio neto + IVA'}
              {can('catalog.manage') && (
                <button type="button" className="btn btn-link btn-sm p-0 ms-2" onClick={() => setVatOpen(true)}>
                  Cambiar
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="surface kpi">
            <div className="kpi-label"><i className="bi bi-tag" aria-hidden="true" />Rango de precios</div>
            <div className="kpi-value" style={{ fontSize: '1.2rem' }}>
              {settings.length ? `${money(Math.min(...settings.map((s) => toNumber(s.sellingPrice))))} – ${money(Math.max(...settings.map((s) => toNumber(s.sellingPrice))))}` : '—'}
            </div>
            <div className="kpi-foot">Según sucursal</div>
          </div>
        </div>
      </div>

      <Surface title="Precio y stock por sucursal" padded={false} className="mb-3">
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>Sucursal</th>
                <th className="num">Costo</th>
                <th className="num">Margen</th>
                <th className="num">Precio</th>
                <th className="num">Stock</th>
                <th className="num">Mínimo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => {
                const setting = settings.find((item) => item.branchId === branch.id) ?? null;
                const stock = toNumber(setting?.stock);
                const tone = !setting ? 'none' : stock <= 0 ? 'out' : stock <= toNumber(setting.minStock) ? 'low' : 'ok';
                return (
                  <tr key={branch.id}>
                    <td className="cell-title">
                      {branch.name}
                      {setting && !setting.isActive && <span className="ms-2"><StatusBadge tone="slate">No se vende</StatusBadge></span>}
                    </td>
                    <td className="num text-muted-2">{setting ? money(setting.costPrice) : '—'}</td>
                    <td className="num text-muted-2">{setting ? pct(setting.profitMargin) : '—'}</td>
                    <td className="num fw-semibold">{setting ? money(setting.sellingPrice) : '—'}</td>
                    <td className="num"><span className={`stock-cell ${tone}`}>{setting ? qty(stock) : '—'}</span></td>
                    <td className="num text-muted-2">{setting ? qty(setting.minStock) : '—'}</td>
                    <td className="text-end text-nowrap">
                      {can('catalog.manage') && (
                        <button type="button" className="btn btn-sm btn-outline-secondary me-1" onClick={() => setPriceRow({ branchId: branch.id, setting })}>
                          {setting ? 'Precio' : 'Habilitar'}
                        </button>
                      )}
                      {can('stock.adjust') && setting && (
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAdjustBranch(branch.id)}>
                          Ajustar stock
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Surface>

      <div className="row g-3">
        {history.data && (
          <div className="col-xl-6">
            <Surface title="Historial de precios" padded={false}>
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Sucursal</th>
                    <th className="num">Costo</th>
                    <th className="num">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.items.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        {dateTime(entry.createdAt)}
                        <div className="cell-sub">{entry.reason}</div>
                      </td>
                      <td>{branchName(entry.branchId)}</td>
                      <td className="num small">
                        <span className="text-muted-2">{money(entry.oldCostPrice)}</span> → {money(entry.newCostPrice)}
                      </td>
                      <td className="num small">
                        <span className="text-muted-2">{money(entry.oldSellingPrice)}</span> → <strong>{money(entry.newSellingPrice)}</strong>
                      </td>
                    </tr>
                  ))}
                  {history.data.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-muted-2 py-3">Sin cambios de precio registrados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Surface>
          </div>
        )}
        {can('stock.adjust') && (
          <div className="col-xl-6">
            <Surface
              title="Movimientos de stock (kardex)"
              padded={false}
              actions={
                <select className="form-select form-select-sm" value={kardexBranchId} onChange={(event) => setKardexBranch(event.target.value)} aria-label="Sucursal del kardex">
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              }
            >
              {kardex.error && <div className="p-3"><ErrorAlert message={kardex.error} /></div>}
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Movimiento</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {kardex.data?.items.map((movement) => (
                    <tr key={movement.id}>
                      <td>{dateTime(movement.createdAt)}</td>
                      <td>
                        {MOVEMENT_LABEL[movement.movementType]}
                        <div className="cell-sub">{movement.reason}</div>
                      </td>
                      <td className={`num ${toNumber(movement.quantityDelta) >= 0 ? 'text-success' : 'text-danger'}`}>
                        {toNumber(movement.quantityDelta) > 0 ? '+' : ''}
                        {qty(movement.quantityDelta)}
                      </td>
                      <td className="num fw-semibold">{qty(movement.quantityAfter)}</td>
                    </tr>
                  ))}
                  {kardex.data && kardex.data.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-muted-2 py-3">Sin movimientos en esta sucursal.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Surface>
          </div>
        )}
      </div>

      {priceRow && (
        <BranchPriceModal
          productId={data.id}
          branchId={priceRow.branchId}
          setting={priceRow.setting}
          onClose={() => setPriceRow(null)}
          onSaved={() => {
            setPriceRow(null);
            toast.success('Precio actualizado', branchName(priceRow.branchId));
            product.reload();
          }}
        />
      )}
      {adjustBranch && (
        <AdjustStockModal
          productId={data.id}
          branchId={adjustBranch}
          current={toNumber(settings.find((item) => item.branchId === adjustBranch)?.stock)}
          onClose={() => setAdjustBranch(null)}
          onSaved={() => {
            setAdjustBranch(null);
            toast.success('Stock ajustado');
            product.reload();
          }}
        />
      )}
      <EditProductModal open={editOpen} product={data} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); toast.success('Producto actualizado'); product.reload(); }} />
      <VatModal open={vatOpen} product={data} onClose={() => setVatOpen(false)} onSaved={() => { setVatOpen(false); toast.success('IVA actualizado'); product.reload(); }} />
    </>
  );
}

function BranchPriceModal({ productId, branchId, setting, onClose, onSaved }: { productId: string; branchId: string; setting: ProductBranchSetting | null; onClose: () => void; onSaved: () => void }) {
  const branchName = useBranchName();
  const [cost, setCost] = useState(setting ? String(setting.costPrice) : '');
  const [margin, setMargin] = useState(setting ? String(setting.profitMargin) : '40');
  const [price, setPrice] = useState(setting ? String(setting.sellingPrice) : '');
  const [minStock, setMinStock] = useState(setting ? String(setting.minStock) : '0');
  const [active, setActive] = useState(setting?.isActive ?? true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = (value: string) => parseLocaleNumber(value);
  const impliedMargin = n(cost) > 0 && n(price) > 0 ? ((n(price) - n(cost)) / n(cost)) * 100 : null;

  const submit = async () => {
    if ([cost, price, minStock].some((value) => value && Number.isNaN(n(value)))) return setError('Revisá los importes: solo números.');
    setBusy(true);
    setError(null);
    try {
      await productsApi.upsertBranch(productId, branchId, {
        costPrice: cost ? Math.round(n(cost) * 100) / 100 : undefined,
        sellingPrice: price ? Math.round(n(price) * 100) / 100 : undefined,
        profitMargin: !price && margin ? Math.round(n(margin) * 100) / 100 : undefined,
        minStock: minStock ? Math.round(n(minStock) * 1000) / 1000 : undefined,
        isActive: active,
        reason: reason.trim() || undefined,
      });
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} busy={busy} size="sm" title={`Precio en ${branchName(branchId)}`} subtitle="El cambio queda en el historial de precios." footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>Guardar</button></>}>
      <div className="row g-3">
        <Field label="Costo" className="col-6">
          <input className="form-control mono" inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} />
        </Field>
        <Field label="Precio de venta" className="col-6" hint={impliedMargin !== null ? `Margen resultante ${pct(impliedMargin)}` : 'Vacío = costo × (1 + margen)'}>
          <input className="form-control mono" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <Field label="Margen % (si no cargás precio)" className="col-6">
          <input className="form-control mono" inputMode="decimal" value={margin} disabled={Boolean(price)} onChange={(event) => setMargin(event.target.value)} />
        </Field>
        <Field label="Stock mínimo" className="col-6">
          <input className="form-control mono" inputMode="decimal" value={minStock} onChange={(event) => setMinStock(event.target.value)} />
        </Field>
        <Field label="Motivo" className="col-12">
          <input className="form-control" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Ej.: nueva lista del proveedor" />
        </Field>
        <div className="col-12 form-check form-switch ms-2">
          <input id="active" type="checkbox" className="form-check-input" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <label htmlFor="active" className="form-check-label small">Se vende en esta sucursal</label>
        </div>
      </div>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}

function AdjustStockModal({ productId, branchId, current, onClose, onSaved }: { productId: string; branchId: string; current: number; onClose: () => void; onSaved: () => void }) {
  const branchName = useBranchName();
  const [mode, setMode] = useState<'count' | 'delta'>('count');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<{ signature: string; key: string } | null>(null);
  const parsed = parseLocaleNumber(value);
  const delta = Number.isNaN(parsed) ? null : Math.round((mode === 'count' ? parsed - current : parsed) * 1000) / 1000;

  const submit = async () => {
    if (delta === null || delta === 0) return setError(mode === 'count' ? 'El conteo coincide con el stock actual.' : 'Ingresá una cantidad distinta de cero.');
    if (reason.trim().length < 3) return setError('Indicá el motivo del ajuste (queda auditado).');
    const signature = `${delta}:${reason.trim()}`;
    if (!key.current || key.current.signature !== signature) key.current = { signature, key: newIdempotencyKey() };
    setBusy(true);
    setError(null);
    try {
      await productsApi.adjustStock(productId, branchId, delta, reason.trim(), key.current.key);
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} busy={busy} size="sm" title={`Ajustar stock · ${branchName(branchId)}`} subtitle={`Stock actual: ${qty(current)}`} footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>Registrar ajuste</button></>}>
      <div className="segmented w-100 mb-3">
        <button type="button" className={`flex-fill ${mode === 'count' ? 'active' : ''}`} onClick={() => setMode('count')}>Conteo físico</button>
        <button type="button" className={`flex-fill ${mode === 'delta' ? 'active' : ''}`} onClick={() => setMode('delta')}>Sumar / restar</button>
      </div>
      <Field label={mode === 'count' ? 'Cantidad contada' : 'Cantidad (+ o −)'} className="mb-3" hint={delta !== null && delta !== 0 ? `Se registrará ${delta > 0 ? '+' : ''}${qty(delta)}` : undefined}>
        <input className="form-control mono" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
      </Field>
      <Field label="Motivo" required>
        <input className="form-control" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Ej.: inventario mensual, rotura, vencimiento" />
      </Field>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}

function EditProductModal({ open, product, onClose, onSaved }: { open: boolean; product: Product; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', sku: '', barcode: '', category: '', brand: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ name: product.name, sku: product.sku, barcode: product.barcode ?? '', category: product.category ?? '', brand: product.brand ?? '', description: product.description ?? '' });
      setError(null);
    }
  }, [open, product]);

  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await productsApi.edit(product.id, {
        name: form.name.trim(),
        sku: form.sku.trim(),
        barcode: form.barcode.trim() || null,
        category: form.category.trim() || null,
        brand: form.brand.trim() || null,
        description: form.description.trim() || null,
      });
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} title="Editar producto" footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !form.name.trim() || !form.sku.trim()}>Guardar</button></>}>
      <div className="row g-3">
        <Field label="Nombre" className="col-12"><input className="form-control" value={form.name} maxLength={150} onChange={(event) => set('name', event.target.value)} /></Field>
        <Field label="SKU" className="col-md-6"><input className="form-control mono" value={form.sku} maxLength={50} onChange={(event) => set('sku', event.target.value)} /></Field>
        <Field label="Código de barras" className="col-md-6"><input className="form-control mono" value={form.barcode} maxLength={100} onChange={(event) => set('barcode', event.target.value)} /></Field>
        <Field label="Rubro" className="col-md-6"><input className="form-control" value={form.category} maxLength={80} onChange={(event) => set('category', event.target.value)} /></Field>
        <Field label="Marca" className="col-md-6"><input className="form-control" value={form.brand} maxLength={80} onChange={(event) => set('brand', event.target.value)} /></Field>
        <Field label="Descripción" className="col-12"><textarea className="form-control" rows={2} maxLength={2000} value={form.description} onChange={(event) => set('description', event.target.value)} /></Field>
      </div>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}

function VatModal({ open, product, onClose, onSaved }: { open: boolean; product: Product; onClose: () => void; onSaved: () => void }) {
  const [treatment, setTreatment] = useState<VatTreatment>(product.vatTreatment);
  const [rate, setRate] = useState<number>(product.taxRate || 21);
  const [includes, setIncludes] = useState(product.priceIncludesVat);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTreatment(product.vatTreatment);
      setRate(product.taxRate || 21);
      setIncludes(product.priceIncludesVat);
      setReason('');
      setError(null);
    }
  }, [open, product]);

  const submit = async () => {
    if (reason.trim().length < 5) return setError('El motivo debe tener al menos 5 caracteres (queda auditado).');
    setBusy(true);
    setError(null);
    try {
      await productsApi.updateVat(product.id, { vatTreatment: treatment, taxRate: treatment === 'TAXED' ? rate : undefined, priceIncludesVat: includes, reason: reason.trim() });
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} size="sm" title="Asignar o quitar IVA" footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>Guardar</button></>}>
      <Field label="Tratamiento" className="mb-3">
        <select className="form-select" value={treatment} onChange={(event) => setTreatment(event.target.value as VatTreatment)}>
          <option value="TAXED">Gravado</option>
          <option value="EXEMPT">Exento (art. 7 Ley de IVA)</option>
          <option value="NOT_TAXED">No gravado</option>
        </select>
      </Field>
      {treatment === 'TAXED' && (
        <Field label="Alícuota" className="mb-3">
          <select className="form-select" value={rate} onChange={(event) => setRate(Number(event.target.value))}>
            {VAT_RATES.map((value) => (
              <option key={value} value={value}>{value.toLocaleString('es-AR')} %</option>
            ))}
          </select>
        </Field>
      )}
      <div className="form-check form-switch mb-3">
        <input id="vat-incl" type="checkbox" className="form-check-input" checked={includes} onChange={(event) => setIncludes(event.target.checked)} />
        <label htmlFor="vat-incl" className="form-check-label small">Precio final con IVA incluido</label>
      </div>
      <Field label="Motivo" required hint="Ej.: Libro – exento art. 7 inc. a; carne – alícuota reducida.">
        <input className="form-control" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
