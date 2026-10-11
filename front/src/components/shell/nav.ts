import type { Capability } from '@/lib/auth/permissions';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  capability: Capability;
  /** Atajo mostrado en la barra lateral. */
  kbd?: string;
  /** Palabras extra para la búsqueda rápida (Ctrl+K). */
  keywords?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    label: 'Dirección',
    items: [
      { href: '/tablero', label: 'Tablero', icon: 'bi-grid-1x2', capability: 'dashboard.view', keywords: 'inicio indicadores dueño kpi' },
      { href: '/reportes', label: 'Reportes', icon: 'bi-graph-up-arrow', capability: 'reports.view', keywords: 'ranking productos vendedores categorías valorización' },
    ],
  },
  {
    label: 'Ventas',
    items: [
      { href: '/ventas/pos', label: 'Punto de venta', icon: 'bi-upc-scan', capability: 'pos.sell', kbd: 'F2', keywords: 'caja cobrar ticket factura pos' },
      { href: '/ventas', label: 'Ventas', icon: 'bi-receipt', capability: 'sales.view', keywords: 'listado tickets devoluciones' },
      { href: '/caja', label: 'Caja', icon: 'bi-safe2', capability: 'cash.operate', keywords: 'apertura cierre arqueo efectivo' },
      { href: '/comprobantes', label: 'Comprobantes ARCA', icon: 'bi-file-earmark-text', capability: 'fiscal.view', keywords: 'factura electrónica cae nota de crédito afip' },
    ],
  },
  {
    label: 'Mercadería',
    items: [
      { href: '/catalogo', label: 'Catálogo y precios', icon: 'bi-tags', capability: 'catalog.view', keywords: 'productos artículos lista de precios iva' },
      { href: '/catalogo/aumentos', label: 'Actualizar precios', icon: 'bi-percent', capability: 'catalog.manage', keywords: 'aumento masivo inflación lista proveedor' },
      { href: '/stock', label: 'Stock por sucursal', icon: 'bi-boxes', capability: 'stock.view', keywords: 'inventario matriz existencias faltantes' },
      { href: '/stock/transferencias', label: 'Transferencias', icon: 'bi-truck', capability: 'stock.view', keywords: 'envíos entre sucursales remitos' },
      { href: '/stock/reposicion', label: 'Reposición sugerida', icon: 'bi-lightning-charge', capability: 'stock.replenishment', keywords: 'faltantes plan compras' },
    ],
  },
  {
    label: 'Compras',
    items: [
      { href: '/compras/pedidos', label: 'Pedidos a proveedores', icon: 'bi-clipboard-check', capability: 'purchases.view', keywords: 'orden de compra' },
      { href: '/compras/recepciones', label: 'Recepción de mercadería', icon: 'bi-box-arrow-in-down', capability: 'purchases.view', keywords: 'ingreso factura proveedor remito' },
      { href: '/compras/cuentas', label: 'Cuentas a pagar', icon: 'bi-wallet2', capability: 'payables.manage', keywords: 'deuda proveedores pagos vencimientos' },
    ],
  },
  {
    label: 'Clientes',
    items: [
      { href: '/contactos', label: 'Clientes y proveedores', icon: 'bi-people', capability: 'contacts.view', keywords: 'cuit personas agenda' },
      { href: '/marketing', label: 'Promociones', icon: 'bi-megaphone', capability: 'marketing.view', keywords: '3x2 descuentos ofertas' },
      { href: '/marketing/clientes', label: 'Fidelización', icon: 'bi-heart', capability: 'marketing.view', keywords: 'mejores clientes inactivos recuperar' },
    ],
  },
  {
    label: 'Empresa',
    items: [
      { href: '/configuracion/fiscal', label: 'Datos fiscales y ARCA', icon: 'bi-bank2', capability: 'fiscal.configure', keywords: 'cuit certificado punto de venta homologación' },
      { href: '/configuracion/sucursales', label: 'Sucursales', icon: 'bi-shop', capability: 'admin.branches', keywords: 'locales depósitos ip' },
      { href: '/configuracion/auditoria', label: 'Auditoría', icon: 'bi-shield-check', capability: 'admin.audit', keywords: 'trazabilidad registro quién cuándo' },
    ],
  },
];
