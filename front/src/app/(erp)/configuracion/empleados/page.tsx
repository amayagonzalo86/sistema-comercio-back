'use client';

import { useEffect, useMemo, useState } from 'react';
import { isStrongPassword, PasswordField } from '@/components/forms/PasswordField';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { employeesApi } from '@/lib/api/endpoints';
import type { CreateEmployeeRequest, DocumentType, Employee, TenantRole, UpdateEmployeeRequest } from '@/lib/api/types';
import { isBranchScoped } from '@/lib/auth/permissions';
import { useSession, type SessionUser } from '@/lib/auth/session';
import { dateTime, DOCUMENT_TYPE_LABEL, initials, ROLE_DESCRIPTION, ROLE_LABEL } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useDebounce } from '@/lib/hooks/useDebounce';

/** Roles que se asignan desde esta pantalla (el titular no se asigna). */
const ASSIGNABLE: TenantRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'CASHIER', 'SELLER', 'INVENTORY', 'VIEWER'];
const DOCUMENT_TYPES: DocumentType[] = [96, 86, 80, 94];
const STATUS_FILTERS = [
  ['ACTIVE', 'Activos'],
  ['SUSPENDED', 'Desactivados'],
  ['ALL', 'Todos'],
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number][0];

export default function EmployeesPage() {
  return (
    <RequireCapability capability="admin.employees">
      <Employees />
    </RequireCapability>
  );
}

/** Qué puede hacer quien opera con un empleado. Refleja las reglas del backend (que es quien decide). */
function permissionsFor(user: SessionUser | null, employee: Employee) {
  const self = user?.id === employee.id;
  const actorIsOwner = Boolean(user?.roles.includes('OWNER'));
  const privileged = employee.roles.includes('OWNER') || employee.roles.includes('ADMIN');
  const manage = !self && (actorIsOwner || !privileged);
  return {
    self,
    /** Datos personales: también los propios. */
    edit: manage || self,
    /** Roles, sucursal y estado: nunca los propios. */
    access: manage,
    password: manage && !employee.sharedAccount,
    toggle: manage && !employee.roles.includes('OWNER'),
    reason: self
      ? 'Tu propio usuario: tus roles y tu contraseña se cambian desde "Cambiar mi contraseña" o por el titular.'
      : !manage
        ? 'Solo el titular puede modificar administradores.'
        : employee.sharedAccount
          ? 'La cuenta también se usa en otra empresa: la contraseña la cambia la propia persona.'
          : null,
  };
}

function Employees() {
  const toast = useToast();
  const { user, branches } = useSession();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [role, setRole] = useState<TenantRole | ''>('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ mode: 'create' } | { mode: 'edit'; employee: Employee } | null>(null);
  const [passwordFor, setPasswordFor] = useState<Employee | null>(null);
  const [toggleFor, setToggleFor] = useState<Employee | null>(null);
  const debounced = useDebounce(search.trim(), 300);

  const list = useApiQuery(
    () => employeesApi.list({ page, limit: 25, search: debounced || undefined, status, role: role || undefined, branchId: branchId || undefined }),
    [page, debounced, status, role, branchId],
  );

  useEffect(() => setPage(1), [debounced, status, role, branchId]);

  const replace = (updated: Employee) => {
    if (!list.data) return;
    list.setData({ ...list.data, items: list.data.items.map((item) => (item.id === updated.id ? updated : item)) });
  };

  return (
    <>
      <PageHeader
        eyebrow="Empresa"
        title="Empleados"
        subtitle="Personas que usan el sistema: cada una con su usuario, uno o más roles y, si corresponde, su sucursal."
        actions={
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setForm({ mode: 'create' })}>
            <i className="bi bi-person-plus me-1" aria-hidden="true" />
            Nuevo empleado
          </button>
        }
      />

      <section className="surface">
        <div className="toolbar flex-wrap gap-2">
          <div className="input-group input-group-sm" style={{ maxWidth: 280 }}>
            <span className="input-group-text">
              <i className="bi bi-search" aria-hidden="true" />
            </span>
            <input className="form-control" placeholder="Nombre, usuario, documento o email" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Buscar empleado" />
          </div>
          <div className="segmented">
            {STATUS_FILTERS.map(([value, label]) => (
              <button key={value} type="button" className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>
                {label}
              </button>
            ))}
          </div>
          <select className="form-select form-select-sm w-auto" value={role} onChange={(event) => setRole(event.target.value as TenantRole | '')} aria-label="Filtrar por rol">
            <option value="">Todos los roles</option>
            {(['OWNER', ...ASSIGNABLE] as TenantRole[]).map((item) => (
              <option key={item} value={item}>
                {ROLE_LABEL[item]}
              </option>
            ))}
          </select>
          <select className="form-select form-select-sm w-auto" value={branchId} onChange={(event) => setBranchId(event.target.value)} aria-label="Filtrar por sucursal">
            <option value="">Todas las sucursales</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>

        {list.error && (
          <div className="p-3 pb-0">
            <ErrorAlert message={list.error} onRetry={list.reload} />
          </div>
        )}

        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Roles</th>
                <th>Sucursal</th>
                <th>Estado</th>
                <th>Último ingreso</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            {list.loading && !list.data ? (
              <SkeletonRows columns={6} />
            ) : list.data && list.data.items.length === 0 ? (
              <TableMessage colSpan={6}>
                <EmptyState
                  icon="bi-person-badge"
                  title="Sin empleados con ese filtro"
                  action={
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setForm({ mode: 'create' })}>
                      Dar de alta un empleado
                    </button>
                  }
                />
              </TableMessage>
            ) : (
              <tbody>
                {list.data?.items.map((employee) => {
                  const can = permissionsFor(user, employee);
                  return (
                    <tr key={employee.id}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <span className="avatar flex-shrink-0">{initials(employee.fullName)}</span>
                          <div className="min-w-0">
                            <div className="cell-title text-truncate">
                              {employee.fullName}
                              {can.self && <span className="badge rounded-pill text-bg-light border ms-2">Vos</span>}
                            </div>
                            <div className="cell-sub mono">{employee.username}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          {employee.roles.map((item, index) => (
                            <span key={item} className={`badge rounded-pill ${index === 0 ? 'text-bg-primary' : 'text-bg-light border'}`} title={ROLE_DESCRIPTION[item]}>
                              {ROLE_LABEL[item]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>{employee.branchName ?? <span className="text-muted-2">Todas</span>}</td>
                      <td>{employee.status === 'ACTIVE' ? <StatusBadge tone="green">Activo</StatusBadge> : <StatusBadge tone="slate">Desactivado</StatusBadge>}</td>
                      <td className="small">{employee.lastLoginAt ? dateTime(employee.lastLoginAt) : <span className="text-muted-2">Nunca</span>}</td>
                      <td className="text-end text-nowrap">
                        <div className="btn-group btn-group-sm" role="group" aria-label={`Acciones para ${employee.fullName}`}>
                          <button type="button" className="btn btn-outline-secondary" disabled={!can.edit} onClick={() => setForm({ mode: 'edit', employee })} title={can.edit ? 'Editar datos y roles' : can.reason ?? undefined}>
                            <i className="bi bi-pencil" aria-hidden="true" />
                            <span className="d-none d-xl-inline ms-1">Editar</span>
                          </button>
                          <button type="button" className="btn btn-outline-secondary" disabled={!can.password} onClick={() => setPasswordFor(employee)} title={can.password ? 'Cambiar contraseña' : can.reason ?? undefined}>
                            <i className="bi bi-key" aria-hidden="true" />
                            <span className="d-none d-xl-inline ms-1">Contraseña</span>
                          </button>
                          <button
                            type="button"
                            className={`btn ${employee.status === 'ACTIVE' ? 'btn-outline-danger' : 'btn-outline-success'}`}
                            disabled={!can.toggle}
                            onClick={() => setToggleFor(employee)}
                            title={can.toggle ? (employee.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar') : can.reason ?? 'El titular no se puede desactivar.'}
                          >
                            <i className={`bi ${employee.status === 'ACTIVE' ? 'bi-person-slash' : 'bi-person-check'}`} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
        {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={setPage} />}
      </section>

      {form && (
        <EmployeeFormModal
          key={form.mode === 'edit' ? form.employee.id : 'new'}
          employee={form.mode === 'edit' ? form.employee : null}
          onClose={() => setForm(null)}
          onSaved={(saved, created) => {
            setForm(null);
            if (created) {
              toast.success('Empleado creado', `Usuario ${saved.username}`);
              list.reload();
            } else {
              toast.success('Cambios guardados', saved.fullName);
              replace(saved);
            }
          }}
        />
      )}

      <ResetPasswordModal
        employee={passwordFor}
        onClose={() => setPasswordFor(null)}
        onDone={(message) => {
          setPasswordFor(null);
          toast.success('Contraseña actualizada', message);
        }}
      />

      <ToggleStatusModal
        employee={toggleFor}
        onClose={() => setToggleFor(null)}
        onDone={(updated) => {
          setToggleFor(null);
          toast.success(updated.status === 'ACTIVE' ? 'Empleado reactivado' : 'Empleado desactivado', updated.fullName);
          if (status === 'ALL') replace(updated);
          else list.reload();
        }}
      />
    </>
  );
}

// ── Alta y edición ──────────────────────────────────────────────

interface FormState {
  firstName: string;
  lastName: string;
  documentType: DocumentType;
  nationalId: string;
  email: string;
  phone: string;
  address: string;
  username: string;
  password: string;
  roles: TenantRole[];
  branchId: string;
}

function initialState(employee: Employee | null): FormState {
  return {
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    documentType: employee?.documentType && employee.documentType !== 99 ? employee.documentType : 96,
    nationalId: employee?.nationalId ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    address: employee?.address ?? '',
    username: employee?.username ?? '',
    password: '',
    roles: employee?.roles ?? [],
    branchId: employee?.branchId ?? '',
  };
}

/** Sugiere "nombre.apellido" sin acentos para el usuario. */
function suggestUsername(firstName: string, lastName: string): string {
  const clean = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  const first = clean(firstName.split(' ')[0] ?? '');
  const last = clean(lastName.split(' ')[0] ?? '');
  return [first, last].filter(Boolean).join('.').slice(0, 50);
}

function EmployeeFormModal({ employee, onClose, onSaved }: { employee: Employee | null; onClose: () => void; onSaved: (employee: Employee, created: boolean) => void }) {
  const { user, branches } = useSession();
  const creating = employee === null;
  const can = employee ? permissionsFor(user, employee) : { self: false, access: true, edit: true, password: true, toggle: true, reason: null };
  const actorIsOwner = Boolean(user?.roles.includes('OWNER'));
  const [state, setState] = useState<FormState>(() => initialState(employee));
  const [usernameTouched, setUsernameTouched] = useState(!creating);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((current) => ({ ...current, [key]: value }));

  // En el alta, el usuario se completa solo a partir del nombre hasta que se edite a mano.
  useEffect(() => {
    if (usernameTouched) return;
    const suggestion = suggestUsername(state.firstName, state.lastName);
    setState((current) => (current.username === suggestion ? current : { ...current, username: suggestion }));
  }, [state.firstName, state.lastName, usernameTouched]);

  const isOwner = employee?.roles.includes('OWNER') ?? false;
  const branchRequired = isBranchScoped(state.roles);
  const toggleRole = (role: TenantRole) =>
    set('roles', state.roles.includes(role) ? state.roles.filter((item) => item !== role) : [...state.roles, role]);

  const problems = useMemo(() => {
    const list: string[] = [];
    if (state.firstName.trim().length < 2) list.push('Completá el nombre.');
    if (state.lastName.trim().length < 2) list.push('Completá el apellido.');
    if (!/^[a-z0-9_.-]{4,50}$/.test(state.username)) list.push('El usuario debe tener 4 a 50 caracteres: minúsculas, números, punto, guion o guion bajo.');
    if (creating && !isStrongPassword(state.password)) list.push('La contraseña no cumple los requisitos.');
    if (state.roles.filter((role) => role !== 'OWNER').length === 0 && !isOwner) list.push('Elegí al menos un rol.');
    if (branchRequired && !state.branchId) list.push('Cajeros, vendedores y depósito necesitan una sucursal.');
    return list;
  }, [state, creating, branchRequired, isOwner]);

  const submit = async () => {
    if (problems.length) {
      setError(problems[0] ?? null);
      return;
    }
    setBusy(true);
    setError(null);
    const personal = {
      documentType: state.nationalId.trim() ? state.documentType : null,
      nationalId: state.nationalId.trim() || null,
      email: state.email.trim() || null,
      phone: state.phone.trim() || null,
      address: state.address.trim() || null,
    };
    try {
      if (creating) {
        const body: CreateEmployeeRequest = {
          firstName: state.firstName.trim(),
          lastName: state.lastName.trim(),
          username: state.username,
          password: state.password,
          roles: state.roles,
          branchId: state.branchId || undefined,
          ...personal,
        };
        onSaved(await employeesApi.create(body), true);
      } else if (employee) {
        // Solo se envía lo que cambió: el backend audita campo por campo.
        const body: UpdateEmployeeRequest = {};
        if (state.firstName.trim() !== employee.firstName) body.firstName = state.firstName.trim();
        if (state.lastName.trim() !== employee.lastName) body.lastName = state.lastName.trim();
        if (state.username !== employee.username) body.username = state.username;
        if (personal.nationalId !== employee.nationalId || (personal.nationalId && personal.documentType !== employee.documentType)) {
          body.nationalId = personal.nationalId;
          body.documentType = personal.documentType;
        }
        if (personal.email !== employee.email) body.email = personal.email;
        if (personal.phone !== employee.phone) body.phone = personal.phone;
        if (personal.address !== employee.address) body.address = personal.address;
        if (can.access) {
          const sorted = (roles: TenantRole[]) => [...roles].sort().join();
          if (sorted(state.roles) !== sorted(employee.roles)) body.roles = state.roles;
          if ((state.branchId || null) !== employee.branchId) body.branchId = state.branchId || null;
        }
        onSaved(Object.keys(body).length ? await employeesApi.update(employee.id, body) : employee, false);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      size="lg"
      title={creating ? 'Nuevo empleado' : `Editar · ${employee?.fullName ?? ''}`}
      subtitle={creating ? 'Se crean juntos la persona, su usuario y sus roles.' : 'Cambiar roles o sucursal cierra sus sesiones: vuelve a ingresar con los permisos nuevos.'}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary px-4" onClick={() => void submit()} disabled={busy}>
            {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : <i className="bi bi-check2 me-2" aria-hidden="true" />}
            {creating ? 'Crear empleado' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h3 className="eyebrow mb-2">Datos personales</h3>
        <div className="row g-3 mb-4">
          <Field label="Nombre" required className="col-md-6">
            <input className="form-control" value={state.firstName} maxLength={100} onChange={(event) => set('firstName', event.target.value)} data-autofocus />
          </Field>
          <Field label="Apellido" required className="col-md-6">
            <input className="form-control" value={state.lastName} maxLength={100} onChange={(event) => set('lastName', event.target.value)} />
          </Field>
          <Field label="Documento" className="col-md-6" hint="Opcional. Si ya existe un cliente con ese documento, se usa esa misma persona.">
            <div className="input-group">
              <select className="form-select flex-grow-0 w-auto" value={state.documentType} onChange={(event) => set('documentType', Number(event.target.value) as DocumentType)} aria-label="Tipo de documento">
                {DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DOCUMENT_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
              <input className="form-control mono" inputMode="numeric" value={state.nationalId} maxLength={20} onChange={(event) => set('nationalId', event.target.value)} aria-label="Número de documento" />
            </div>
          </Field>
          <Field label="Email" className="col-md-6">
            <input className="form-control" type="email" value={state.email} maxLength={150} onChange={(event) => set('email', event.target.value)} />
          </Field>
          <Field label="Teléfono" className="col-md-6">
            <input className="form-control" inputMode="tel" value={state.phone} maxLength={30} onChange={(event) => set('phone', event.target.value)} />
          </Field>
          <Field label="Domicilio" className="col-md-6">
            <input className="form-control" value={state.address} maxLength={255} onChange={(event) => set('address', event.target.value)} />
          </Field>
        </div>

        <h3 className="eyebrow mb-2">Acceso al sistema</h3>
        <div className="row g-3 mb-4">
          <Field
            label="Usuario"
            required
            className="col-md-6"
            hint={employee?.sharedAccount ? 'La cuenta también se usa en otra empresa: el usuario no se cambia desde acá.' : 'Con este nombre ingresa al sistema.'}
          >
            <input
              className="form-control mono"
              value={state.username}
              maxLength={50}
              autoComplete="off"
              spellCheck={false}
              disabled={employee?.sharedAccount}
              onChange={(event) => {
                setUsernameTouched(true);
                set('username', event.target.value.toLowerCase().replace(/\s/g, ''));
              }}
            />
          </Field>
          {creating && (
            <div className="col-md-6">
              <PasswordField label="Contraseña inicial" value={state.password} onChange={(value) => set('password', value)} withRules />
            </div>
          )}
        </div>

        <h3 className="eyebrow mb-1">Roles</h3>
        <p className="small text-muted-2 mb-2">
          Puede tener uno o más: los permisos se suman. {can.access ? '' : can.reason}
        </p>
        <div className="row g-2 mb-4">
          {isOwner && (
            <div className="col-md-6">
              <div className="border rounded-3 p-2 h-100 bg-light-subtle">
                <div className="form-check mb-0">
                  <input id="role-OWNER" className="form-check-input" type="checkbox" checked disabled />
                  <label className="form-check-label fw-semibold" htmlFor="role-OWNER">
                    {ROLE_LABEL.OWNER}
                  </label>
                </div>
                <div className="small text-muted-2 ms-4">{ROLE_DESCRIPTION.OWNER}</div>
              </div>
            </div>
          )}
          {ASSIGNABLE.map((role) => {
            const adminLocked = role === 'ADMIN' && !actorIsOwner;
            const disabled = !can.access || adminLocked;
            const checked = state.roles.includes(role);
            return (
              <div key={role} className="col-md-6">
                <div className={`border rounded-3 p-2 h-100 ${checked ? 'border-primary bg-primary-subtle' : ''}`}>
                  <div className="form-check mb-0">
                    <input id={`role-${role}`} className="form-check-input" type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleRole(role)} />
                    <label className="form-check-label fw-semibold" htmlFor={`role-${role}`}>
                      {ROLE_LABEL[role]}
                    </label>
                  </div>
                  <div className="small text-muted-2 ms-4">
                    {ROLE_DESCRIPTION[role]}
                    {adminLocked && <div className="text-warning-emphasis">Solo el titular lo otorga o lo quita.</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <h3 className="eyebrow mb-2">Sucursal</h3>
        <Field
          label="Sucursal asignada"
          required={branchRequired}
          hint={branchRequired ? 'Cajeros, vendedores y depósito trabajan siempre en una sucursal.' : 'Sin sucursal asignada puede elegir cualquiera. Con sucursal, queda limitado a ella.'}
        >
          <select className="form-select" value={state.branchId} disabled={!can.access} onChange={(event) => set('branchId', event.target.value)}>
            <option value="">{branchRequired ? 'Elegí una sucursal…' : 'Todas las sucursales (sin asignar)'}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}

// ── Contraseña y estado ─────────────────────────────────────────

function ResetPasswordModal({ employee, onClose, onDone }: { employee: Employee | null; onClose: () => void; onDone: (message: string) => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setConfirm('');
    setError(null);
  }, [employee]);

  if (!employee) return null;
  const valid = isStrongPassword(password) && password === confirm;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await employeesApi.resetPassword(employee.id, password);
      onDone(result.message);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      size="sm"
      title="Cambiar contraseña"
      subtitle={`${employee.fullName} (${employee.username}). Se cierran sus sesiones abiertas.`}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !valid}>
            {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
            Guardar contraseña
          </button>
        </>
      }
    >
      <div className="d-flex flex-column gap-3">
        <PasswordField label="Contraseña nueva" value={password} onChange={setPassword} withRules autoFocus />
        <div>
          <PasswordField label="Repetila" value={confirm} onChange={setConfirm} />
          {confirm && confirm !== password && <div className="small text-danger mt-1">Las contraseñas no coinciden.</div>}
        </div>
        <div className="legal-note">Comunicásela al empleado por un medio privado. Conviene que la cambie desde «Cambiar mi contraseña» al ingresar.</div>
      </div>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}

function ToggleStatusModal({ employee, onClose, onDone }: { employee: Employee | null; onClose: () => void; onDone: (employee: Employee) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [employee]);

  if (!employee) return null;
  const deactivating = employee.status === 'ACTIVE';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(deactivating ? await employeesApi.deactivate(employee.id) : await employeesApi.activate(employee.id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      size="sm"
      title={deactivating ? 'Desactivar empleado' : 'Reactivar empleado'}
      subtitle={employee.fullName}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Volver
          </button>
          <button type="button" className={`btn ${deactivating ? 'btn-danger' : 'btn-success'}`} onClick={() => void submit()} disabled={busy}>
            {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
            {deactivating ? 'Desactivar' : 'Reactivar'}
          </button>
        </>
      }
    >
      <p className="mb-0">
        {deactivating
          ? 'Deja de poder ingresar de inmediato y se cierran sus sesiones. Sus ventas, cajas y movimientos quedan en el historial.'
          : 'Vuelve a poder ingresar con su usuario y contraseña actuales.'}
      </p>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
