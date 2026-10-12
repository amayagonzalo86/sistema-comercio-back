'use client';

import { useState } from 'react';
import type { LocalDate } from '@/lib/api/types';
import { firstDayOfMonth, todayLocal } from '@/lib/format';

export interface Period {
  from: LocalDate;
  to: LocalDate;
}

type Preset = 'today' | '7d' | '30d' | 'month' | 'custom';

const PRESETS: Array<{ id: Exclude<Preset, 'custom'>; label: string }> = [
  { id: 'today', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'month', label: 'Este mes' },
];

export function periodFor(preset: Exclude<Preset, 'custom'>): Period {
  const to = todayLocal();
  if (preset === 'today') return { from: to, to };
  if (preset === '7d') return { from: todayLocal(-6), to };
  if (preset === 'month') return { from: firstDayOfMonth(), to };
  return { from: todayLocal(-29), to };
}

/** Selector de período con atajos habituales del comercio y rango libre. */
export function PeriodPicker({ value, onChange, initialPreset = '30d' }: { value: Period; onChange: (period: Period) => void; initialPreset?: Preset }) {
  const [preset, setPreset] = useState<Preset>(initialPreset);
  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      <div className="segmented" role="group" aria-label="Período">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={preset === item.id ? 'active' : ''}
            onClick={() => {
              setPreset(item.id);
              onChange(periodFor(item.id));
            }}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className={preset === 'custom' ? 'active' : ''} onClick={() => setPreset('custom')}>
          Rango
        </button>
      </div>
      {preset === 'custom' && (
        <div className="d-flex align-items-center gap-1">
          <input
            type="date"
            className="form-control form-control-sm"
            value={value.from}
            max={value.to}
            onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value })}
            aria-label="Desde"
          />
          <span className="text-muted-2 small">a</span>
          <input
            type="date"
            className="form-control form-control-sm"
            value={value.to}
            min={value.from}
            max={todayLocal()}
            onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })}
            aria-label="Hasta"
          />
        </div>
      )}
    </div>
  );
}
