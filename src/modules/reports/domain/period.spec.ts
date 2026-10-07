import { buildPeriod, growthPercent, marginPercent, periodDays, previousPeriod, timeZoneOffset } from './period';

const TZ = 'America/Argentina/Buenos_Aires';

describe('report period', () => {
  it('calcula el desfase de Argentina', () => {
    expect(timeZoneOffset(TZ, new Date('2026-07-01T12:00:00Z'))).toBe('-03:00');
    expect(timeZoneOffset('UTC')).toBe('+00:00');
  });

  it('convierte el rango local a límites UTC', () => {
    const period = buildPeriod(TZ, '2026-10-01', '2026-10-31', new Date('2026-10-06T12:00:00Z'));
    expect(period.startUtc.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(period.endUtc.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(period.days).toBe(31);
  });

  it('por defecto usa los últimos 30 días', () => {
    const period = buildPeriod(TZ, undefined, undefined, new Date('2026-10-06T12:00:00Z'));
    expect(period.to).toBe('2026-10-06');
    expect(period.from).toBe('2026-09-07');
    expect(periodDays(period).length).toBe(30);
  });

  it('el período anterior tiene la misma duración y termina donde empieza el actual', () => {
    const period = buildPeriod(TZ, '2026-10-01', '2026-10-31', new Date('2026-10-06T12:00:00Z'));
    const previous = previousPeriod(period);
    expect(previous.from).toBe('2026-08-31');
    expect(previous.to).toBe('2026-09-30');
    expect(previous.endUtc.toISOString()).toBe(period.startUtc.toISOString());
  });

  it('valida fechas', () => {
    expect(() => buildPeriod(TZ, '2026-10-31', '2026-10-01')).toThrow(RangeError);
    expect(() => buildPeriod(TZ, '01/10/2026', '2026-10-31')).toThrow(RangeError);
    expect(() => buildPeriod(TZ, '2024-01-01', '2026-10-31')).toThrow(RangeError);
  });

  it('calcula variaciones y márgenes', () => {
    expect(growthPercent(120, 100)).toBe(20);
    expect(growthPercent(80, 100)).toBe(-20);
    expect(growthPercent(50, 0)).toBe(null);
    expect(marginPercent(1000, 700)).toBe(30);
    expect(marginPercent(0, 10)).toBe(null);
  });
});
