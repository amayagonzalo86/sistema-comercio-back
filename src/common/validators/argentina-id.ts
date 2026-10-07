/**
 * Validaciones de identificación fiscal y personal de Argentina.
 * Funciones puras (sin dependencias) para poder usarlas en DTOs, servicios y pruebas.
 */

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Prefijos asignados por ARCA: personas humanas (20, 23, 24, 25, 26, 27) y jurídicas (30, 33, 34). */
const CUIT_PREFIXES = new Set(['20', '23', '24', '25', '26', '27', '30', '33', '34']);

/** Quita guiones, puntos y espacios. Devuelve solo dígitos. */
export function normalizeTaxId(value: string): string {
  return value.replace(/[\s.-]/g, '');
}

/** Calcula el dígito verificador de los primeros 10 dígitos de una CUIT/CUIL (módulo 11). */
export function cuitCheckDigit(firstTenDigits: string): number | null {
  if (!/^\d{10}$/.test(firstTenDigits)) {
    return null;
  }
  const sum = CUIT_WEIGHTS.reduce(
    (total, weight, index) => total + weight * Number(firstTenDigits[index]),
    0,
  );
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return 0;
  if (remainder === 10) return null; // ARCA nunca asigna esta combinación: se usa prefijo 23/33.
  return remainder;
}

/** true si la CUIT/CUIL tiene formato, prefijo y dígito verificador válidos. */
export function isValidCuit(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const digits = normalizeTaxId(value);
  if (!/^\d{11}$/.test(digits) || !CUIT_PREFIXES.has(digits.slice(0, 2))) {
    return false;
  }
  const expected = cuitCheckDigit(digits.slice(0, 10));
  return expected !== null && expected === Number(digits[10]);
}

/** DNI argentino: 7 u 8 dígitos (se aceptan puntos). */
export function isValidDni(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const digits = normalizeTaxId(value);
  return /^\d{7,8}$/.test(digits) && Number(digits) > 0;
}

/** Formatea 20123456786 como 20-12345678-6. */
export function formatCuit(value: string): string {
  const digits = normalizeTaxId(value);
  if (digits.length !== 11) {
    return value;
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}
