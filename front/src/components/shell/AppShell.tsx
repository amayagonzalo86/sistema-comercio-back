'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/auth/session';
import { useHotkey } from '@/lib/hooks/useHotkey';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const { status, can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') {
      const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/login${next}`);
    }
  }, [status, router, pathname]);

  useHotkey('mod+k', () => setPaletteOpen(true), status === 'authenticated');
  useHotkey('F2', () => router.push('/ventas/pos'), status === 'authenticated' && can('pos.sell') && pathname !== '/ventas/pos');

  if (status !== 'authenticated') {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
        <div className="text-center text-muted-2 small">
          <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
          Verificando sesión segura…
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="d-lg-none position-fixed top-0 start-0 w-100 h-100" style={{ zIndex: 1035 }} onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <div className="app-main">
        <Topbar onMenu={() => setMenuOpen(true)} onSearch={() => setPaletteOpen(true)} />
        <main className="app-content">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
