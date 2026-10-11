'use client';

import { useEffect, useRef, useState } from 'react';
import { fiscalApi } from '@/lib/api/endpoints';
import type { ArcaEnvironment } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { initials, longDate, ROLE_LABEL } from '@/lib/format';

export function Topbar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { user, branches, activeBranchId, setActiveBranchId, branchLocked, logout, can, tenant, tenants } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [environment, setEnvironment] = useState<ArcaEnvironment | null>(null);
  const [today, setToday] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const showAllBranches = can('dashboard.view') && !branchLocked;

  useEffect(() => {
    const text = longDate();
    setToday(text.charAt(0).toUpperCase() + text.slice(1));
  }, []);

  useEffect(() => {
    if (!can('dashboard.view')) return;
    fiscalApi
      .profile()
      .then((profile) => setEnvironment(profile?.environment ?? null))
      .catch(() => setEnvironment(null));
  }, [can]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  if (!user) return null;

  return (
    <header className="topbar no-print">
      <button type="button" className="btn btn-sm btn-light d-lg-none" onClick={onMenu} aria-label="Abrir menú">
        <i className="bi bi-list fs-5" />
      </button>

      <button type="button" className="topbar-search d-none d-md-flex" onClick={onSearch}>
        <i className="bi bi-search" aria-hidden="true" />
        <span>Ir a…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="ms-auto d-flex align-items-center gap-2 gap-md-3">
        <span className="text-muted-2 small d-none d-xl-inline">{today}</span>

        {environment && (
          <span className={`env-badge d-none d-sm-inline ${environment === 'PRODUCTION' ? 'prod' : 'homo'}`} title="Ambiente de factura electrónica ARCA">
            {environment === 'PRODUCTION' ? 'ARCA producción' : 'ARCA homologación'}
          </span>
        )}

        <label className="branch-pill mb-0">
          <i className="bi bi-shop text-primary" aria-hidden="true" />
          <span className="visually-hidden">Sucursal</span>
          <select
            className="form-select form-select-sm"
            value={activeBranchId ?? ''}
            disabled={branchLocked}
            onChange={(event) => setActiveBranchId(event.target.value || null)}
          >
            {showAllBranches && <option value="">Todas las sucursales</option>}
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>

        <div className="position-relative" ref={menuRef}>
          <button type="button" className="btn btn-link p-0 d-flex align-items-center gap-2 text-decoration-none" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>
            <span className="avatar">{initials(user.displayName)}</span>
            <span className="text-start d-none d-md-block lh-sm">
              <span className="d-block text-ink fw-semibold small">{user.displayName}</span>
              <span className="d-block text-muted-2" style={{ fontSize: '0.7rem' }}>
                {ROLE_LABEL[user.role]}
              </span>
            </span>
            <i className="bi bi-chevron-down small text-muted-2" aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="dropdown-menu dropdown-menu-end show shadow-sm" style={{ right: 0, left: 'auto', minWidth: 240 }}>
              <div className="px-3 py-2 small">
                <div className="text-muted-2">Empresa</div>
                <div className="fw-semibold text-ink">{tenant?.tradeName || tenant?.legalName || '—'}</div>
                <div className="text-muted-2 mt-1">
                  Usuario <span className="mono">{user.username}</span>
                </div>
              </div>
              {tenants.length > 1 && (
                <button type="button" className="dropdown-item small" onClick={() => void logout()}>
                  <i className="bi bi-building me-2" aria-hidden="true" />
                  Cambiar de empresa
                </button>
              )}
              <div className="dropdown-divider" />
              <button type="button" className="dropdown-item small text-danger" onClick={() => void logout()}>
                <i className="bi bi-box-arrow-right me-2" aria-hidden="true" />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
