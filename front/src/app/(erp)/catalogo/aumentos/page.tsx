'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { productsApi } from '@/lib/api/endpoints';
import type { BulkPriceResult, BulkPriceUpdateRequest, PriceRounding, PriceTarget } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { int, money, parseLocaleNumber, pct, toNumber } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

const TARGETS: Array<{ value: PriceTarget; title: string; text: string; icon: string }> = [
  { value: 'SELLING_PRICE', title: 'Solo precio de venta', text: 'Sube el precio al público. El costo no cambia y el margen crece.', icon: 'bi-tag' },
  { value: 'COST_KEEP_MARGIN', title: 'Nueva lista del proveedor', text: 'Sube el costo y recalcula el precio manteniendo el margen de cada producto.', icon: 'bi-truck' },
  { value: 'COST_ONLY', title: 'Solo costo', text: 'Actualiza el costo sin tocar el precio (el margen baja).', icon: 'bi-box-seam' },
];

const ROUNDINGS: Array<{ value: PriceRounding; label: string }> = [
  { value: 'NONE', label: 'Sin redondeo' },
  { value: 'UNIT', label: 'Al peso' },
  { value: 'TEN', label: 'A $10' },
  { value: 'HUNDRED', label: 'A $100' },
];

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function BulkPricesPage() {
  return (
    <RequireCapability capability="catalog.manage">
      <BulkPrices />
    </RequireCapability>
  );
}

function BulkPrices() {
  const toast = useToast();
  const { branches } = useSession();
  const branchName = useBranchName();
  const facets = useApiQuery(() => productsApi.facets(), []);
  const [percentage, setPercentage] = useState('10');
  const [target, setTarget] = useState<PriceTarget>('SELLING_PRICE');
  const [rounding, setRounding] = useState<PriceRounding>('TEN');
  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<BulkPriceResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = (dryRun: boolean): BulkPriceUpdateRequest | null => {
    const value = parseLocaleNumber(percentage);
    if (Number.isNaN(value) || value === 0 || value < -90 || value > 500) {
      setError('El porcentaje debe estar entre −90 % y 500 % y ser distinto de cero.');
      return null;
    }
    if (reason.trim().length < 3) {
      setError('Indicá el motivo (por ejemplo: “Lista proveedor octubre” o “Inflación septiembre”).');
      return null;
    }
    return {
      percentage: Math.round(value * 100) / 100,
      target,
      rounding,
      scope: {
        categories: categories.length ? categories : undefined,
        brands: brands.length ? brands : undefined,
        branchIds: branchIds.length ? branchIds : undefined,
      },
      reason: reason.trim(),
      dryRun,
    };
  };

  const run = async (dryRun: boolean) => {
    const body = build(dryRun);
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const result = await productsApi.bulkPrices(body);
      if (dryRun) setPreview(result);
      else {
        setConfirmOpen(false);
        setPreview(null);
        toast.success('Precios actualizados', `${int(result.affectedRows)} precios modificados · lote ${result.batchId ?? ''}`);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const invalidate = () => setPreview(null);

  return (
    <>
      <PageHeader
        eyebrow="Catálogo"
        title="Actualizar precios"
        subtitle="Aumentos masivos por rubro, marca o sucursal con vista previa. Cada cambio queda en el historial de precios."
        actions={
          <Link href="/catalogo" className="btn btn-sm btn-light">
            <i className="bi bi-arrow-left me-1" aria-hidden="true" />
            Catálogo
          </Link>
        }
      />

      <div className="row g-3">
        <div className="col-xl-5">
          <Surface title="1. Qué ajustar">
            <div className="d-flex flex-column gap-2 mb-3">
              {TARGETS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`ops-tile text-start ${target === item.value ? 'border-primary' : ''}`}
                  style={target === item.value ? { boxShadow: '0 0 0 1px var(--belgrano) inset', background: '#f4f8fd' } : undefined}
                  onClick={() => { setTarget(item.value); invalidate(); }}
                >
                  <span className="ops-icon tone-blue"><i className={`bi ${item.icon}`} aria-hidden="true" /></span>
                  <span>
                    <span className="d-block fw-semibold text-ink">{item.title}</span>
                    <span className="d-block small text-muted-2">{item.text}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="row g-3">
              <Field label="Porcentaje" className="col-6" hint="Negativo para bajar precios.">
                <div className="input-group">
                  <input className="form-control mono fs-5" inputMode="decimal" value={percentage} onChange={(event) => { setPercentage(event.target.value); invalidate(); }} />
                  <span className="input-group-text">%</span>
                </div>
              </Field>
              <Field label="Redondeo del precio" className="col-6" hint="Siempre hacia arriba.">
                <select className="form-select" value={rounding} onChange={(event) => { setRounding(event.target.value as PriceRounding); invalidate(); }}>
                  {ROUNDINGS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Motivo" className="col-12" required>
                <input className="form-control" value={reason} maxLength={200} onChange={(event) => { setReason(event.target.value); invalidate(); }} placeholder="Ej.: Lista Arcor octubre 2026" />
              </Field>
            </div>
          </Surface>

          <Surface title="2. A qué productos" className="mt-3" subtitle="Sin selección = todo el catálogo / todas las sucursales.">
            <div className="eyebrow mb-2">Sucursales</div>
            <div className="d-flex flex-wrap gap-1 mb-3">
              {branches.map((branch) => (
                <button key={branch.id} type="button" className={`btn btn-sm ${branchIds.includes(branch.id) ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setBranchIds((current) => toggle(current, branch.id)); invalidate(); }}>
                  {branch.name}
                </button>
              ))}
            </div>
            <div className="eyebrow mb-2">Rubros</div>
            <div className="d-flex flex-wrap gap-1 mb-3" style={{ maxHeight: 140, overflowY: 'auto' }}>
              {facets.data?.categories.map((item) => (
                <button key={item.name} type="button" className={`btn btn-sm ${categories.includes(item.name) ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setCategories((current) => toggle(current, item.name)); invalidate(); }}>
                  {item.name} <span className="opacity-75">({item.count})</span>
                </button>
              ))}
              {facets.data && facets.data.categories.length === 0 && <span className="small text-muted-2">Sin rubros cargados.</span>}
            </div>
            <div className="eyebrow mb-2">Marcas / proveedores</div>
            <div className="d-flex flex-wrap gap-1" style={{ maxHeight: 140, overflowY: 'auto' }}>
              {facets.data?.brands.map((item) => (
                <button key={item.name} type="button" className={`btn btn-sm ${brands.includes(item.name) ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setBrands((current) => toggle(current, item.name)); invalidate(); }}>
                  {item.name} <span className="opacity-75">({item.count})</span>
                </button>
              ))}
              {facets.data && facets.data.brands.length === 0 && <span className="small text-muted-2">Sin marcas cargadas.</span>}
            </div>
          </Surface>
        </div>

        <div className="col-xl-7">
          <Surface
            title="3. Vista previa"
            padded={false}
            actions={
              <>
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void run(true)} disabled={busy}>
                  {busy && !confirmOpen ? <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" /> : <i className="bi bi-eye me-1" aria-hidden="true" />}
                  Calcular vista previa
                </button>
                <button type="button" className="btn btn-sm btn-primary" disabled={!preview || preview.affectedRows === 0 || busy} onClick={() => setConfirmOpen(true)}>
                  Aplicar cambios
                </button>
              </>
            }
          >
            {error && <div className="p-3 pb-0"><div className="alert alert-danger small py-2 mb-0">{error}</div></div>}
            {!preview ? (
              <div className="empty-state">
                <i className="bi bi-calculator" aria-hidden="true" />
                <h3>Configurá el ajuste y calculá la vista previa</h3>
                <div className="small">No se modifica nada hasta que confirmes.</div>
              </div>
            ) : (
              <>
                <div className="d-flex flex-wrap gap-4 px-3 py-3 border-bottom">
                  <div>
                    <div className="eyebrow">Precios a cambiar</div>
                    <div className="mono fs-4 fw-semibold text-ink">{int(preview.affectedRows)}</div>
                  </div>
                  <div>
                    <div className="eyebrow">Sin cambios</div>
                    <div className="mono fs-4 text-muted-2">{int(preview.unchangedRows)}</div>
                  </div>
                </div>
                <div className="table-scroll">
                  <table className="table table-erp">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Sucursal</th>
                        <th className="num">Costo</th>
                        <th className="num">Precio</th>
                        <th className="num">Margen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((row) => {
                        const before = toNumber(row.oldSellingPrice);
                        const after = toNumber(row.newSellingPrice);
                        return (
                          <tr key={`${row.productId}-${row.branchId}`}>
                            <td>
                              <div className="cell-title">{row.name}</div>
                              <div className="cell-sub mono">{row.sku}</div>
                            </td>
                            <td>{branchName(row.branchId)}</td>
                            <td className="num small">
                              {row.oldCostPrice === row.newCostPrice ? money(row.newCostPrice) : <><span className="text-muted-2 text-decoration-line-through">{money(row.oldCostPrice)}</span><br />{money(row.newCostPrice)}</>}
                            </td>
                            <td className="num">
                              <span className="text-muted-2 small text-decoration-line-through">{money(before)}</span>
                              <br />
                              <strong>{money(after)}</strong>
                            </td>
                            <td className="num small">{pct(row.newProfitMargin)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {preview.preview.length < preview.affectedRows && (
                  <div className="small text-muted-2 px-3 py-2 border-top">Se muestran {int(preview.preview.length)} de {int(preview.affectedRows)} filas.</div>
                )}
              </>
            )}
          </Surface>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        busy={busy}
        size="sm"
        title="Confirmar actualización"
        footer={
          <>
            <button type="button" className="btn btn-light" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void run(false)} disabled={busy}>
              {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
              Aplicar {int(preview?.affectedRows ?? 0)} cambios
            </button>
          </>
        }
      >
        <p className="mb-2">
          Se van a modificar <strong>{int(preview?.affectedRows ?? 0)}</strong> precios ({percentage} % · {TARGETS.find((item) => item.value === target)?.title.toLowerCase()}).
        </p>
        <p className="small text-muted-2 mb-0">Los cambios rigen desde la próxima venta y quedan en el historial con el motivo “{reason}”.</p>
      </Modal>
    </>
  );
}
