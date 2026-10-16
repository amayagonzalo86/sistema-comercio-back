import { UserRoleEnum } from '../../modules/roles/entities/role.entity';
import { TenantRole } from '../../modules/platform/entities/tenant-membership.entity';

/**
 * Roles de un usuario dentro de una empresa.
 *
 * Una membresía tiene un rol principal (`role`, el de mayor jerarquía) y roles adicionales
 * (`additional_roles`). Los permisos son la UNIÓN de todos: un empleado CAJERO + DEPÓSITO
 * puede cobrar y también recibir mercadería.
 */

/** De mayor a menor jerarquía: el primero presente es el rol principal. */
export const TENANT_ROLE_PRIORITY: readonly TenantRole[] = [
  TenantRole.OWNER,
  TenantRole.ADMIN,
  TenantRole.MANAGER,
  TenantRole.ACCOUNTANT,
  TenantRole.CASHIER,
  TenantRole.SELLER,
  TenantRole.INVENTORY,
  TenantRole.VIEWER,
];

/** Equivalencia rol de empresa → roles que usan los @Roles(...) de los controladores. */
export const TENANT_ROLE_GUARD_MAP: Readonly<Record<TenantRole, readonly UserRoleEnum[]>> = {
  [TenantRole.OWNER]: [UserRoleEnum.ADMIN],
  [TenantRole.ADMIN]: [UserRoleEnum.ADMIN],
  [TenantRole.MANAGER]: [UserRoleEnum.MANAGER],
  [TenantRole.ACCOUNTANT]: [UserRoleEnum.USER],
  [TenantRole.CASHIER]: [UserRoleEnum.CASHIER],
  [TenantRole.INVENTORY]: [UserRoleEnum.WAREHOUSE, UserRoleEnum.STOCK_CLERK],
  [TenantRole.SELLER]: [UserRoleEnum.SELLER],
  [TenantRole.VIEWER]: [UserRoleEnum.USER],
};

/** Roles que trabajan siempre dentro de una sucursal (cobran, venden o mueven stock en un local). */
export const BRANCH_SCOPED_TENANT_ROLES: ReadonlySet<string> = new Set([TenantRole.CASHIER, TenantRole.SELLER, TenantRole.INVENTORY]);

const VALID_ROLES: ReadonlySet<string> = new Set(Object.values(TenantRole));

export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && VALID_ROLES.has(value);
}

/** Ordena por jerarquía y quita duplicados o valores desconocidos. */
export function normalizeTenantRoles(roles: readonly unknown[]): TenantRole[] {
  const set = new Set(roles.filter(isTenantRole));
  return TENANT_ROLE_PRIORITY.filter((role) => set.has(role));
}

/** Todos los roles de una membresía (principal + adicionales), ordenados por jerarquía. */
export function membershipRoles(membership: { role: TenantRole; additionalRoles?: readonly unknown[] | null }): TenantRole[] {
  return normalizeTenantRoles([membership.role, ...(Array.isArray(membership.additionalRoles) ? membership.additionalRoles : [])]);
}

/** Separa una lista de roles en rol principal + adicionales para guardarla en la membresía. */
export function splitTenantRoles(roles: readonly TenantRole[]): { role: TenantRole; additionalRoles: TenantRole[] | null } {
  const ordered = normalizeTenantRoles(roles);
  if (ordered.length === 0) throw new RangeError('Se requiere al menos un rol.');
  const [role, ...rest] = ordered;
  return { role, additionalRoles: rest.length ? rest : null };
}

export interface TenantRoleActor {
  tenantRole?: string;
  tenantRoles?: readonly string[];
}

/** Roles efectivos del usuario autenticado (los completa TenantContextGuard desde la base). */
export function actorTenantRoles(actor: TenantRoleActor): string[] {
  if (Array.isArray(actor.tenantRoles) && actor.tenantRoles.length > 0) return [...actor.tenantRoles];
  return actor.tenantRole ? [actor.tenantRole] : [];
}

export function hasAnyTenantRole(actor: TenantRoleActor, allowed: ReadonlySet<string>): boolean {
  return actorTenantRoles(actor).some((role) => allowed.has(role));
}

/** Roles que venden o cobran: ven precios pero no costos, fletes ni márgenes. */
const PRICE_ONLY_ROLES: ReadonlySet<string> = new Set([TenantRole.SELLER, TenantRole.CASHIER]);

/**
 * Puede ver costos y márgenes quien tenga al menos un rol de gestión, depósito o contaduría.
 * Un vendedor o cajero (solo esos roles) ve únicamente precios de venta.
 */
export function canSeeProductCosts(actor: TenantRoleActor): boolean {
  const roles = actorTenantRoles(actor);
  return roles.length === 0 || roles.some((role) => !PRICE_ONLY_ROLES.has(role));
}
