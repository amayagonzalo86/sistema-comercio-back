import type { ReactNode } from 'react';

export function Spinner({ label = 'Cargando…', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`d-flex align-items-center gap-2 text-muted-2 small ${className}`} role="status">
      <span className="spinner-border spinner-border-sm" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonRows({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row}>
          {Array.from({ length: columns }, (_, col) => (
            <td key={col}>
              <div className="skeleton" style={{ height: 14, width: col === 0 ? '70%' : '50%' }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function EmptyState({ icon = 'bi-inbox', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <i className={`bi ${icon}`} aria-hidden="true" />
      <h3>{title}</h3>
      {children && <div className="small">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorAlert({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-danger d-flex align-items-center gap-2 py-2 small mb-3" role="alert">
      <i className="bi bi-exclamation-octagon" aria-hidden="true" />
      <span className="flex-grow-1">{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-outline-danger" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tbody>
      <tr>
        <td colSpan={colSpan} className="p-0">
          {children}
        </td>
      </tr>
    </tbody>
  );
}
