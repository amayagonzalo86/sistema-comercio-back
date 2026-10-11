'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { productsApi } from '@/lib/api/endpoints';
import { VAT_RATES, type CreateProductRequest, type UnitOfMeasure, type VatTreatment } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { money, parseLocaleNumber } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

interface BranchRow {
  branchId: string;
  enabled: boolean;
  cost: string;
  margin: string;
  price: string;
  stock: string;
  minStock: string;
}

const UNITS: Array<{ value: UnitOfMeasure; label: string }> = [
  { value: 'UNIT', label: 'Unidad' },
  { value: 'KG', label: 'Kilogramo' },
  { value: 'LITER', label: 'Litro' },
  { value: 'METER', label: 'Metro' },
  { value: 'PACK', label: 'Pack / bulto' },
];

const num = (value: string): number => {
  const parsed = parseLocaleNumber(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** Mismo criterio que el backend: margen sobre costo, precio = costo × (1 + margen). Redondeo a centavos. */
function suggestedPrice(cost: number, margin: number): number {
  return Math.round(cost * (1 + margin / 100) * 100) / 100;
}

export default function NewProductPage() {
  return (
    <RequireCapability capability="catalog.create">
      <NewProductForm />
    </RequireCapability>
  );
}

function NewProductForm() {
  const router = useRouter();
  const toast = useToast();
  const { branches } = useSession();
  const facets = useApiQuery(() => productsApi.facets(), []);
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [unit, setUnit] = useState<UnitOfMeasure>('UNIT');
  const [treatment, setTreatment] = useState<VatTreatment>('TAXED');
  const [taxRate, setTaxRate] = useState<number>(21);
  const [includesVat, setIncludesVat] = useState(true);
  const [rows, setRows] = useState<BranchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows((current) =>
      branches.map(
        (branch) =>
          current.find((row) => row.branchId === branch.id) ?? { branchId: branch.id, enabled: true, cost: '', margin: '40', price: '', stock: '0', minStock: '0' },
      ),
    );
  }, [branches]);

  const update = (branchId: string, patch: Partial<BranchRow>) => setRows((current) => current.map((row) => (row.branchId === branchId ? { ...row, ...patch } : row)));

  /** Copia costo, margen, precio y mínimo de la primera sucursal al resto (lo habitual en cadenas). */
  const copyFirst = () => {
    const first = rows[0];
    if (!first) return;
    setRows((current) => current.map((row) => ({ ...row, cost: first.cost, margin: first.margin, price: first.price, minStock: first.minStock })));
  };

  const recalc = (row: BranchRow): string => {
    const price = suggestedPrice(num(row.cost), num(row.margin));
    return price > 0 ? price.toFixed(2) : '';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const enabled = rows.filter((row) => row.enabled);
    if (enabled.length === 0) return setError('Habilitá el producto en al menos una sucursal.');
    if (enabled.some((row) => num(row.price) <= 0)) return setError('Cada sucursal habilitada necesita un precio de venta.');
    const body: CreateProductRequest = {
      sku: sku.trim(),
      barcode: barcode.trim() || undefined,
      name: name.trim(),
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      brand: brand.trim() || undefined,
      unitOfMeasure: unit,
      vatTreatment: treatment,
      taxRate: treatment === 'TAXED' ? taxRate : 0,
      priceIncludesVat: includesVat,
      branchSettings: enabled.map((row) => ({
        branchId: row.branchId,
        costPrice: Math.round(num(row.cost) * 100) / 100,
        profitMargin: Math.round(num(row.margin) * 100) / 100,
        sellingPrice: Math.round(num(row.price) * 100) / 100,
        stock: Math.round(num(row.stock) * 1000) / 1000,
        minStock: Math.round(num(row.minStock) * 1000) / 1000,
        isActive: true,
      })),
    };
    setBusy(true);
    setError(null);
    try {
      const product = await productsApi.create(body);
      toast.success('Producto creado', product.name);
      router.push(`/catalogo/${product.id}`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <PageHeader
        eyebrow="Catálogo"
        title="Nuevo producto"
        actions={
          <>
            <Link href="/catalogo" className="btn btn-sm btn-light">
              Cancelar
            </Link>
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
              {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
              Guardar producto
            </button>
          </>
        }
      />
      {error && <div className="alert alert-danger small py-2">{error}</div>}

      <div className="row g-3">
        <div className="col-xl-7">
          <Surface title="Datos generales">
            <div className="row g-3">
              <Field label="Nombre" className="col-12" required>
                <input className="form-control" value={name} maxLength={150} required onChange={(event) => setName(event.target.value)} placeholder="Ej.: Yerba mate suave 1 kg" />
              </Field>
              <Field label="SKU / código interno" className="col-md-6" required>
                <input className="form-control mono" value={sku} maxLength={50} required onChange={(event) => setSku(event.target.value)} />
              </Field>
              <Field label="Código de barras (EAN)" className="col-md-6">
                <input className="form-control mono" value={barcode} maxLength={100} onChange={(event) => setBarcode(event.target.value)} placeholder="Escaneá con el lector" />
              </Field>
              <Field label="Rubro" className="col-md-5">
                <input className="form-control" list="categories" value={category} maxLength={80} onChange={(event) => setCategory(event.target.value)} />
                <datalist id="categories">{facets.data?.categories.map((item) => <option key={item.name} value={item.name} />)}</datalist>
              </Field>
              <Field label="Marca" className="col-md-4">
                <input className="form-control" list="brands" value={brand} maxLength={80} onChange={(event) => setBrand(event.target.value)} />
                <datalist id="brands">{facets.data?.brands.map((item) => <option key={item.name} value={item.name} />)}</datalist>
              </Field>
              <Field label="Unidad" className="col-md-3">
                <select className="form-select" value={unit} onChange={(event) => setUnit(event.target.value as UnitOfMeasure)}>
                  {UNITS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Descripción" className="col-12">
                <textarea className="form-control" rows={2} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
              </Field>
            </div>
          </Surface>
        </div>
        <div className="col-xl-5">
          <Surface title="IVA">
            <div className="row g-3">
              <Field label="Tratamiento" className="col-md-6">
                <select className="form-select" value={treatment} onChange={(event) => setTreatment(event.target.value as VatTreatment)}>
                  <option value="TAXED">Gravado</option>
                  <option value="EXEMPT">Exento (art. 7 Ley de IVA)</option>
                  <option value="NOT_TAXED">No gravado</option>
                </select>
              </Field>
              <Field label="Alícuota" className="col-md-6">
                <select className="form-select" value={taxRate} disabled={treatment !== 'TAXED'} onChange={(event) => setTaxRate(Number(event.target.value))}>
                  {VAT_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate.toLocaleString('es-AR')} %
                    </option>
                  ))}
                </select>
              </Field>
              <div className="col-12">
                <div className="form-check form-switch">
                  <input id="incl" type="checkbox" className="form-check-input" checked={includesVat} onChange={(event) => setIncludesVat(event.target.checked)} />
                  <label htmlFor="incl" className="form-check-label small">
                    El precio de venta es final (IVA incluido)
                  </label>
                </div>
                <div className="legal-note mt-2">Ley 24.240: a consumidor final se exhibe el precio final con impuestos. Activalo si vendés al público.</div>
              </div>
            </div>
          </Surface>
        </div>

        <div className="col-12">
          <Surface
            title="Precio y stock por sucursal"
            subtitle="Margen sobre costo: el botón mágico calcula precio = costo × (1 + margen). Si el precio es final, cargá el costo con IVA para que el margen sea real."
            padded={false}
            actions={
              rows.length > 1 && (
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={copyFirst}>
                  <i className="bi bi-files me-1" aria-hidden="true" />
                  Copiar la primera a todas
                </button>
              )
            }
          >
            <div className="table-responsive">
              <table className="table table-erp">
                <thead>
                  <tr>
                    <th>Sucursal</th>
                    <th className="num">Costo</th>
                    <th className="num">Margen %</th>
                    <th className="num">Precio de venta</th>
                    <th className="num">Stock inicial</th>
                    <th className="num">Stock mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const branch = branches.find((item) => item.id === row.branchId);
                    const suggestion = recalc(row);
                    return (
                      <tr key={row.branchId} className={row.enabled ? '' : 'opacity-50'}>
                        <td>
                          <div className="form-check mb-0">
                            <input id={`b-${row.branchId}`} type="checkbox" className="form-check-input" checked={row.enabled} onChange={(event) => update(row.branchId, { enabled: event.target.checked })} />
                            <label htmlFor={`b-${row.branchId}`} className="form-check-label fw-medium">
                              {branch?.name}
                            </label>
                          </div>
                        </td>
                        <td><input className="form-control form-control-sm mono text-end" inputMode="decimal" value={row.cost} disabled={!row.enabled} onChange={(event) => update(row.branchId, { cost: event.target.value })} /></td>
                        <td><input className="form-control form-control-sm mono text-end" inputMode="decimal" value={row.margin} disabled={!row.enabled} onChange={(event) => update(row.branchId, { margin: event.target.value })} /></td>
                        <td>
                          <div className="input-group input-group-sm">
                            <input className="form-control mono text-end" inputMode="decimal" value={row.price} disabled={!row.enabled} onChange={(event) => update(row.branchId, { price: event.target.value })} />
                            <button type="button" className="btn btn-outline-secondary" disabled={!row.enabled || !suggestion} onClick={() => update(row.branchId, { price: suggestion })} title={suggestion ? `Usar sugerido ${money(suggestion)}` : 'Cargá costo y margen'}>
                              <i className="bi bi-magic" />
                            </button>
                          </div>
                        </td>
                        <td><input className="form-control form-control-sm mono text-end" inputMode="decimal" value={row.stock} disabled={!row.enabled} onChange={(event) => update(row.branchId, { stock: event.target.value })} /></td>
                        <td><input className="form-control form-control-sm mono text-end" inputMode="decimal" value={row.minStock} disabled={!row.enabled} onChange={(event) => update(row.branchId, { minStock: event.target.value })} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>
      </div>
    </form>
  );
}
