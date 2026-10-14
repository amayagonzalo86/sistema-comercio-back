'use client';

import type { ReactNode } from 'react';
import type { Capability } from '@/lib/auth/permissions';
import { useSession } from '@/lib/auth/session';
import { EmptyState } from './Feedback';

/** Muestra el contenido solo si el rol puede usarlo; si no, un aviso claro en lugar de un error 403. */
export function RequireCapability({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can } = useSession();
  if (!can(capability)) {
    return (
      <div className="surface">
        <EmptyState icon="bi-lock" title="Sin acceso a esta sección">
          Tu rol no tiene permiso para esta pantalla. Si lo necesitás, pedíselo al titular de la empresa.
        </EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}

/** Pantallas que operan sobre una sucursal concreta (punto de venta, caja). */
export function RequireBranch({ children, reason }: { children: (branchId: string) => ReactNode; reason: string }) {
  const { activeBranchId, branches, setActiveBranchId } = useSession();
  if (activeBranchId) return <>{children(activeBranchId)}</>;
  return (
    <div className="surface">
      <EmptyState icon="bi-shop" title="Elegí una sucursal">
        <p className="mb-3">{reason}</p>
        <div className="d-flex flex-wrap justify-content-center gap-2">
          {branches.map((branch) => (
            <button key={branch.id} type="button" className="btn btn-outline-primary btn-sm" onClick={() => setActiveBranchId(branch.id)}>
              <i className="bi bi-shop me-1" aria-hidden="true" />
              {branch.name}
            </button>
          ))}
        </div>
      </EmptyState>
    </div>
  );
}
