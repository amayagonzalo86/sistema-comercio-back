import type { ReactNode } from 'react';

interface SurfaceProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** false = el contenido ocupa todo el ancho (tablas). */
  padded?: boolean;
}

export function Surface({ title, subtitle, actions, children, className = '', bodyClassName = '', padded = true }: SurfaceProps) {
  return (
    <section className={`surface ${className}`}>
      {(title || actions) && (
        <div className="surface-header">
          <div>
            {typeof title === 'string' ? <h2>{title}</h2> : title}
            {subtitle && <div className="cell-sub text-muted-2 small mt-1">{subtitle}</div>}
          </div>
          {actions && <div className="d-flex gap-2 align-items-center">{actions}</div>}
        </div>
      )}
      <div className={`${padded ? 'surface-body' : ''} ${bodyClassName}`}>{children}</div>
    </section>
  );
}
