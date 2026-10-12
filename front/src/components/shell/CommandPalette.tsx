'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/lib/auth/session';
import { NAV } from './nav';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Búsqueda rápida de pantallas (Ctrl+K / Cmd+K). */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { can } = useSession();
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const all = NAV.flatMap((section) => section.items.filter((item) => can(item.capability)).map((item) => ({ ...item, section: section.label })));
    const needle = normalize(term.trim());
    if (!needle) return all;
    return all.filter((item) => normalize(`${item.label} ${item.section} ${item.keywords ?? ''}`).includes(needle));
  }, [term, can]);

  useEffect(() => {
    if (open) {
      setTerm('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="command-panel" role="dialog" aria-modal="true" aria-label="Ir a una pantalla">
        <input
          ref={inputRef}
          value={term}
          placeholder="Buscar pantalla: ventas, stock, factura, precios…"
          onChange={(event) => {
            setTerm(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((value) => Math.min(items.length - 1, value + 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((value) => Math.max(0, value - 1));
            }
            if (event.key === 'Enter' && items[active]) go(items[active].href);
          }}
        />
        <div className="command-list">
          {items.length === 0 && <div className="text-muted-2 small p-3">Sin resultados.</div>}
          {items.map((item, index) => (
            <button
              key={item.href}
              type="button"
              className={`command-item ${index === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(item.href)}
            >
              <i className={`bi ${item.icon}`} aria-hidden="true" />
              <span>{item.label}</span>
              <small>{item.section}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
