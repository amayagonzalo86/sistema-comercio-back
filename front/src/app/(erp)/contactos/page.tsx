'use client';

import { useState } from 'react';
import { PersonFormModal } from '@/components/forms/PersonFormModal';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { personsApi } from '@/lib/api/endpoints';
import type { Person } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { cuit, DOCUMENT_TYPE_LABEL, personName, TAX_CONDITION_LABEL } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useDebounce } from '@/lib/hooks/useDebounce';

const TYPE_LABEL = { CUSTOMER: 'Cliente', SUPPLIER: 'Proveedor', BOTH: 'Cliente y proveedor' } as const;

export default function ContactsPage() {
  return (
    <RequireCapability capability="contacts.view">
      <Contacts />
    </RequireCapability>
  );
}

function Contacts() {
  const toast = useToast();
  const { can } = useSession();
  const [role, setRole] = useState<'customers' | 'suppliers' | 'all'>('customers');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Person | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const term = useDebounce(search, 300);
  const people = useApiQuery((signal) => personsApi.list({ role, status, search: term.trim() || undefined, page, limit: 25 }, signal), [role, status, term, page]);

  const toggle = async (person: Person) => {
    try {
      if (person.isActive) await personsApi.deactivate(person.id);
      else await personsApi.activate(person.id);
      toast.success(person.isActive ? 'Contacto desactivado' : 'Contacto activado', personName(person));
      people.reload();
    } catch (caught) {
      toast.error('No se pudo actualizar', errorMessage(caught));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Clientes"
        title="Clientes y proveedores"
        subtitle="Datos fiscales validados (CUIT con dígito verificador) y consentimiento de marketing según Ley 25.326."
        actions={
          can('contacts.create') && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <i className="bi bi-person-plus me-1" aria-hidden="true" />
              Nuevo contacto
            </button>
          )
        }
      />
      <section className="surface">
        <div className="toolbar">
          <div className="segmented">
            {([['customers', 'Clientes'], ['suppliers', 'Proveedores'], ['all', 'Todos']] as const).map(([value, label]) => (
              <button key={value} type="button" className={role === value ? 'active' : ''} onClick={() => { setRole(value); setPage(1); }}>{label}</button>
            ))}
          </div>
          <div className="search-field">
            <i className="bi bi-search" aria-hidden="true" />
            <input className="form-control form-control-sm" placeholder="Nombre, CUIT/DNI, email o teléfono" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </div>
          <select className="form-select form-select-sm w-auto" value={status} onChange={(event) => { setStatus(event.target.value as 'active' | 'inactive' | 'all'); setPage(1); }} aria-label="Estado">
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>
        {people.error && <div className="p-3 pb-0"><ErrorAlert message={people.error} onRetry={people.reload} /></div>}
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>Nombre / razón social</th>
                <th>Documento</th>
                <th>Condición IVA</th>
                <th>Contacto</th>
                <th>Tipo</th>
                <th />
              </tr>
            </thead>
            {people.loading && !people.data ? (
              <SkeletonRows columns={6} />
            ) : people.data && people.data.items.length === 0 ? (
              <TableMessage colSpan={6}><EmptyState icon="bi-people" title="Sin contactos con esos filtros" /></TableMessage>
            ) : (
              <tbody>
                {people.data?.items.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <div className="cell-title">{personName(person)}</div>
                      {person.marketingConsent && <div className="cell-sub"><i className="bi bi-megaphone me-1" aria-hidden="true" />Acepta promociones</div>}
                    </td>
                    <td>
                      {person.nationalId ? (
                        <>
                          <span className="small text-muted-2">{person.documentType ? DOCUMENT_TYPE_LABEL[person.documentType] : 'Doc.'}</span> <span className="mono">{person.documentType === 80 || person.documentType === 86 ? cuit(person.nationalId) : person.nationalId}</span>
                        </>
                      ) : (
                        <span className="text-muted-2">—</span>
                      )}
                    </td>
                    <td>{TAX_CONDITION_LABEL[person.vatCondition]}</td>
                    <td className="small">
                      {person.email && <div>{person.email}</div>}
                      {person.phone && <div className="text-muted-2">{person.phone}</div>}
                    </td>
                    <td>
                      <span className="small">{TYPE_LABEL[person.personType]}</span>
                      {!person.isActive && <div><StatusBadge tone="slate">Inactivo</StatusBadge></div>}
                    </td>
                    <td className="text-end text-nowrap">
                      {can('contacts.manage') && (
                        <>
                          <button type="button" className="btn btn-sm btn-outline-secondary me-1" onClick={() => { setEditing(person); setFormOpen(true); }}>Editar</button>
                          <button type="button" className="btn btn-sm btn-link text-muted-2" onClick={() => void toggle(person)}>{person.isActive ? 'Desactivar' : 'Activar'}</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {people.data && <Pagination page={people.data.page} pages={people.data.pages} total={people.data.total} limit={people.data.limit} onPage={setPage} />}
      </section>
      <PersonFormModal
        open={formOpen}
        person={editing}
        defaultType={role === 'suppliers' ? 'SUPPLIER' : 'CUSTOMER'}
        onClose={() => setFormOpen(false)}
        onSaved={(person) => {
          setFormOpen(false);
          toast.success(editing ? 'Contacto actualizado' : 'Contacto creado', personName(person));
          people.reload();
        }}
      />
    </>
  );
}
