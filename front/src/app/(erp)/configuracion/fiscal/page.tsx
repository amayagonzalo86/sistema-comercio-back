'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { fiscalApi } from '@/lib/api/endpoints';
import type { ArcaEnvironment, FiscalStatus, IssuerVatCondition, UpsertFiscalProfileRequest } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { cuit, dateTime, isValidCuit } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

const SECRET_REF = /^(env:[A-Z][A-Z0-9_]{2,100}|file:[\w./-]{1,200})$/;

const EMPTY: UpsertFiscalProfileRequest = {
  taxId: '',
  legalName: '',
  vatConditionCode: 'RESPONSABLE_INSCRIPTO',
  environment: 'HOMOLOGATION',
  grossIncomeRegistration: '',
  activityStartDate: '',
  commercialAddress: '',
  certificateSecretRef: 'file:empresa.crt',
  privateKeySecretRef: 'file:empresa.key',
};

export default function FiscalSettingsPage() {
  return (
    <RequireCapability capability="fiscal.configure">
      <FiscalSettings />
    </RequireCapability>
  );
}

function FiscalSettings() {
  const toast = useToast();
  const { branches } = useSession();
  const profile = useApiQuery(() => fiscalApi.profile(), []);
  const points = useApiQuery(() => fiscalApi.pointsOfSale(), []);
  const [form, setForm] = useState<UpsertFiscalProfileRequest>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<FiscalStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [posNumbers, setPosNumbers] = useState<Record<string, string>>({});

  useEffect(() => {
    const data = profile.data;
    if (!data) return;
    setForm({
      taxId: data.taxId,
      legalName: data.legalName,
      vatConditionCode: data.vatConditionCode,
      environment: data.environment,
      grossIncomeRegistration: data.grossIncomeRegistration ?? '',
      activityStartDate: data.activityStartDate ?? '',
      commercialAddress: data.commercialAddress ?? '',
      certificateSecretRef: data.certificateSecretRef ?? '',
      privateKeySecretRef: data.privateKeySecretRef ?? '',
    });
  }, [profile.data]);

  const set = <K extends keyof UpsertFiscalProfileRequest>(key: K, value: UpsertFiscalProfileRequest[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidCuit(form.taxId)) return setError('La CUIT no es válida (revisá el dígito verificador).');
    for (const ref of [form.certificateSecretRef, form.privateKeySecretRef]) {
      if (ref && !SECRET_REF.test(ref)) return setError('Las referencias deben tener la forma env:NOMBRE_VARIABLE o file:archivo.crt. Nunca pegues el certificado ni la clave acá.');
    }
    setSaving(true);
    setError(null);
    try {
      await fiscalApi.saveProfile({
        ...form,
        taxId: form.taxId.replace(/\D/g, ''),
        grossIncomeRegistration: form.grossIncomeRegistration?.trim() || undefined,
        activityStartDate: form.activityStartDate || undefined,
        commercialAddress: form.commercialAddress?.trim() || undefined,
        certificateSecretRef: form.certificateSecretRef?.trim() || undefined,
        privateKeySecretRef: form.privateKeySecretRef?.trim() || undefined,
      });
      toast.success('Datos fiscales guardados');
      profile.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const check = async () => {
    setChecking(true);
    try {
      setStatus(await fiscalApi.status());
    } catch (caught) {
      toast.error('No se pudo consultar ARCA', errorMessage(caught));
    } finally {
      setChecking(false);
    }
  };

  const addPoint = async (branchId: string) => {
    const number = Number(posNumbers[branchId]);
    if (!Number.isInteger(number) || number < 1 || number > 99998) {
      toast.error('Número de punto de venta inválido', 'Usá el número dado de alta en ARCA (1 a 99998).');
      return;
    }
    try {
      await fiscalApi.createPointOfSale(branchId, number);
      toast.success('Punto de venta asociado');
      points.reload();
    } catch (caught) {
      toast.error('No se pudo asociar', errorMessage(caught));
    }
  };

  const environment = form.environment;

  return (
    <>
      <PageHeader eyebrow="Empresa" title="Datos fiscales y ARCA" subtitle="Emisor de los comprobantes electrónicos (WSAA + WSFEv1). Hacé la puesta en marcha junto con el contador." />
      {profile.error && profile.status !== 404 && <ErrorAlert message={profile.error} onRetry={profile.reload} />}

      <div className="row g-3">
        <div className="col-xl-7">
          <form onSubmit={save}>
            <Surface
              title="Perfil fiscal del emisor"
              subtitle={profile.data ? `Última actualización ${dateTime(profile.data.updatedAt)}` : 'Todavía no configurado: sin perfil se asume Responsable Inscripto.'}
              actions={<button type="submit" className="btn btn-sm btn-primary" disabled={saving}>{saving && <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />}Guardar</button>}
            >
              <div className="row g-3">
                <Field label="CUIT" className="col-md-4" required hint={form.taxId && !isValidCuit(form.taxId) ? <span className="text-danger">CUIT inválida</span> : cuit(form.taxId)}>
                  <input className="form-control mono" value={form.taxId} maxLength={13} onChange={(event) => set('taxId', event.target.value)} />
                </Field>
                <Field label="Razón social" className="col-md-8" required>
                  <input className="form-control" value={form.legalName} maxLength={150} onChange={(event) => set('legalName', event.target.value)} />
                </Field>
                <Field label="Condición frente al IVA" className="col-md-6">
                  <select className="form-select" value={form.vatConditionCode} onChange={(event) => set('vatConditionCode', event.target.value as IssuerVatCondition)}>
                    <option value="RESPONSABLE_INSCRIPTO">Responsable Inscripto (A/B)</option>
                    <option value="MONOTRIBUTO">Monotributo (C)</option>
                    <option value="EXENTO">IVA Exento (C)</option>
                  </select>
                </Field>
                <Field label="Ingresos Brutos" className="col-md-6">
                  <input className="form-control mono" value={form.grossIncomeRegistration ?? ''} maxLength={30} onChange={(event) => set('grossIncomeRegistration', event.target.value)} placeholder="901-123456-7 o Convenio Multilateral" />
                </Field>
                <Field label="Inicio de actividades" className="col-md-6">
                  <input type="date" className="form-control" value={form.activityStartDate ?? ''} onChange={(event) => set('activityStartDate', event.target.value)} />
                </Field>
                <Field label="Domicilio comercial" className="col-md-6">
                  <input className="form-control" value={form.commercialAddress ?? ''} maxLength={255} onChange={(event) => set('commercialAddress', event.target.value)} />
                </Field>
                <div className="col-12">
                  <div className="eyebrow mb-2">Ambiente</div>
                  <div className="segmented">
                    {(['HOMOLOGATION', 'PRODUCTION'] as ArcaEnvironment[]).map((value) => (
                      <button key={value} type="button" className={environment === value ? 'active' : ''} onClick={() => set('environment', value)}>
                        {value === 'HOMOLOGATION' ? 'Homologación (pruebas)' : 'Producción'}
                      </button>
                    ))}
                  </div>
                  {environment === 'PRODUCTION' && <div className="alert alert-warning small py-2 mt-2 mb-0">En producción los comprobantes tienen validez fiscal. Pasá a producción solo después de probar en homologación.</div>}
                </div>
                <Field label="Certificado (referencia)" className="col-md-6" hint="file:empresa.crt o env:ARCA_CERT">
                  <input className="form-control mono" value={form.certificateSecretRef ?? ''} maxLength={210} onChange={(event) => set('certificateSecretRef', event.target.value)} />
                </Field>
                <Field label="Clave privada (referencia)" className="col-md-6" hint="file:empresa.key o env:ARCA_KEY">
                  <input className="form-control mono" value={form.privateKeySecretRef ?? ''} maxLength={210} onChange={(event) => set('privateKeySecretRef', event.target.value)} />
                </Field>
                <div className="col-12">
                  <div className="legal-note">
                    <i className="bi bi-shield-lock me-1" aria-hidden="true" />
                    El certificado y la clave privada se guardan solo en el servidor (carpeta protegida o variables de entorno). Acá se carga únicamente <strong>dónde</strong> están, nunca su contenido.
                  </div>
                </div>
              </div>
              {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
            </Surface>
          </form>
        </div>

        <div className="col-xl-5 d-flex flex-column gap-3">
          <Surface
            title="Conexión con ARCA"
            actions={<button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void check()} disabled={checking || !profile.data}>{checking ? <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" /> : <i className="bi bi-plug me-1" aria-hidden="true" />}Probar</button>}
          >
            {!status ? (
              <div className="small text-muted-2">Probá la conexión después de guardar el perfil y copiar el certificado al servidor.</div>
            ) : (
              <div className="small">
                <div className="ticket-row"><span>Ambiente</span><span>{status.environment === 'PRODUCTION' ? 'Producción' : 'Homologación'}</span></div>
                <div className="ticket-row"><span>CUIT</span><span className="value">{cuit(status.cuit)}</span></div>
                <div className="ticket-row"><span>Servidores WSFE</span><span>{status.servers ? `${status.servers.app ?? '?'} / ${status.servers.db ?? '?'} / ${status.servers.auth ?? '?'}` : 'Sin respuesta'}</span></div>
                <div className="ticket-row align-items-center"><span>Credenciales</span>{status.credentials === 'OK' ? <StatusBadge tone="green">OK</StatusBadge> : <StatusBadge tone="red">Error</StatusBadge>}</div>
                {status.credentials !== 'OK' && <div className="alert alert-danger py-2 mt-2 mb-0">{status.credentials}</div>}
              </div>
            )}
          </Surface>

          <Surface title="Puntos de venta por sucursal" subtitle="Dalos de alta en ARCA como “RECE para aplicativo y web services”." padded={false}>
            <table className="table table-erp">
              <tbody>
                {branches.map((branch) => {
                  const assigned = (points.data ?? []).filter((point) => point.branchId === branch.id && point.isActive && point.environment === environment);
                  return (
                    <tr key={branch.id}>
                      <td className="cell-title">{branch.name}</td>
                      <td className="text-end">
                        {assigned.length > 0 ? (
                          assigned.map((point) => <span key={point.id} className="badge text-bg-light border mono me-1">PV {String(point.number).padStart(5, '0')}</span>)
                        ) : (
                          <div className="input-group input-group-sm justify-content-end" style={{ maxWidth: 200, marginLeft: 'auto' }}>
                            <input className="form-control mono" inputMode="numeric" placeholder="N.º PV" value={posNumbers[branch.id] ?? ''} onChange={(event) => setPosNumbers((current) => ({ ...current, [branch.id]: event.target.value }))} />
                            <button type="button" className="btn btn-outline-primary" onClick={() => void addPoint(branch.id)} disabled={!profile.data}>Asociar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="small text-muted-2 px-3 py-2 border-top">Se muestran los puntos del ambiente seleccionado ({environment === 'PRODUCTION' ? 'producción' : 'homologación'}).</div>
          </Surface>
        </div>
      </div>
    </>
  );
}
