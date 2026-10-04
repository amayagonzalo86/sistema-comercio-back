import { ForbiddenException } from '@nestjs/common';

export interface TenantBranchActor {
  branchId?: string | null;
  tenantRole?: string;
}

const BRANCH_REQUIRED_ROLES = new Set(['CASHIER', 'SELLER', 'INVENTORY']);

export function requireAssignedBranch(actor: TenantBranchActor): string | null {
  if (BRANCH_REQUIRED_ROLES.has(actor.tenantRole ?? '') && !actor.branchId) {
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
