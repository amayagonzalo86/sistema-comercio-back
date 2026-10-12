'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { errorMessage } from '@/lib/api/client';
import { personsApi } from '@/lib/api/endpoints';
import type { DocumentType, Person, PersonRequest, PersonType, TaxCondition } from '@/lib/api/types';
import { DOCUMENT_TYPE_LABEL, isValidCuit, TAX_CONDITION_LABEL } from '@/lib/format';

interface PersonFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (person: Person) => void;
  person?: Person | null;
  defaultType?: PersonType;
}

interface FormState {
  personType: PersonType;
  firstName: string;
  lastName: string;
  documentType: DocumentType | '';
  nationalId: string;
  vatCondition: TaxCondition;
  email: string;
  phone: string;
  address: string;
  marketingConsent: boolean;
}

const EMPTY: FormState = {
  personType: 'CUSTOMER',
  firstName: '',
  lastName: '',
  documentType: 96,
  nationalId: '',
  vatCondition: 'CONSUMIDOR_FINAL',
  email: '',
  phone: '',
  address: '',
  marketingConsent: false,
};

/** Condiciones que exigen CUIT (el backend lo valida; acá se avisa antes de enviar). */
const NEEDS_CUIT: TaxCondition[] = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'];

function fromPerson(person: Person): FormState {
  return {
    personType: person.personType,
    firstName: person.firstName,
    lastName: person.lastName,
    documentType: person.documentType ?? '',
    nationalId: person.nationalId ?? '',
    vatCondition: person.vatCondition,
    email: person.email ?? '',
    phone: person.phone ?? '',
    address: person.address ?? '',
    marketingConsent: person.marketingConsent,
  };
}

export function PersonFormModal({ open, onClose, onSaved, person, defaultType = 'CUSTOMER' }: PersonFormModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(person);

  useEffect(() => {
    if (!open) return;
    setForm(person ? fromPerson(person) : { ...EMPTY, personType: defaultType });
    setError(null);
  }, [open, person, defaultType]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const isCompanyDoc = form.documentType === 80;
  const cuitWarning = (form.documentType === 80 || form.documentType === 86) && form.nationalId.length >= 11 && !isValidCuit(form.nationalId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (NEEDS_CUIT.includes(form.vatCondition) && (form.documentType !== 80 || !isValidCuit(form.nationalId))) {
      setError(`Un cliente ${TAX_CONDITION_LABEL[form.vatCondition]} debe cargarse con CUIT válida.`);
      return;
    }
    const clean = (value: string) => (value.trim() ? value.trim() : editing ? null : undefined);
    const body: PersonRequest = {
      personType: form.personType,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim() || '-',
      documentType: form.documentType === '' ? (editing ? null : undefined) : form.documentType,
      nationalId: form.documentType === 99 ? (editing ? null : undefined) : clean(form.nationalId.replace(/[\s-]/g, '')),
      vatCondition: form.vatCondition,
      email: clean(form.email),
      phone: clean(form.phone),
      address: clean(form.address),
      marketingConsent: form.marketingConsent,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = person ? await personsApi.update(person.id, body) : await personsApi.create(body);
      onSaved(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={editing ? 'Editar contacto' : 'Nuevo contacto'}
      subtitle="Los datos fiscales definen la letra del comprobante (A, B o C)."
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="person-form" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
            Guardar
          </button>
        </>
      }
    >
      <form id="person-form" onSubmit={submit} className="row g-3">
        <Field label="Tipo" className="col-md-4">
          <select className="form-select" value={form.personType} onChange={(event) => set('personType', event.target.value as PersonType)}>
            <option value="CUSTOMER">Cliente</option>
            <option value="SUPPLIER">Proveedor</option>
            <option value="BOTH">Cliente y proveedor</option>
          </select>
        </Field>
        <Field label="Condición frente al IVA" className="col-md-8" required>
          <select className="form-select" value={form.vatCondition} onChange={(event) => set('vatCondition', event.target.value as TaxCondition)}>
            {(Object.keys(TAX_CONDITION_LABEL) as TaxCondition[]).map((condition) => (
              <option key={condition} value={condition}>
                {TAX_CONDITION_LABEL[condition]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isCompanyDoc ? 'Razón social' : 'Nombre'} htmlFor="p-first" className="col-md-6" required>
          <input id="p-first" className="form-control" value={form.firstName} maxLength={100} required minLength={2} onChange={(event) => set('firstName', event.target.value)} />
        </Field>
        <Field label={isCompanyDoc ? 'Nombre de fantasía' : 'Apellido'} htmlFor="p-last" className="col-md-6" hint={isCompanyDoc ? 'Opcional para empresas.' : undefined}>
          <input id="p-last" className="form-control" value={form.lastName} maxLength={100} onChange={(event) => set('lastName', event.target.value)} />
        </Field>
        <Field label="Documento" className="col-md-4">
          <select
            className="form-select"
            value={form.documentType}
            onChange={(event) => set('documentType', event.target.value === '' ? '' : (Number(event.target.value) as DocumentType))}
          >
            {(Object.keys(DOCUMENT_TYPE_LABEL) as Array<`${DocumentType}`>).map((code) => (
              <option key={code} value={code}>
                {DOCUMENT_TYPE_LABEL[Number(code) as DocumentType]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Número" htmlFor="p-doc" className="col-md-8" hint={cuitWarning ? <span className="text-danger">El dígito verificador de la CUIT/CUIL no coincide.</span> : 'Sin puntos ni guiones.'}>
          <input
            id="p-doc"
            className={`form-control mono ${cuitWarning ? 'is-invalid' : ''}`}
            value={form.nationalId}
            disabled={form.documentType === 99}
            inputMode="numeric"
            maxLength={20}
            onChange={(event) => set('nationalId', event.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="p-email" className="col-md-6">
          <input id="p-email" type="email" className="form-control" value={form.email} maxLength={150} onChange={(event) => set('email', event.target.value)} />
        </Field>
        <Field label="Teléfono" htmlFor="p-phone" className="col-md-6">
          <input id="p-phone" type="tel" className="form-control" value={form.phone} maxLength={30} onChange={(event) => set('phone', event.target.value)} />
        </Field>
        <Field label="Domicilio" htmlFor="p-address" className="col-12">
          <input id="p-address" className="form-control" value={form.address} maxLength={255} onChange={(event) => set('address', event.target.value)} />
        </Field>
        <div className="col-12">
          <div className="form-check">
            <input id="p-consent" type="checkbox" className="form-check-input" checked={form.marketingConsent} onChange={(event) => set('marketingConsent', event.target.checked)} />
            <label htmlFor="p-consent" className="form-check-label small">
              Aceptó recibir promociones por email o WhatsApp
            </label>
          </div>
          <div className="legal-note mt-2">
            Ley 25.326: marcá esta opción solo con consentimiento expreso del titular. Puede pedir acceso, rectificación o baja de sus datos en cualquier momento.
          </div>
        </div>
        {error && (
          <div className="col-12">
            <div className="alert alert-danger small py-2 mb-0">{error}</div>
          </div>
        )}
      </form>
    </Modal>
  );
}
