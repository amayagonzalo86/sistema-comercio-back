/**
 * Períodos de reporte en la zona horaria de la empresa.
 * La base guarda en UTC; los reportes agrupan por día/hora local (Argentina: UTC-03:00).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
export const MAX_REPORT_DAYS = 400;

export interface ReportPeriod {
  /** Fechas locales inclusive (AAAA-MM-DD). */
  from: string;
  to: string;
  /** Límites en UTC: [startUtc, endUtc). */
  startUtc: Date;
  endUtc: Date;
  days: number;
  /** Desfase de la zona horaria en formato ±HH:MM (para CONVERT_TZ en MySQL). */
  offset: string;
}

/** Desfase actual de una zona IANA, por ejemplo "America/Argentina/Buenos_Aires" -> "-03:00". */
export function timeZoneOffset(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((item) => item.type === 'timeZoneName')?.value;
  const match = /GMT([+-]\d{2}):?(\d{2})?/.exec(part ?? '');
  if (!match) return '+00:00';
  return `${match[1]}:${match[2] ?? '00'}`;
}

/** Fecha local de hoy en la zona indicada (AAAA-MM-DD). */
export function localToday(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Día de la semana local (0 = domingo ... 6 = sábado). */
export function localWeekday(timeZone: string, at: Date = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
  const index = WEEKDAYS.indexOf(name);
  return index < 0 ? at.getUTCDay() : index;
}

function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Arma el período. Por defecto, los últimos 30 días incluyendo hoy.
 * @throws RangeError con fechas inválidas, invertidas o rangos mayores a MAX_REPORT_DAYS.
 */
export function buildPeriod(timeZone: string, from?: string, to?: string, now: Date = new Date()): ReportPeriod {
  const end = (to ?? localToday(timeZone, now)).slice(0, 10);
  const start = (from ?? addDays(end, -29)).slice(0, 10);
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    throw new RangeError('Las fechas deben tener formato AAAA-MM-DD.');
  }
  if (start > end) {
    throw new RangeError('La fecha "desde" no puede ser posterior a "hasta".');
  }
  const days = Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;
  if (days > MAX_REPORT_DAYS) {
    throw new RangeError(`El rango máximo es de ${MAX_REPORT_DAYS} días.`);
  }
  const offset = timeZoneOffset(timeZone, now);
  return {
    from: start,
    to: end,
    startUtc: new Date(`${start}T00:00:00${offset}`),
    endUtc: new Date(`${addDays(end, 1)}T00:00:00${offset}`),
    days,
    offset,
  };
}

/** Período inmediatamente anterior de igual duración (para comparar crecimiento). */
export function previousPeriod(period: ReportPeriod): ReportPeriod {
  const to = addDays(period.from, -1);
  const from = addDays(to, -(period.days - 1));
  return {
    from,
    to,
    startUtc: new Date(`${from}T00:00:00${period.offset}`),
    endUtc: period.startUtc,
    days: period.days,
    offset: period.offset,
  };
}

/** Variación porcentual con 1 decimal; null si el período anterior fue cero. */
export function growthPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Margen bruto porcentual sobre ventas sin IVA, con 1 decimal. */
export function marginPercent(revenueNet: number, cost: number): number | null {
  if (revenueNet <= 0) return null;
  return Math.round(((revenueNet - cost) / revenueNet) * 1000) / 10;
}

/** Lista de días del período (para completar con ceros los días sin ventas). */
export function periodDays(period: ReportPeriod): string[] {
  return Array.from({ length: period.days }, (_, index) => addDays(period.from, index));
}
