'use client';

import { useState } from 'react';
import { EmptyState, ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { marketingApi, productsApi } from '@/lib/api/endpoints';
import type { CreatePromotionRequest, Promotion, PromotionType } from '@/lib/api/types';
import { useBranchName, useSession } from '@/lib/auth/session';
import { date, parseLocaleNumber, todayLocal } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

/** 0 = domingo … 6 = sábado (convención del backend para promociones). */
const WEEKDAYS = [
  { value: 1, label: 'Lu' },
  { value: 2, label: 'Ma' },
  { value: 3, label: 'Mi' },
  { value: 4, label: 'Ju' },
  { value: 5, label: 'Vi' },
  { value: 6, label: 'Sá' },
  { value: 0, label: 'Do' },
];

function describe(promotion: Promotion): string {
  if (promotion.type === 'BUY_X_PAY_Y') return `${promotion.buyQuantity}x${promotion.payQuantity}`;
  return `${((promotion.percentBasisPoints ?? 0) / 100).toLocaleString('es-AR')} % off`;
}

function isCurrent(promotion: Promotion): boolean {
  const today = todayLocal();
  return promotion.isActive && (!promotion.startsAt || promotion.startsAt <= today) && (!promotion.endsAt || promotion.endsAt >= today);
}

export default function PromotionsPage() {
  return (
    <RequireCapability capability="marketing.view">
      <Promotions />
    </RequireCapability>
  );
}

function Promotions() {
  const toast = useToast();
  const { can } = useSession();
  const branchName = useBranchName();
  const [current, setCurrent] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const promotions = useApiQuery(() => marketingApi.promotions({ page, limit: 24, current: current || undefined }), [page, current]);

  const toggle = async (promotion: Promotion) => {
    try {
      await marketingApi.updatePromotion(promotion.id, { isActive: !promotion.isActive });
      toast.success(promotion.isActive ? 'Promoción pausada' : 'Promoción activada', promotion.name);
      promotions.reload();
    } catch (caught) {
      toast.error('No se pudo actualizar', errorMessage(caught));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Marketing"
        title="Promociones"
        subtitle="Descuentos y combos (3x2) que el punto de venta aplica solo, por producto, rubro, marca, sucursal, día y vigencia."
        actions={
          <>
            <div className="segmented">
              <button type="button" className={!current ? 'active' : ''} onClick={() => { setCurrent(false); setPage(1); }}>Todas</button>
              <button type="button" className={current ? 'active' : ''} onClick={() => { setCurrent(true); setPage(1); }}>Vigentes hoy</button>
            </div>
            {can('marketing.manage') && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>
                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                Nueva promoción
              </button>
            )}
          </>
        }
      />
      {promotions.error && <ErrorAlert message={promotions.error} onRetry={promotions.reload} />}
      {promotions.loading && !promotions.data && <Spinner />}
      {promotions.data && promotions.data.items.length === 0 && (
        <div className="surface"><EmptyState icon="bi-megaphone" title="Sin promociones" action={can('marketing.manage') && <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}>Crear promoción</button>}>Ej.: miércoles 15 % en bebidas o 3x2 en yerbas.</EmptyState></div>
      )}
      <div className="row g-3">
        {promotions.data?.items.map((promotion) => {
          const live = isCurrent(promotion);
          return (
            <div key={promotion.id} className="col-md-6 col-xl-4">
              <div className="surface h-100 d-flex flex-column">
                <div className="surface-body flex-grow-1">
                  <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                    <span className="mono fs-4 fw-bold" style={{ color: 'var(--belgrano)' }}>{describe(promotion)}</span>
                    {live ? <StatusBadge tone="green">Vigente</StatusBadge> : promotion.isActive ? <StatusBadge tone="amber">Programada</StatusBadge> : <StatusBadge tone="slate">Pausada</StatusBadge>}
                  </div>
                  <div className="fw-semibold text-ink">{promotion.name}</div>
                  {promotion.description && <div className="small text-muted-2 mt-1">{promotion.description}</div>}
                  <div className="d-flex flex-wrap gap-1 mt-3">
                    {(promotion.categories ?? []).map((item) => <span key={item} className="badge text-bg-light border">Rubro: {item}</span>)}
                    {(promotion.brands ?? []).map((item) => <span key={item} className="badge text-bg-light border">Marca: {item}</span>)}
                    {(promotion.productIds?.length ?? 0) > 0 && <span className="badge text-bg-light border">{promotion.productIds?.length} productos</span>}
                    {!promotion.categories?.length && !promotion.brands?.length && !promotion.productIds?.length && <span className="badge text-bg-light border">Todo el catálogo</span>}
                  </div>
                  <div className="small text-muted-2 mt-3">
                    <div><i className="bi bi-shop me-1" aria-hidden="true" />{promotion.branchIds?.length ? promotion.branchIds.map(branchName).join(', ') : 'Todas las sucursales'}</div>
                    <div><i className="bi bi-calendar-week me-1" aria-hidden="true" />{promotion.weekdays?.length ? WEEKDAYS.filter((day) => promotion.weekdays?.includes(day.value)).map((day) => day.label).join(' · ') : 'Todos los días'}</div>
                    <div><i className="bi bi-calendar-range me-1" aria-hidden="true" />{promotion.startsAt ? date(promotion.startsAt) : 'Sin inicio'} → {promotion.endsAt ? date(promotion.endsAt) : 'sin vencimiento'}</div>
                  </div>
                </div>
                {can('marketing.manage') && (
                  <div className="border-top px-3 py-2 d-flex justify-content-end">
                    <button type="button" className={`btn btn-sm ${promotion.isActive ? 'btn-outline-secondary' : 'btn-outline-success'}`} onClick={() => void toggle(promotion)}>
                      {promotion.isActive ? 'Pausar' : 'Activar'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {promotions.data && promotions.data.total > 0 && (
        <div className="surface mt-3">
          <Pagination page={promotions.data.page} pages={promotions.data.pages} total={promotions.data.total} limit={promotions.data.limit} onPage={setPage} />
        </div>
      )}
      <CreatePromotionModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(promotion) => { setCreateOpen(false); toast.success('Promoción creada', promotion.name); promotions.reload(); }} />
    </>
  );
}

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function CreatePromotionModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (promotion: Promotion) => void }) {
  const { branches } = useSession();
  const facets = useApiQuery(() => productsApi.facets(), [], open);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<PromotionType>('PERCENTAGE');
  const [percentage, setPercentage] = useState('15');
  const [buy, setBuy] = useState('3');
  const [pay, setPay] = useState('2');
  const [categories, setCategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startsAt, setStartsAt] = useState(todayLocal());
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (name.trim().length < 3) return setError('Poné un nombre descriptivo (lo ve el cajero en el ticket).');
    const body: CreatePromotionRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      type,
      categories: categories.length ? categories : undefined,
      brands: brands.length ? brands : undefined,
      branchIds: branchIds.length ? branchIds : undefined,
      weekdays: weekdays.length ? weekdays : undefined,
      startsAt: startsAt || undefined,
      endsAt: endsAt || undefined,
    };
    if (type === 'PERCENTAGE') {
      const value = parseLocaleNumber(percentage);
      if (Number.isNaN(value) || value <= 0 || value > 100) return setError('El descuento debe estar entre 0,01 % y 100 %.');
      body.percentage = Math.round(value * 100) / 100;
    } else {
      const buyQuantity = Number(buy);
      const payQuantity = Number(pay);
      if (!Number.isInteger(buyQuantity) || !Number.isInteger(payQuantity) || payQuantity < 1 || buyQuantity <= payQuantity) return setError('En un combo, “lleva” debe ser mayor que “paga” (por ejemplo 3x2).');
      body.buyQuantity = buyQuantity;
      body.payQuantity = payQuantity;
    }
    setBusy(true);
    setError(null);
    try {
      const promotion = await marketingApi.createPromotion(body);
      setName('');
      setDescription('');
      onCreated(promotion);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} size="lg" title="Nueva promoción" footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>Crear promoción</button></>}>
      <div className="row g-3">
        <Field label="Nombre" className="col-md-7" required>
          <input className="form-control" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Miércoles 15 % en bebidas" />
        </Field>
        <Field label="Tipo" className="col-md-5">
          <div className="segmented w-100">
            <button type="button" className={`flex-fill ${type === 'PERCENTAGE' ? 'active' : ''}`} onClick={() => setType('PERCENTAGE')}>% descuento</button>
            <button type="button" className={`flex-fill ${type === 'BUY_X_PAY_Y' ? 'active' : ''}`} onClick={() => setType('BUY_X_PAY_Y')}>Lleva X paga Y</button>
          </div>
        </Field>
        {type === 'PERCENTAGE' ? (
          <Field label="Descuento" className="col-md-4">
            <div className="input-group"><input className="form-control mono" inputMode="decimal" value={percentage} onChange={(event) => setPercentage(event.target.value)} /><span className="input-group-text">%</span></div>
          </Field>
        ) : (
          <>
            <Field label="Lleva" className="col-md-2"><input className="form-control mono" inputMode="numeric" value={buy} onChange={(event) => setBuy(event.target.value)} /></Field>
            <Field label="Paga" className="col-md-2"><input className="form-control mono" inputMode="numeric" value={pay} onChange={(event) => setPay(event.target.value)} /></Field>
          </>
        )}
        <Field label="Desde" className="col-md-4"><input type="date" className="form-control" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></Field>
        <Field label="Hasta" className="col-md-4"><input type="date" className="form-control" value={endsAt} min={startsAt} onChange={(event) => setEndsAt(event.target.value)} /></Field>
        <div className="col-12">
          <div className="eyebrow mb-2">Días de la semana (vacío = todos)</div>
          <div className="d-flex gap-1">
            {WEEKDAYS.map((day) => (
              <button key={day.value} type="button" className={`btn btn-sm ${weekdays.includes(day.value) ? 'btn-primary' : 'btn-outline-secondary'}`} style={{ width: 44 }} onClick={() => setWeekdays((current) => toggleValue(current, day.value))}>{day.label}</button>
            ))}
          </div>
        </div>
        <div className="col-md-6">
          <div className="eyebrow mb-2">Rubros (vacío = todos)</div>
          <div className="d-flex flex-wrap gap-1" style={{ maxHeight: 120, overflowY: 'auto' }}>
            {facets.data?.categories.map((item) => (
              <button key={item.name} type="button" className={`btn btn-sm ${categories.includes(item.name) ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setCategories((current) => toggleValue(current, item.name))}>{item.name}</button>
            ))}
          </div>
        </div>
        <div className="col-md-6">
          <div className="eyebrow mb-2">Marcas (vacío = todas)</div>
          <div className="d-flex flex-wrap gap-1" style={{ maxHeight: 120, overflowY: 'auto' }}>
            {facets.data?.brands.map((item) => (
              <button key={item.name} type="button" className={`btn btn-sm ${brands.includes(item.name) ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setBrands((current) => toggleValue(current, item.name))}>{item.name}</button>
            ))}
          </div>
        </div>
        <div className="col-12">
          <div className="eyebrow mb-2">Sucursales (vacío = todas)</div>
          <div className="d-flex flex-wrap gap-1">
            {branches.map((branch) => (
              <button key={branch.id} type="button" className={`btn btn-sm ${branchIds.includes(branch.id) ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setBranchIds((current) => toggleValue(current, branch.id))}>{branch.name}</button>
            ))}
          </div>
        </div>
        <Field label="Descripción interna" className="col-12">
          <input className="form-control" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </div>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
