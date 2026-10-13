import { ForbiddenException } from '@nestjs/common';
import { actorTenantRoles, BRANCH_SCOPED_TENANT_ROLES } from './tenant-roles';

export interface TenantBranchActor {
  branchId?: string | null;
  tenantRole?: string;
  tenantRoles?: readonly string[];
}

/**
 * Exige sucursal asignada cuando TODOS los roles del usuario son de sucursal (cajero, vendedor, depósito).
 * Si además tiene un rol de alcance general (encargado, administración, contaduría), puede operar sin sucursal.
 * Con sucursal asignada, el usuario siempre queda limitado a ella.
 */
export function requireAssignedBranch(actor: TenantBranchActor): string | null {
  const roles = actorTenantRoles(actor);
  const onlyBranchRoles = roles.length > 0 && roles.every((role) => BRANCH_SCOPED_TENANT_ROLES.has(role));
  if (onlyBranchRoles && !actor.branchId) {
    throw new ForbiddenException('El usuario debe tener una sucursal asignada en esta empresa.');
  }

  return actor.branchId ?? null;
}

export function requireBranchAccess(
  actor: TenantBranchActor,
  requestedBranchId: string,
): void {
  const assignedBranchId = requireAssignedBranch(actor);
  if (assignedBranchId && assignedBranchId !== requestedBranchId) {
    throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
  }
}
