import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Resolución de certificados y claves de ARCA a partir de referencias (nunca se guardan en la base):
 *  - "env:NOMBRE"  → variable de entorno con el PEM (o el PEM en base64).
 *  - "file:ruta"   → archivo dentro de FISCAL_SECRETS_DIR (no se permite salir de esa carpeta).
 */
export function resolveSecret(reference: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (!reference) {
    throw new Error('Falta configurar la referencia al certificado o a la clave privada.');
  }
  const [scheme, ...rest] = reference.split(':');
  const target = rest.join(':').trim();
  let value: string;
  if (scheme === 'env') {
    if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(target)) throw new Error('Nombre de variable de entorno inválido.');
    value = env[target] ?? '';
  } else if (scheme === 'file') {
    const baseDir = env.FISCAL_SECRETS_DIR;
    if (!baseDir) throw new Error('Para usar "file:" configurá FISCAL_SECRETS_DIR.');
    if (!/^[\w./-]{1,200}$/.test(target) || target.split(/[\\/]/).includes('..') || isAbsolute(target)) {
      throw new Error('La ruta del secreto debe ser relativa a FISCAL_SECRETS_DIR y no puede contener "..".');
    }
    const base = realpathSync(baseDir);
    let full: string;
    try {
      full = realpathSync(resolve(base, target));
    } catch {
      throw new Error(`No se encontró el archivo de secreto "${target}" en FISCAL_SECRETS_DIR.`);
    }
    const rel = relative(base, full);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('La ruta del secreto debe estar dentro de FISCAL_SECRETS_DIR.');
    value = readFileSync(full, 'utf8');
  } else {
    throw new Error('Referencia de secreto inválida: usá "env:NOMBRE" o "file:archivo.pem".');
  }
  value = value.trim();
  if (!value) throw new Error(`La referencia ${scheme}:${target} está vacía.`);
  if (!value.includes('-----BEGIN')) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) value = decoded;
  }
  return value;
}

export function isValidSecretReference(reference: unknown): boolean {
  return typeof reference === 'string' && /^(env:[A-Z][A-Z0-9_]{2,100}|file:[\w./-]{1,200})$/.test(reference) && !reference.includes('..');
}

/** Cifrado AES-256-GCM para guardar en la base el ticket de acceso de WSAA (token y sign). */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret || secret.length < 32) throw new Error('La clave de cifrado fiscal debe tener al menos 32 caracteres.');
    this.key = createHash('sha256').update(`arca-ticket:${secret}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Formato de secreto cifrado inválido.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
