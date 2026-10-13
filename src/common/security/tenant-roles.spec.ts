import { ForbiddenException } from '@nestjs/common';
import { TenantRole } from '../../modules/platform/entities/tenant-membership.entity';
import { requireAssignedBranch } from './tenant-branch-access';
import { actorTenantRoles, hasAnyTenantRole, membershipRoles, normalizeTenantRoles, splitTenantRoles } from './tenant-roles';

describe('roles múltiples por empresa', () => {
  it('ordena por jerarquía, quita duplicados y valores desconocidos', () => {
    expect(normalizeTenantRoles(['SELLER', 'CASHIER', 'SELLER', 'HACKER', 'MANAGER'])).toEqual([
      TenantRole.MANAGER,
      TenantRole.CASHIER,
      TenantRole.SELLER,
    ]);
  });

  it('separa rol principal y adicionales, y los vuelve a unir', () => {
    const split = splitTenantRoles([TenantRole.INVENTORY, TenantRole.CASHIER]);
    expect(split).toEqual({ role: TenantRole.CASHIER, additionalRoles: [TenantRole.INVENTORY] });
    expect(membershipRoles(split)).toEqual([TenantRole.CASHIER, TenantRole.INVENTORY]);
    expect(splitTenantRoles([TenantRole.VIEWER])).toEqual({ role: TenantRole.VIEWER, additionalRoles: null });
    expect(() => splitTenantRoles([])).toThrow(RangeError);
  });

  it('ignora basura en additional_roles', () => {
    expect(membershipRoles({ role: TenantRole.SELLER, additionalRoles: ['OWNER-FAKE', 42, null] })).toEqual([TenantRole.SELLER]);
  });

  it('usa tenantRoles cuando existen y tenantRole como respaldo', () => {
    expect(actorTenantRoles({ tenantRole: 'CASHIER', tenantRoles: ['CASHIER', 'INVENTORY'] })).toEqual(['CASHIER', 'INVENTORY']);
    expect(actorTenantRoles({ tenantRole: 'ADMIN' })).toEqual(['ADMIN']);
    expect(hasAnyTenantRole({ tenantRole: 'CASHIER', tenantRoles: ['CASHIER', 'ADMIN'] }, new Set(['ADMIN']))).toBe(true);
  });

  it('exige sucursal solo si todos los roles son de sucursal', () => {
    expect(() => requireAssignedBranch({ tenantRoles: ['CASHIER', 'INVENTORY'] })).toThrow(ForbiddenException);
    expect(requireAssignedBranch({ tenantRoles: ['MANAGER', 'CASHIER'] })).toBeNull();
    expect(requireAssignedBranch({ tenantRoles: ['MANAGER', 'CASHIER'], branchId: 'b1' })).toBe('b1');
  });
});
