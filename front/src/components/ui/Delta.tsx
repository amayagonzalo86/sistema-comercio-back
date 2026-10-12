import { growth } from '@/lib/format';

/** Variación porcentual contra el período anterior, con color semántico. */
export function Delta({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  const text = growth(value ?? null);
  if (text === null) return <span className="delta flat">s/d</span>;
  const numeric = value ?? 0;
  const good = invert ? numeric < 0 : numeric > 0;
  const tone = numeric === 0 ? 'flat' : good ? 'up' : 'down';
  const icon = numeric > 0 ? 'bi-arrow-up-right' : numeric < 0 ? 'bi-arrow-down-right' : 'bi-dash';
  return (
    <span className={`delta ${tone}`}>
      <i className={`bi ${icon}`} aria-hidden="true" />
      {text}
    </span>
  );
}
