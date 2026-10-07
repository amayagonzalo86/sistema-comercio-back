import { Request } from 'express';
import { normalizeIp } from '../security/ip-allowlist';

export interface RequestAuditContext {
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * IP real del cliente.
 * `request.ip` respeta la opción `trust proxy` de Express (configurada con TRUST_PROXY_HOPS):
 * detrás de Cloudflare/Nginx devuelve la IP del visitante y no la del proxy.
 * Sin proxy confiable configurado, ignora X-Forwarded-For (que el cliente puede falsificar).
 */
export function getClientIp(request: Request): string | null {
  const ip = request.ip ?? request.socket?.remoteAddress ?? null;
  return ip ? normalizeIp(ip) : null;
}

export function buildAuditContext(request: Request): RequestAuditContext {
  return {
    requestId: (request as Request & { requestId?: string }).requestId,
    ipAddress: getClientIp(request),
    userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
  };
}
