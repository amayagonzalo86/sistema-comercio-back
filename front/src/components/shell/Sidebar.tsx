'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/auth/session';
import { BrandMark } from './BrandMark';
import { NAV, type NavItem } from './nav';

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Comercio ERP';

/** Ruta activa: coincidencia exacta o la sección más específica (evita marcar /ventas al estar en /ventas/pos). */
export function isActive(pathname: string, item: NavItem, all: NavItem[]): boolean {
  if (pathname === item.href) return true;
  if (!pathname.startsWith(`${item.href}/`)) return false;
  return !all.some((other) => other.href !== item.href && other.href.startsWith(item.href) && (pathname === other.href || pathname.startsWith(`${other.href}/`)));
}

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  const { can, tenant } = useSession();
  const allItems = NAV.flatMap((section) => section.items);

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Navegación principal">
      <div className="sidebar-brand">
        <BrandMark />
        <div className="min-w-0">
          <div className="brand-name">{APP_NAME}</div>
          <div className="brand-tenant" title={tenant?.legalName}>
            {tenant ? tenant.tradeName || tenant.legalName : 'Gestión comercial'}
          </div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {NAV.map((section) => {
          const items = section.items.filter((item) => can(item.capability));
          if (items.length === 0) return null;
          return (
            <div key={section.label}>
              <div className="nav-section-label">{section.label}</div>
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item-link ${isActive(pathname, item, allItems) ? 'active' : ''}`}
                  onClick={onNavigate}
                >
                  <i className={`bi ${item.icon}`} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.kbd && <span className="nav-kbd">{item.kbd}</span>}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="d-flex align-items-center gap-2">
          <i className="bi bi-shield-lock" aria-hidden="true" />
          <span>Sesión cifrada · Ley 25.326</span>
        </div>
      </div>
    </aside>
  );
}
