import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

/**
 * Prueba de equipo: el navegador genera una llave ECDSA P-256 que no se puede exportar (WebCrypto) y firma un
 * desafío del servidor al iniciar sesión. Así se sabe que es el mismo equipo sin depender de la IP.
 */

/** Vigencia del desafío firmado. */
export const DEVICE_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface DevicePublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

function challengeKey(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET no está definido.');
  return `device-challenge:${secret}`;
}

/** Desafío sin estado: marca de tiempo + azar + HMAC del servidor. */
export function issueDeviceChallenge(now = Date.now()): { challenge: string; expiresAt: string } {
  const body = `${now.toString(36)}.${randomBytes(18).toString('base64url')}`;
  const mac = createHmac('sha256', challengeKey()).update(body).digest('base64url');
  return { challenge: `${body}.${mac}`, expiresAt: new Date(now + DEVICE_CHALLENGE_TTL_MS).toISOString() };
}

export function isValidDeviceChallenge(challenge: string, now = Date.now()): boolean {
  const parts = challenge.split('.');
  if (parts.length !== 3 || !parts.every((part) => B64URL.test(part))) return false;
  const [time, nonce, mac] = parts;
  const expected = createHmac('sha256', challengeKey()).update(`${time}.${nonce}`).digest();
  const received = Buffer.from(mac, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
  const issuedAt = parseInt(time, 36);
  return Number.isFinite(issuedAt) && issuedAt <= now + 30_000 && now - issuedAt <= DEVICE_CHALLENGE_TTL_MS;
}

/** Acepta solo llaves públicas EC P-256 (32 bytes por coordenada). */
export function normalizeDeviceJwk(value: unknown): DevicePublicJwk | null {
  if (typeof value !== 'object' || value === null) return null;
  const jwk = value as Record<string, unknown>;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return null;
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || !B64URL.test(jwk.x) || !B64URL.test(jwk.y)) return null;
  if (Buffer.from(jwk.x, 'base64url').length !== 32 || Buffer.from(jwk.y, 'base64url').length !== 32) return null;
  if ('d' in jwk) return null; // nunca una llave privada
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

/** Huella RFC 7638: SHA-256 del JWK canónico (miembros obligatorios en orden alfabético). */
export function deviceThumbprint(jwk: DevicePublicJwk): string {
  return createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('hex');
}

/** Código corto para reconocer el equipo en pantalla y en el panel (p. ej. «7F3A-91C2»). */
export function deviceCode(thumbprint: string): string {
  const head = thumbprint.slice(0, 8).toUpperCase();
  return `${head.slice(0, 4)}-${head.slice(4)}`;
}

/** Verifica la firma WebCrypto (ECDSA P-256 / SHA-256, formato r||s de 64 bytes) del desafío. */
export function verifyDeviceSignature(jwk: DevicePublicJwk, challenge: string, signature: string): boolean {
  if (!B64URL.test(signature)) return false;
  const raw = Buffer.from(signature, 'base64url');
  if (raw.length !== 64) return false;
  try {
    const key = createPublicKey({ key: { ...jwk }, format: 'jwk' });
    return verify('sha256', Buffer.from(challenge, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, raw);
  } catch {
    return false;
  }
}

/** Nombre sugerido a partir del navegador cuando el local no escribió uno. */
export function defaultDeviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Mac OS X/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Equipo';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  return `${os} · ${browser}`;
}

export function cleanDeviceName(name: string | undefined | null, userAgent: string | undefined): string {
  const printable = [...(name ?? '')].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127 && char !== '<' && char !== '>').join('');
  const clean = printable.replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean || defaultDeviceName(userAgent);
}

/** Huella del secreto de un equipo sin WebCrypto (el secreto nunca se guarda). */
export function deviceTokenThumbprint(token: string): string {
  return createHash('sha256').update(`device-token:${token}`).digest('hex');
}
