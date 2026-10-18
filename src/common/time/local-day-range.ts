import { EntityManager } from 'typeorm';
import { timeZoneOffset } from '../../modules/reports/domain/period';

/** Zona horaria por defecto de las empresas (Argentina no tiene horario de verano: UTC−03:00). */
export const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Medianoche local de una fecha (AAAA-MM-DD) expresada en UTC. */
function localMidnightUtc(date: string, timeZone: string): Date {
  // El desfase se toma a mediodía de ese día para no caer en el cambio de hora (en zonas que lo tienen).
  const offset = timeZoneOffset(timeZone, new Date(`${date}T12:00:00Z`));
  return new Date(`${date}T00:00:00${offset}`);
}

/**
 * Límites en UTC de un rango de días locales: [desde 00:00, hasta+1 00:00).
 * La base guarda en UTC; filtrar con fechas sin zona cortaba el día a las 21:00 de Argentina.
 */
export function localDayRange(timeZone: string, from?: string | null, to?: string | null): { start: Date | null; end: Date | null } {
  const fromDate = from?.slice(0, 10);
  const toDate = to?.slice(0, 10);
  return {
    start: fromDate && DATE_RE.test(fromDate) ? localMidnightUtc(fromDate, timeZone) : null,
    end: toDate && DATE_RE.test(toDate) ? localMidnightUtc(addDays(toDate, 1), timeZone) : null,
  };
}

/** Zona horaria configurada en la empresa. */
export async function tenantTimeZone(manager: EntityManager, tenantId: string): Promise<string> {
  const rows = (await manager.query('SELECT time_zone AS timeZone FROM tenants WHERE id = ? LIMIT 1', [tenantId])) as Array<{ timeZone: string | null }>;
  const zone = rows[0]?.timeZone;
  if (!zone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
