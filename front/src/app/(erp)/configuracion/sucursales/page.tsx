'use client';

import { useState } from 'react';
import { EmptyState, ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { branchesApi } from '@/lib/api/endpoints';
import type { Branch } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

export default function BranchesPage() {
  return (
    <RequireCapability capability="admin.branches">
      <Branches />
    </RequireCapability>
  );
}

function Branches() {
  const toast = useToast();
  const { reloadBranches } = useSession();
  const list = useApiQuery(() => branchesApi.list(), []);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="Empresa"
        title="Sucursales"
        subtitle="Locales y depósitos. Opcionalmente, restringí desde qué redes (IP) pueden operar los usuarios de cada sucursal."
        actions={<button type="button" className="btn btn-sm btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}><i className="bi bi-plus-lg me-1" aria-hidden="true" />Nueva sucursal</button>}
      />
      {list.error && <ErrorAlert message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <div className="surface"><EmptyState icon="bi-shop" title="Sin sucursales" /></div>}
      <div className="row g-3">
        {list.data?.map((branch) => (
          <div key={branch.id} className="col-md-6 col-xl-4">
            <div className="surface surface-body h-100">
              <div className="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <div className="mono small text-muted-2">{branch.code}</div>
                  <div className="fw-semibold text-ink fs-6">{branch.name}</div>
                </div>
                {branch.status ? <StatusBadge tone="green">Activa</StatusBadge> : <StatusBadge tone="slate">Inactiva</StatusBadge>}
              </div>
              <div className="small text-muted-2">
                {branch.address && <div><i className="bi bi-geo-alt me-1" aria-hidden="true" />{branch.address}</div>}
                {branch.phone && <div><i className="bi bi-telephone me-1" aria-hidden="true" />{branch.phone}</div>}
                <div className="mt-2">
                  <i className="bi bi-shield-lock me-1" aria-hidden="true" />
                  {branch.allowedIpRanges?.length ? `Acceso restringido a ${branch.allowedIpRanges.length} red(es)` : 'Acceso desde cualquier red'}
                </div>
              </div>
              <button type="button" className="btn btn-sm btn-outline-secondary mt-3" onClick={() => { setEditing(branch); setFormOpen(true); }}>Editar</button>
            </div>
          </div>
        ))}
      </div>
      <BranchModal
        open={formOpen}
        branch={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          toast.success(editing ? 'Sucursal actualizada' : 'Sucursal creada');
          list.reload();
          void reloadBranches();
        }}
      />
    </>
  );
}

function BranchModal({ open, branch, onClose, onSaved }: { open: boolean; branch: Branch | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [ranges, setRanges] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = `${open}-${branch?.id ?? 'new'}`;
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setCode(branch?.code ?? '');
    setName(branch?.name ?? '');
    setAddress(branch?.address ?? '');
    setPhone(branch?.phone ?? '');
    setRanges((branch?.allowedIpRanges ?? []).join('\n'));
    setActive(branch?.status ?? true);
    setError(null);
  }

  const submit = async () => {
    const allowedIpRanges = ranges.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    setBusy(true);
    setError(null);
    try {
      const body = { code: code.trim().toUpperCase(), name: name.trim(), address: address.trim() || undefined, phone: phone.trim() || undefined, allowedIpRanges };
      if (branch) await branchesApi.update(branch.id, { ...body, status: active });
      else await branchesApi.create(body);
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} title={branch ? 'Editar sucursal' : 'Nueva sucursal'} footer={<><button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !code.trim() || !name.trim()}>Guardar</button></>}>
      <div className="row g-3">
        <Field label="Código" className="col-md-4" hint="Mayúsculas, números y guiones.">
          <input className="form-control mono text-uppercase" value={code} maxLength={20} onChange={(event) => setCode(event.target.value)} placeholder="SUC-01" />
        </Field>
        <Field label="Nombre" className="col-md-8"><input className="form-control" value={name} maxLength={150} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Dirección" className="col-md-8"><input className="form-control" value={address} maxLength={255} onChange={(event) => setAddress(event.target.value)} /></Field>
        <Field label="Teléfono" className="col-md-4"><input className="form-control" value={phone} maxLength={50} onChange={(event) => setPhone(event.target.value)} /></Field>
        <Field label="Redes permitidas (opcional)" className="col-12" hint="Una IP o rango CIDR por línea, por ejemplo 181.45.10.20 o 190.210.0.0/24. Vacío = sin restricción. Titulares y administradores sin sucursal asignada no se ven afectados.">
          <textarea className="form-control mono" rows={3} value={ranges} onChange={(event) => setRanges(event.target.value)} />
        </Field>
        {branch && (
          <div className="col-12 form-check form-switch ms-2">
            <input id="branch-active" type="checkbox" className="form-check-input" checked={active} onChange={(event) => setActive(event.target.checked)} />
            <label htmlFor="branch-active" className="form-check-label small">Sucursal activa</label>
          </div>
        )}
      </div>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
