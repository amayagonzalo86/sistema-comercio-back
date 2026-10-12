'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Evita cerrar con Escape o clic afuera mientras se guarda. */
  busy?: boolean;
}

export function Modal({ open, title, subtitle, onClose, children, footer, size = 'md', busy = false }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Foco y teclado solo al abrir/cerrar: no se re-ejecuta en cada render del contenido.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const focusable = panelRef.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), select, textarea');
    focusable?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="erp-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div ref={panelRef} className={`erp-modal size-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="erp-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="btn-close" aria-label="Cerrar" onClick={onClose} disabled={busy} data-close />
        </div>
        <div className="erp-modal-body">{children}</div>
        {footer && <div className="erp-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
