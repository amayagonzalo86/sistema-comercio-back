'use client';

import { useMemo, useRef, useState } from 'react';

export interface AreaPoint {
  label: string;
  value: number;
  /** Serie secundaria opcional (por ejemplo, devoluciones), dibujada como línea punteada. */
  secondary?: number;
}

interface AreaChartProps {
  points: AreaPoint[];
  height?: number;
  formatValue: (value: number) => string;
  formatAxis?: (value: number) => string;
  formatLabel?: (label: string) => string;
  valueName?: string;
  secondaryName?: string;
}

const PADDING = { top: 16, right: 12, bottom: 26, left: 56 };

/** Gráfico de área sin dependencias (SVG): liviano para VPS chicos y sin bloquear la carga. */
export function AreaChart({ points, height = 240, formatValue, formatAxis = formatValue, formatLabel = (label) => label, valueName = 'Valor', secondaryName }: AreaChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;

  const geometry = useMemo(() => {
    const max = Math.max(1, ...points.map((point) => Math.max(point.value, point.secondary ?? 0)));
    const niceMax = niceCeiling(max);
    const innerWidth = width - PADDING.left - PADDING.right;
    const innerHeight = height - PADDING.top - PADDING.bottom;
    const step = points.length > 1 ? innerWidth / (points.length - 1) : innerWidth;
    const x = (index: number) => PADDING.left + (points.length > 1 ? index * step : innerWidth / 2);
    const y = (value: number) => PADDING.top + innerHeight - (value / niceMax) * innerHeight;
    const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
    const area = points.length
      ? `${line} L${x(points.length - 1).toFixed(1)},${(PADDING.top + innerHeight).toFixed(1)} L${x(0).toFixed(1)},${(PADDING.top + innerHeight).toFixed(1)} Z`
      : '';
    const secondary = points.some((point) => point.secondary !== undefined)
      ? points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.secondary ?? 0).toFixed(1)}`).join(' ')
      : null;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ value: niceMax * ratio, y: y(niceMax * ratio) }));
    const labelEvery = Math.max(1, Math.ceil(points.length / 8));
    return { x, y, line, area, secondary, ticks, labelEvery, innerHeight, step };
  }, [points, height]);

  if (points.length === 0) {
    return <div className="text-muted-2 small py-5 text-center">Sin datos para el período.</div>;
  }

  const hovered = hover !== null ? points[hover] : undefined;

  return (
    <div ref={wrapperRef} className="position-relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={`Gráfico de ${valueName}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relative = ((event.clientX - rect.left) / rect.width) * width;
          const index = Math.round((relative - PADDING.left) / (geometry.step || 1));
          setHover(Math.min(points.length - 1, Math.max(0, index)));
        }}
      >
        <defs>
          <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#74acdf" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#74acdf" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {geometry.ticks.map((tick) => (
          <g key={tick.value}>
            <line x1={PADDING.left} x2={width - PADDING.right} y1={tick.y} y2={tick.y} stroke="#e7ecf2" strokeDasharray={tick.value === 0 ? undefined : '3 4'} />
            <text x={PADDING.left - 8} y={tick.y + 4} textAnchor="end" fontSize="10" fill="#8593a7" fontFamily="var(--font-mono)">
              {formatAxis(tick.value)}
            </text>
          </g>
        ))}
        <path d={geometry.area} fill="url(#area-fill)" />
        <path d={geometry.line} fill="none" stroke="#1c4f8c" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {geometry.secondary && <path d={geometry.secondary} fill="none" stroke="#c0392b" strokeWidth="1.5" strokeDasharray="4 4" />}
        {points.map((point, index) =>
          index % geometry.labelEvery === 0 || (index === points.length - 1 && index % geometry.labelEvery >= geometry.labelEvery / 2) ? (
            <text key={point.label} x={geometry.x(index)} y={height - 8} textAnchor="middle" fontSize="10" fill="#8593a7">
              {formatLabel(point.label)}
            </text>
          ) : null,
        )}
        {hover !== null && hovered && (
          <g>
            <line x1={geometry.x(hover)} x2={geometry.x(hover)} y1={PADDING.top} y2={PADDING.top + geometry.innerHeight} stroke="#b7c1cf" />
            <circle cx={geometry.x(hover)} cy={geometry.y(hovered.value)} r="4.5" fill="#fff" stroke="#1c4f8c" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover !== null && hovered && (
        <div className="chart-tooltip" style={{ left: `${(geometry.x(hover) / width) * 100}%`, top: `${(geometry.y(hovered.value) / height) * 100}%` }}>
          <div className="text-white-50">{formatLabel(hovered.label)}</div>
          <div>
            {valueName}: <span className="mono">{formatValue(hovered.value)}</span>
          </div>
          {secondaryName && hovered.secondary !== undefined && (
            <div>
              {secondaryName}: <span className="mono">{formatValue(hovered.secondary)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function niceCeiling(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}
