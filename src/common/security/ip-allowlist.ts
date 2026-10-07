import { BlockList, isIP } from 'node:net';

/**
 * Lista blanca de IP por sucursal.
 * Acepta direcciones individuales ("190.2.10.4", "2803:9800::1") y rangos CIDR ("10.0.0.0/24").
 * Una lista vacía o nula significa "sin restricción".
 */

export const MAX_ALLOWED_IP_RANGES = 50;

/** Quita el prefijo IPv4 mapeado en IPv6 (::ffff:1.2.3.4) que Node informa en sockets dual-stack. */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed.toLowerCase().startsWith('::ffff:') && isIP(trimmed.slice(7)) === 4
    ? trimmed.slice(7)
    : trimmed;
}

/** true si el texto es una IP o un CIDR válido (prefijo 0-32 en IPv4, 0-128 en IPv6). */
export function isValidIpOrCidr(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 64) {
    return false;
  }
  const [address, prefix, extra] = value.trim().split('/');
  if (extra !== undefined) {
    return false;
  }
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  if (!/^\d{1,3}$/.test(prefix)) {
    return false;
  }
  const bits = Number(prefix);
  return family === 4 ? bits <= 32 : bits <= 128;
}

export function buildBlockList(ranges: readonly string[]): BlockList {
  const list = new BlockList();
  for (const range of ranges) {
    if (!isValidIpOrCidr(range)) {
      throw new RangeError(`Rango IP inválido: ${range}`);
    }
    const [address, prefix] = range.trim().split('/');
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) {
      list.addAddress(address, family);
    } else {
      list.addSubnet(address, Number(prefix), family);
    }
  }
  return list;
}

/**
 * Devuelve true si la IP está permitida por la lista.
 * Sin lista configurada => permitido. IP desconocida con lista configurada => denegado.
 */
export function isIpAllowed(ip: string | null | undefined, ranges: readonly string[] | null | undefined): boolean {
  if (!ranges || ranges.length === 0) {
    return true;
  }
  if (!ip) {
    return false;
  }
  const normalized = normalizeIp(ip);
  const family = isIP(normalized);
  if (family === 0) {
    return false;
  }
  return buildBlockList(ranges).check(normalized, family === 6 ? 'ipv6' : 'ipv4');
}
