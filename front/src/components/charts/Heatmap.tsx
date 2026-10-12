import type { SalesByHourReport } from '@/lib/api/types';
import { int, money } from '@/lib/format';

/** DAYOFWEEK de MySQL: 1 = domingo … 7 = sábado. Se muestra de lunes a domingo. */
const DAYS: Array<{ weekday: number; label: string }> = [
  { weekday: 2, label: 'Lun' },
  { weekday: 3, label: 'Mar' },
  { weekday: 4, label: 'Mié' },
  { weekday: 5, label: 'Jue' },
  { weekday: 6, label: 'Vie' },
  { weekday: 7, label: 'Sáb' },
  { weekday: 1, label: 'Dom' },
];

export function Heatmap({ cells }: { cells: SalesByHourReport['cells'] }) {
  const byKey = new Map(cells.map((cell) => [`${cell.weekday}-${cell.hour}`, cell]));
  const max = Math.max(1, ...cells.map((cell) => cell.tickets));
  return (
    <div className="heatmap" role="table" aria-label="Tickets por día y hora">
      <div />
      {Array.from({ length: 24 }, (_, hour) => (
        <div key={hour} className="text-center mono">
          {hour % 3 === 0 ? hour : ''}
        </div>
      ))}
      {DAYS.map((day) => (
        <div key={day.weekday} style={{ display: 'contents' }} role="row">
          <div className="d-flex align-items-center">{day.label}</div>
          {Array.from({ length: 24 }, (_, hour) => {
            const cell = byKey.get(`${day.weekday}-${hour}`);
            const intensity = cell ? cell.tickets / max : 0;
            return (
              <div
                key={hour}
                className="hm-cell"
                role="cell"
                title={cell ? `${day.label} ${hour}:00 · ${int(cell.tickets)} tickets · ${money(cell.grossSales)}` : `${day.label} ${hour}:00 · sin ventas`}
                style={intensity > 0 ? { background: `rgba(28, 79, 140, ${0.12 + intensity * 0.88})` } : undefined}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
