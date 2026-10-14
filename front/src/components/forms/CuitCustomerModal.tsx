'use client';

import { useEffect, useState } from 'react';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { errorMessage } from '@/lib/api/client';
import { personsApi } from '@/lib/api/endpoints';
import type { Person, TaxCondition } from '@/lib/api/types';
import { cuit as formatCuit, isValidCuit, personName, TAX_CONDITION_LABEL } from '@/lib/format';

const A_CONDITIONS: TaxCondition[] = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO'];

/**
 * Factura A: identifica al cliente por CUIT. Busca si ya está cargado; si no, lo da de alta con su
 * condición frente al IVA (Responsable Inscripto o Monotributista, RG 5003/2021).
 */
export function CuitCustomerModal({ open, onClose, onSelected }: { open: boolean; onClose: () => void; onSelected: (person: Person) => void }) {
  const [value, setValue] = useState('');
  const [found, setFound] = useState<Person | null>(null);
  const [searched, setSearched] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [condition, setCondition] = useState<TaxCondition>('RESPONSABLE_INSCRIPTO');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue('');
    setFound(null);
    setSearched(false);
    setLegalName('');
    setCondition('RESPONSABLE_INSCRIPTO');
    setError(null);
  }, [open]);

  const digits = value.replace(/\D/g, '');
  const valid = isValidCuit(digits);

  const search = async () => {
    if (!valid) {
      setError('La CUIT no es válida: revisá los 11 dígitos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const page = await personsApi.list({ search: digits, role: 'customers', limit: 5 });
      const match = page.items.find((person) => (person.nationalId ?? '').replace(/\D/g, '') === digits) ?? null;
      setFound(match);
      setSearched(true);
      if (match && !A_CONDITIONS.includes(match.vatCondition)) {
        setError(`El cliente está cargado como ${TAX_CONDITION_LABEL[match.vatCondition]}: le corresponde Factura B. Si cambió su condición, actualizala en Clientes.`);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (legalName.trim().length < 2) {
      setError('Ingresá la razón social o el nombre del cliente.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const person = await personsApi.create({
        personType: 'CUSTOMER',
        firstName: legalName.trim(),
        lastName: '-',
        documentType: 80,
        nationalId: digits,
        vatCondition: condition,
      });
      onSelected(person);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const canUseFound = found && A_CONDITIONS.includes(found.vatCondition);

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="sm"
      title="Factura A · identificar cliente"
      subtitle="Requiere CUIT de un Responsable Inscripto o Monotributista."
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          {canUseFound ? (
            <button type="button" className="btn btn-primary" onClick={() => found && onSelected(found)} disabled={busy}>
              Usar este cliente
            </button>
          ) : searched && !found ? (
            <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
              {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
              Dar de alta y usar
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void search()} disabled={busy || !valid}>
              {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
              Buscar
            </button>
          )}
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!searched) void search();
        }}
        className="d-flex flex-column gap-3"
      >
        <Field label="CUIT" hint={value && !valid ? 'CUIT inválida (11 dígitos con dígito verificador).' : undefined}>
          <input
            className={`form-control mono ${value && !valid ? 'is-invalid' : ''}`}
            inputMode="numeric"
            placeholder="30-12345678-9"
            value={value}
            maxLength={13}
            onChange={(event) => {
              setValue(event.target.value);
              setSearched(false);
              setFound(null);
              setError(null);
            }}
            data-autofocus
          />
        </Field>
        {found && (
          <div className="border rounded-3 p-2 small">
            <div className="fw-semibold text-ink">{personName(found)}</div>
            <div className="text-muted-2">
              {formatCuit(found.nationalId)} · {TAX_CONDITION_LABEL[found.vatCondition]}
            </div>
          </div>
        )}
        {searched && !found && (
          <>
            <div className="small text-muted-2">No está cargado. Completá los datos para darlo de alta:</div>
            <Field label="Razón social o nombre">
              <input className="form-control" value={legalName} maxLength={100} onChange={(event) => setLegalName(event.target.value)} />
            </Field>
            <Field label="Condición frente al IVA">
              <select className="form-select" value={condition} onChange={(event) => setCondition(event.target.value as TaxCondition)}>
                {A_CONDITIONS.map((item) => (
                  <option key={item} value={item}>
                    {TAX_CONDITION_LABEL[item]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      {error && <div className="alert alert-warning small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
