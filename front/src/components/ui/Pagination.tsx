import { int } from '@/lib/format';

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
}

export function Pagination({ page, pages, total, limit, onPage }: PaginationProps) {
  if (total === 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="d-flex align-items-center justify-content-between px-3 py-2 border-top small text-muted-2 no-print">
      <span>
        <span className="mono">{int(from)}</span>–<span className="mono">{int(to)}</span> de <span className="mono">{int(total)}</span>
      </span>
      <div className="btn-group btn-group-sm">
        <button type="button" className="btn btn-outline-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <i className="bi bi-chevron-left" />
        </button>
        <span className="btn btn-outline-secondary disabled mono">
          {page} / {pages}
        </span>
        <button type="button" className="btn btn-outline-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Página siguiente">
          <i className="bi bi-chevron-right" />
        </button>
      </div>
    </div>
  );
}
