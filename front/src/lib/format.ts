import type { DocumentType, LocalDate, SalePaymentMethod, TaxCondition, TenantRole, VatExemptionReason } from './api/types';

/** Zona horaria comercial: todas las fechas de negocio se muestran en hora de Argentina. */
export const AR_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const currency = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactCurrency = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const quantity = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
const percent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

export function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** $ 1.234,56 */
export function money(value: number | string | null | undefined): string {
  return currency.format(toNumber(value));
}

/** $ 1,2 M — para tarjetas y ejes de gráficos. */
export function moneyCompact(value: number | string | null | undefined): string {
  return compactCurrency.format(toNumber(value));
}

export function int(value: number | string | null | undefined): string {
  return integer.format(toNumber(value));
}

export function qty(value: number | string | null | undefined): string {
  return quantity.format(toNumber(value));
}

/** 12,5 % */
export function pct(value: number | string | null | undefined): string {
  return `${percent.format(toNumber(value))} %`;
}

/** +12,5 % / −3 % con signo explícito; null si no hay base de comparación. */
export function growth(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${percent.format(Math.abs(value))} %`;
}

/** Decimal con dos posiciones para la API ("1234.50"), sin errores de coma flotante. */
export function toDecimalString(value: number | string): string {
  const numeric = typeof value === 'number' ? value : parseLocaleNumber(value);
  return (Math.round(numeric * 100) / 100).toFixed(2);
}

/** Acepta "1.234,56", "1234,56" o "1234.56". Devuelve NaN si no es un número. */
export function parseLocaleNumber(input: string): number {
  const text = input.trim().replace(/\s|\$/g, '');
  if (!text) return Number.NaN;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

function dateFromApi(value: string | Date): Date {
  if (value instanceof Date) return value;
  // AAAA-MM-DD es una fecha local: se ancla al mediodía para que la zona horaria no la mueva de día.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00-03:00`) : new Date(value);
}

/** 10/10/2026 */
export function date(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-AR', { timeZone: AR_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(dateFromApi(value));
}

/** 10/10/2026 18:42 */
export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: AR_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dateFromApi(value));
}

/** 18:42 */
export function time(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-AR', { timeZone: AR_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(dateFromApi(value));
}

/** sábado, 10 de octubre */
export function longDate(value: string | Date = new Date()): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: AR_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(dateFromApi(value));
}

/** 12 oct */
export function shortDay(value: LocalDate): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: AR_TIME_ZONE, day: 'numeric', month: 'short' }).format(dateFromApi(value)).replace('.', '');
}

/** Fecha de hoy en Argentina como AAAA-MM-DD. */
export function todayLocal(offsetDays = 0): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: AR_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86_400_000));
  return parts;
}

export function firstDayOfMonth(): LocalDate {
  return `${todayLocal().slice(0, 7)}-01`;
}

/** 30-71234567-1 */
export function cuit(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` : value;
}

/** Valida CUIT/CUIL con dígito verificador (módulo 11). */
export function isValidCuit(value: string | null | undefined): boolean {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, weight, index) => acc + weight * Number(digits[index]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(digits[10]);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function personName(person: { firstName: string; lastName: string } | null | undefined): string {
  if (!person) return 'Consumidor final';
  return `${person.firstName} ${person.lastName}`.trim();
}

export const ROLE_LABEL: Record<TenantRole, string> = {
  OWNER: 'Titular',
  ADMIN: 'Administración',
  MANAGER: 'Encargado de sucursal',
  ACCOUNTANT: 'Contaduría',
  CASHIER: 'Cajero',
  INVENTORY: 'Depósito',
  SELLER: 'Vendedor',
  VIEWER: 'Consulta',
};

export const PAYMENT_LABEL: Record<SalePaymentMethod, string> = {
  CASH: 'Efectivo',
  DEBIT_CARD: 'Débito',
  CREDIT_CARD: 'Crédito',
  BANK_TRANSFER: 'Transferencia',
  QR: 'QR / Billetera',
  OTHER: 'Otro',
};

/** Etiquetas cortas para los botones del cobro. */
export const PAYMENT_SHORT: Record<SalePaymentMethod, string> = {
  CASH: 'Efectivo',
  DEBIT_CARD: 'Débito',
  CREDIT_CARD: 'Crédito',
  BANK_TRANSFER: 'Transfer.',
  QR: 'QR',
  OTHER: 'Otro',
};

export const PAYMENT_ICON: Record<SalePaymentMethod, string> = {
  CASH: 'bi-cash-stack',
  DEBIT_CARD: 'bi-credit-card-2-front',
  CREDIT_CARD: 'bi-credit-card',
  BANK_TRANSFER: 'bi-bank',
  QR: 'bi-qr-code',
  OTHER: 'bi-three-dots',
};

export const TAX_CONDITION_LABEL: Record<TaxCondition, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTO: 'Monotributo',
  EXENTO: 'IVA Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_RESPONSABLE: 'No Responsable',
  SUJETO_NO_CATEGORIZADO: 'Sujeto No Categorizado',
  CLIENTE_DEL_EXTERIOR: 'Cliente del Exterior',
};

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  94: 'Pasaporte',
  99: 'Sin identificar',
};

export const VAT_EXEMPTION_LABEL: Record<VatExemptionReason, string> = {
  EXPORT: 'Exportación',
  TIERRA_DEL_FUEGO: 'Tierra del Fuego (Ley 19.640)',
  DIPLOMATIC: 'Franquicia diplomática',
  OTHER_LEGAL: 'Otra causa legal',
};

/** Código de comprobante ARCA → nombre. */
export const VOUCHER_TYPE_LABEL: Record<number, string> = {
  1: 'Factura A',
  3: 'Nota de crédito A',
  6: 'Factura B',
  8: 'Nota de crédito B',
  11: 'Factura C',
  13: 'Nota de crédito C',
  19: 'Factura E',
  21: 'Nota de crédito E',
};

/** Alícuota ARCA → porcentaje. */
export const ARCA_VAT_RATE: Record<number, string> = { 3: '0 %', 4: '10,5 %', 5: '21 %', 6: '27 %', 8: '5 %', 9: '2,5 %' };
