/** Mini tendencia para las tarjetas de indicadores. */
export function Sparkline({ values, width = 88, height = 28, color = '#1c4f8c' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const path = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${(height - 2 - ((value - min) / range) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
