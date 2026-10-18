import { localDayRange } from './local-day-range';

describe('localDayRange', () => {
  it('convierte días de Argentina a UTC (el día termina a las 03:00 UTC del siguiente)', () => {
    const range = localDayRange('America/Argentina/Buenos_Aires', '2026-10-17', '2026-10-17');
    expect(range.start?.toISOString()).toBe('2026-10-17T03:00:00.000Z');
    expect(range.end?.toISOString()).toBe('2026-10-18T03:00:00.000Z');
  });

  it('incluye un cierre de las 23:45 del mismo día local', () => {
    const range = localDayRange('America/Argentina/Buenos_Aires', null, '2026-10-17');
    const closedAt = new Date('2026-10-18T02:45:00.000Z'); // 23:45 en Argentina
    expect(range.start).toBeNull();
    expect(closedAt.getTime()).toBeLessThan(range.end!.getTime());
  });

  it('ignora fechas inválidas', () => {
    expect(localDayRange('America/Argentina/Buenos_Aires', 'ayer', undefined)).toEqual({ start: null, end: null });
  });
});
