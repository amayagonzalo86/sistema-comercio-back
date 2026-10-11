import type { ReactNode } from 'react';

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  display: string;
  hint?: ReactNode;
}

/** Ranking horizontal (sucursales, categorías, medios de pago). */
export function BarList({ items, emptyText = 'Sin datos para el período.' }: { items: BarItem[]; emptyText?: string }) {
  if (items.length === 0) return <div className="text-muted-2 small py-3">{emptyText}</div>;
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div>
      {items.map((item) => (
        <div key={item.key} className="bar-list-row">
          <div className="text-truncate">
            <span className="text-ink fw-medium">{item.label}</span>
            {item.hint && <span className="text-muted-2 ms-2 small">{item.hint}</span>}
          </div>
          <div className="mono text-ink">{item.display}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
