/**
 * Búsqueda de personas (clientes y proveedores) por apellido y nombre, DNI, CUIT/CUIL o n.º de cuenta.
 *
 * - Texto: cada palabra tiene que estar en el nombre o en el apellido, en cualquier orden
 *   ("gomez maria", "María Gómez" y "gom mar" encuentran a Gómez, María). La intercalación de MySQL
 *   ignora mayúsculas y acentos.
 * - Números (con o sin puntos, guiones o espacios): el documento que contiene esos dígitos. Así un DNI
 *   encuentra también al cliente cargado con CUIT/CUIL (el DNI está dentro: 20-28412337-5).
 *   Desde 3 dígitos; con hasta 9 dígitos también busca el número de cuenta exacto.
 * - Mixto ("perez 28412"): las palabras por nombre y los dígitos por documento, ambos a la vez.
 */

export interface PersonSearchColumns {
  firstName: string;
  lastName: string;
  nationalId: string;
  accountNumber?: string;
  /** Columnas extra donde buscar el texto completo (email, teléfono, razón social…). */
  extra?: string[];
}

const MAX_WORDS = 5;

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export interface ParsedPersonSearch {
  words: string[];
  digits: string;
}

export function parsePersonSearch(term: string): ParsedPersonSearch {
  const clean = term.trim().slice(0, 80);
  const parts = clean.split(/[\s,;]+/).filter(Boolean);
  const words: string[] = [];
  let digits = '';
  for (const part of parts) {
    const numeric = part.replace(/[.\-/]/g, '');
    if (/^\d+$/.test(numeric)) digits += numeric;
    else if (words.length < MAX_WORDS) words.push(part);
  }
  return { words, digits };
}

/**
 * Condición SQL (entre paréntesis) para la búsqueda. `bind` recibe cada valor y devuelve su marcador:
 * '?' para consultas crudas o ':nombre' para TypeORM. Devuelve null si el término queda vacío.
 */
export function personSearchSql(columns: PersonSearchColumns, term: string, bind: (value: unknown) => string): string | null {
  const { words, digits } = parsePersonSearch(term);
  const nameMatch = words.length
    ? words.map((word) => {
        const pattern = bind(`%${escapeLike(word)}%`);
        return `(${columns.firstName} LIKE ${pattern} OR ${columns.lastName} LIKE ${pattern})`;
      })
    : [];
  const documentMatch: string[] = [];
  if (digits.length >= 3) documentMatch.push(`${columns.nationalId} LIKE ${bind(`%${digits}%`)}`);
  if (columns.accountNumber && /^\d{1,9}$/.test(digits)) documentMatch.push(`${columns.accountNumber} = ${bind(Number(digits))}`);

  const branches: string[] = [];
  if (nameMatch.length && documentMatch.length) {
    // "perez 28412": nombre y documento a la vez.
    branches.push(`(${nameMatch.join(' AND ')} AND (${documentMatch.join(' OR ')}))`);
  } else if (nameMatch.length) {
    branches.push(`(${nameMatch.join(' AND ')})`);
  } else if (documentMatch.length) {
    branches.push(...documentMatch);
  } else if (digits.length > 0) {
    // 1 o 2 dígitos: solo n.º de cuenta (si la tabla lo tiene).
    if (columns.accountNumber) branches.push(`${columns.accountNumber} = ${bind(Number(digits))}`);
  }
  const whole = term.trim().slice(0, 80);
  if (whole && columns.extra?.length) {
    const pattern = bind(`%${escapeLike(whole)}%`);
    for (const column of columns.extra) branches.push(`${column} LIKE ${pattern}`);
  }
  return branches.length ? `(${branches.join(' OR ')})` : null;
}

/** Ayudante para TypeORM: marcadores con nombre y objeto de parámetros. */
export function personSearchNamed(columns: PersonSearchColumns, term: string, prefix = 'personSearch') {
  const params: Record<string, unknown> = {};
  let index = 0;
  const sql = personSearchSql(columns, term, (value) => {
    const name = `${prefix}${index++}`;
    params[name] = value;
    return `:${name}`;
  });
  return { sql, params };
}

/** Ayudante para consultas crudas: marcadores '?' y lista de parámetros en orden. */
export function personSearchPositional(columns: PersonSearchColumns, term: string) {
  const params: unknown[] = [];
  const sql = personSearchSql(columns, term, (value) => {
    params.push(value);
    return '?';
  });
  return { sql, params };
}
