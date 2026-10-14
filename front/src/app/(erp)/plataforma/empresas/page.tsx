'use client';

import { useState } from 'react';
import { EmptyState, ErrorAlert, Spinner } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { platformApi } from '@/lib/api/endpoints';
import type { PlatformTenantVat, VatRegime } from '@/lib/api/types';
import { VAT_REGIME_LABEL } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

export default function PlatformTenantsPage() {
  return (
    <RequireCapability capability="platform.manage">
      <PlatformTenants />
    </RequireCapability>
  );
}

function PlatformTenants() {
  const toast = useToast();
  const tenants = useApiQuery(() => platformApi.tenants(), []);
  const [saving, setSaving] = useState<string | null>(null);

  const replace = (updated: PlatformTenantVat) => {
    if (!tenants.data) return;
    tenants.setData(tenants.data.map((tenant) => (tenant.id === updated.id ? updated : tenant)));
  };

  const run = async (key: string, action: () => Promise<PlatformTenantVat>, message: string) => {
    setSaving(key);
    try {
      replace(await action());
      toast.success('Régimen actualizado', message);
    } catch (caught) {
      toast.error('No se pudo guardar', errorMessage(caught));
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Plataforma"
        title="Empresas y régimen de IVA"
        subtitle="Configuración que administra la plataforma. Con Tierra del Fuego (Ley 19.640) las ventas salen exentas de IVA sin que el vendedor cargue nada."
      />
      {tenants.error && <ErrorAlert message={tenants.error} onRetry={tenants.reload} />}
      {tenants.loading && !tenants.data && <Spinner />}
      {tenants.data?.length === 0 && (
        <div className="surface">
          <EmptyState icon="bi-buildings" title="Sin empresas" />
        </div>
      )}
      <div className="d-flex flex-column gap-3">
        {tenants.data?.map((tenant) => (
          <section key={tenant.id} className="surface">
            <div className="surface-header flex-wrap gap-2">
              <div>
                <h2 className="mb-0">{tenant.tradeName || tenant.legalName}</h2>
                <div className="small text-muted-2">
                  {tenant.legalName} · <span className="mono">{tenant.slug}</span>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                <label className="small text-muted-2 mb-0" htmlFor={`regime-${tenant.id}`}>
                  Régimen por defecto
                </label>
                <select
                  id={`regime-${tenant.id}`}
                  className="form-select form-select-sm w-auto"
                  value={tenant.defaultVatRegime}
                  disabled={saving !== null}
                  onChange={(event) => {
                    const value = event.target.value as VatRegime;
                    void run(`tenant-${tenant.id}`, () => platformApi.setTenantVatRegime(tenant.id, value), `${tenant.legalName}: ${VAT_REGIME_LABEL[value]}`);
                  }}
                >
                  {(Object.keys(VAT_REGIME_LABEL) as VatRegime[]).map((regime) => (
                    <option key={regime} value={regime}>
                      {VAT_REGIME_LABEL[regime]}
                    </option>
                  ))}
                </select>
                {saving === `tenant-${tenant.id}` && <span className="spinner-border spinner-border-sm" aria-hidden="true" />}
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-erp mb-0">
                <thead>
                  <tr>
                    <th>Sucursal</th>
                    <th>Régimen propio</th>
                    <th>Se aplica</th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.branches.map((branch) => (
                    <tr key={branch.id}>
                      <td>
                        <div className="cell-title">{branch.name}</div>
                        <div className="cell-sub mono">{branch.code}</div>
                      </td>
                      <td>
                        <select
                          className="form-select form-select-sm w-auto"
                          value={branch.vatRegime ?? ''}
                          disabled={saving !== null}
                          aria-label={`Régimen de ${branch.name}`}
                          onChange={(event) => {
                            const value = (event.target.value || null) as VatRegime | null;
                            void run(
                              `branch-${branch.id}`,
                              () => platformApi.setBranchVatRegime(tenant.id, branch.id, value),
                              `${branch.name}: ${value ? VAT_REGIME_LABEL[value] : 'usa el de la empresa'}`,
                            );
                          }}
                        >
                          <option value="">Usa el de la empresa</option>
                          {(Object.keys(VAT_REGIME_LABEL) as VatRegime[]).map((regime) => (
                            <option key={regime} value={regime}>
                              {VAT_REGIME_LABEL[regime]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {branch.effectiveVatRegime === 'TIERRA_DEL_FUEGO' ? (
                          <StatusBadge tone="blue">Sin IVA · Ley 19.640</StatusBadge>
                        ) : (
                          <StatusBadge tone="slate">IVA general</StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <div className="legal-note mt-3">
        El régimen Tierra del Fuego aplica a operaciones realizadas dentro del Área Aduanera Especial por empresas
        acogidas a la Ley 19.640. Para una venta puntual con IVA (por ejemplo, envío al continente), el titular o la
        administración pueden cambiarlo en el punto de venta. Verificá cada caso con el contador de la empresa.
      </div>
    </>
  );
}
