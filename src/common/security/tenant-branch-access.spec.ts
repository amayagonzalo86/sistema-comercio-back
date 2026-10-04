import { ForbiddenException } from '@nestjs/common';
import {
  requireAssignedBranch,
  requireBranchAccess,
} from './tenant-branch-access';

describe('tenant branch access', () => {
  it('requires branch assignment for cashier, seller, and inventory roles', () => {
    for (const tenantRole of ['CASHIER', 'SELLER', 'INVENTORY']) {
      expect(() => requireAssignedBranch({ tenantRole })).toThrow(ForbiddenException);
    }
  });

  it('returns the active membership branch when one is assigned', () => {
    expect(requireAssignedBranch({ tenantRole: 'SELLER', branchId: 'branch-a' })).toBe('branch-a');
  });

  it('allows a tenant-wide role with no branch assignment', () => {
    expect(requireAssignedBranch({ tenantRole: 'ADMIN', branchId: null })).toBeNull();
    expect(() => requireBranchAccess({ tenantRole: 'ADMIN' }, 'branch-b')).not.toThrow();
  });

  it('allows a user to access the assigned branch', () => {
    expect(() =>
      requireBranchAccess({ tenantRole: 'CASHIER', branchId: 'branch-a' }, 'branch-a'),
    ).not.toThrow();
  });

  it('rejects access to a different branch, including assigned managers', () => {
    expect(() =>
      requireBranchAccess({ tenantRole: 'SELLER', branchId: 'branch-a' }, 'branch-b'),
    ).toThrow(ForbiddenException);
    expect(() =>
      requireBranchAccess({ tenantRole: 'MANAGER', branchId: 'branch-a' }, 'branch-b'),
    ).toThrow(ForbiddenException);
  });
});
