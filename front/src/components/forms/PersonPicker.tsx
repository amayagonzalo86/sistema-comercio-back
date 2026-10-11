'use client';

import { useEffect, useRef, useState } from 'react';
import { personsApi } from '@/lib/api/endpoints';
import type { Person } from '@/lib/api/types';
import { cuit, personName, TAX_CONDITION_LABEL } from '@/lib/format';
import { useDebounce } from '@/lib/hooks/useDebounce';

interface PersonPickerProps {
  role: 'customers' | 'suppliers';
  value: Person | null;
  onChange: (person: Person | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
  id?: string;
}

/** Buscador de clientes o proveedores por nombre, CUIT/DNI, email o teléfono. */
export function PersonPicker({ role, value, onChange, placeholder = 'Buscar por nombre, CUIT o DNI…', allowClear = true, clearLabel = 'Quitar', id }: PersonPickerProps) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounce(term, 250);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    personsApi
      .list({ role, search: debounced.trim() || undefined, limit: 8 }, controller.signal)
      .then((page) => setResults(page.items))
      .catch(() => {
        if (!controller.signal.aborted) setResults([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [debounced, open, role]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  if (value) {
    return (
      <div className="d-flex align-items-center gap-2 border rounded-3 px-3 py-2 bg-white">
        <i className="bi bi-person-badge text-primary" aria-hidden="true" />
        <div className="flex-grow-1 min-w-0">
          <div className="fw-semibold text-ink text-truncate">{personName(value)}</div>
          <div className="small text-muted-2">
            {TAX_CONDITION_LABEL[value.vatCondition]}
            {value.nationalId ? <span className="mono"> · {cuit(value.nationalId)}</span> : null}
          </div>
        </div>
        {allowClear && (
          <button type="button" className="btn btn-sm btn-light" onClick={() => onChange(null)}>
            {clearLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="position-relative" ref={wrapperRef}>
      <div className="search-field mw-100">
        <i className="bi bi-search" aria-hidden="true" />
        <input
          id={id}
          className="form-control"
          value={term}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          autoComplete="off"
        />
      </div>
      {open && (
        <div className="surface pos-results" role="listbox">
          {loading && <div className="small text-muted-2 p-3">Buscando…</div>}
          {!loading && results.length === 0 && <div className="small text-muted-2 p-3">Sin coincidencias.</div>}
          {!loading &&
            results.map((person) => (
              <div
                key={person.id}
                className="result"
                role="option"
                aria-selected={false}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(person);
                  setTerm('');
                  setOpen(false);
                }}
              >
                <i className="bi bi-person text-muted-2" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-ink fw-medium text-truncate">{personName(person)}</div>
                  <div className="small text-muted-2">
                    {TAX_CONDITION_LABEL[person.vatCondition]}
                    {person.nationalId ? <span className="mono"> · {cuit(person.nationalId)}</span> : null}
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
