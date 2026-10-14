import type { TenantRole } from '../api/types';

/**
 * Capacidades de la interfaz por rol de la empresa. Reflejan los @Roles del backend
 * (OWNER/ADMIN → ADMIN, INVENTORY → depósito, ACCOUNTANT/VIEWER → consulta) para no mostrar
 * acciones que la API va a rechazar. La autorización real siempre la hace el backend.
 */
export type Capability =
  | 'dashboard.view'
  | 'reports.view'
  | 'pos.sell'
  | 'pos.charge'
  | 'salesOrders.create'
  | 'salesQuotes.create'
  | 'salesOrders.view'
  | 'salesOrders.cancelAny'
  | 'sales.view'
  | 'sales.return'
  | 'sales.vatExemption'
  | 'cash.operate'
  | 'cash.manageRegisters'
  | 'catalog.view'
  | 'catalog.create'
  | 'catalog.manage'
  | 'stock.view'
  | 'stock.adjust'
  | 'stock.transfer'
  | 'stock.cancelTransfer'
  | 'stock.replenishment'
  | 'purchases.view'
  | 'purchases.manage'
  | 'purchases.approve'
  | 'purchases.receive'
  | 'payables.manage'
  | 'contacts.view'
  | 'contacts.create'
  | 'contacts.manage'
  | 'marketing.view'
  | 'marketing.manage'
  | 'marketing.export'
  | 'fiscal.view'
  | 'fiscal.issue'
  | 'fiscal.configure'
  | 'admin.branches'
  | 'admin.employees'
  | 'platform.manage'
  | 'admin.audit';

const ADMINS: TenantRole[] = ['OWNER', 'ADMIN'];
const MANAGEMENT: TenantRole[] = [...ADMINS, 'MANAGER'];
const READERS: TenantRole[] = ['ACCOUNTANT', 'VIEWER'];

const MATRIX: Record<Capability, readonly TenantRole[]> = {
  'dashboard.view': [...MANAGEMENT, ...READERS],
  'reports.view': [...MANAGEMENT, ...READERS],
  // Punto de venta: el vendedor lo usa para armar pedidos; cobrar (POST /sales) es solo de caja y gerencia.
  'pos.sell': [...MANAGEMENT, 'CASHIER', 'SELLER'],
  'pos.charge': [...MANAGEMENT, 'CASHIER'],
  'salesOrders.create': [...MANAGEMENT, 'CASHIER', 'SELLER'],
  'salesQuotes.create': [...MANAGEMENT, 'CASHIER', 'SELLER'],
  'salesOrders.view': [...MANAGEMENT, 'CASHIER', 'SELLER', ...READERS],
  'salesOrders.cancelAny': [...MANAGEMENT, 'CASHIER'],
  'sales.view': [...MANAGEMENT, 'CASHIER', 'SELLER', ...READERS],
  'sales.return': [...MANAGEMENT, 'CASHIER'],
  'sales.vatExemption': ADMINS,
  'cash.operate': [...MANAGEMENT, 'CASHIER'],
  'cash.manageRegisters': MANAGEMENT,
  'catalog.view': [...MANAGEMENT, 'CASHIER', 'SELLER', 'INVENTORY', ...READERS],
  'catalog.create': [...MANAGEMENT, 'INVENTORY'],
  'catalog.manage': MANAGEMENT,
  'stock.view': [...MANAGEMENT, 'INVENTORY', ...READERS],
  'stock.adjust': [...MANAGEMENT, 'INVENTORY'],
  'stock.transfer': [...MANAGEMENT, 'INVENTORY'],
  'stock.cancelTransfer': MANAGEMENT,
  'stock.replenishment': [...MANAGEMENT, ...READERS],
  'purchases.view': [...MANAGEMENT, 'INVENTORY', ...READERS],
  'purchases.manage': [...MANAGEMENT, 'INVENTORY'],
  'purchases.approve': MANAGEMENT,
  'purchases.receive': [...MANAGEMENT, 'INVENTORY'],
  'payables.manage': MANAGEMENT,
  'contacts.view': [...MANAGEMENT, 'CASHIER', 'SELLER', 'INVENTORY', ...READERS],
  'contacts.create': [...MANAGEMENT, 'CASHIER', 'SELLER'],
  'contacts.manage': MANAGEMENT,
  'marketing.view': [...MANAGEMENT, ...READERS],
  'marketing.manage': MANAGEMENT,
  'marketing.export': ADMINS,
  'fiscal.view': [...MANAGEMENT, 'CASHIER', 'SELLER', ...READERS],
  'fiscal.issue': [...MANAGEMENT, 'CASHIER'],
  'fiscal.configure': ADMINS,
  'admin.branches': ADMINS,
  'admin.employees': ADMINS,
  // Lo habilita la sesión solo para operadores de la plataforma (rol global SUPER_ADMIN), no un rol de empresa.
  'platform.manage': [],
  'admin.audit': ADMINS,
};

type RoleInput = TenantRole | readonly TenantRole[] | null | undefined;

function toRoles(input: RoleInput): readonly TenantRole[] {
  if (!input) return [];
  return typeof input === 'string' ? [input] : input;
}

/** Un usuario puede tener varios roles: alcanza con que uno de ellos tenga la capacidad (igual que el backend). */
export function can(roles: RoleInput, capability: Capability): boolean {
  const allowed = MATRIX[capability];
  return toRoles(roles).some((role) => allowed.includes(role));
}

/** true si todos los roles del usuario trabajan dentro de una sucursal (cajero, vendedor, depósito). */
export function isBranchScoped(roles: RoleInput): boolean {
  const list = toRoles(roles);
  return list.length > 0 && list.every((role) => BRANCH_SCOPED_ROLES.includes(role));
}

/** Roles que operan siempre dentro de su sucursal asignada (el backend lo exige). */
export const BRANCH_SCOPED_ROLES: readonly TenantRole[] = ['CASHIER', 'SELLER', 'INVENTORY'];

/** Pantalla inicial según el trabajo de cada rol. */
export function homeFor(role: RoleInput): string {
  if (can(role, 'dashboard.view')) return '/tablero';
  if (can(role, 'pos.sell')) return '/ventas/pos';
  if (can(role, 'stock.view')) return '/stock';
  return '/catalogo';
}
