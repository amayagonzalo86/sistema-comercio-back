import { escapeXml, tagValue, unescapeXml } from './xml';

/** Ticket de requerimiento de acceso (TRA) para WSAA, válido ±10 minutos. */
export function loginTicketRequest(service: string, now: Date = new Date()): string {
  const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${iso(new Date(now.getTime() - 10 * 60_000))}</generationTime>` +
    `<expirationTime>${iso(new Date(now.getTime() + 10 * 60_000))}</expirationTime>` +
    `</header><service>${escapeXml(service)}</service></loginTicketRequest>`
  );
}

export function loginCmsEnvelope(cmsBase64: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`
  );
}

export interface AccessTicket {
  token: string;
  sign: string;
  expiresAt: Date;
}

export class ArcaAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Interpreta la respuesta de loginCms (el ticket viene como XML escapado dentro de loginCmsReturn). */
export function parseLoginResponse(xml: string): AccessTicket {
  const fault = tagValue(xml, 'faultstring');
  if (fault) {
    const code = tagValue(xml, 'faultcode') ?? 'WSAA';
    throw new ArcaAuthError(code.replace(/^.*:/, ''), unescapeXml(fault));
  }
  const ticket = unescapeXml(tagValue(xml, 'loginCmsReturn') ?? '');
  const token = tagValue(ticket, 'token');
  const sign = tagValue(ticket, 'sign');
  const expiration = tagValue(ticket, 'expirationTime');
  if (!token || !sign || !expiration || Number.isNaN(Date.parse(expiration))) {
    throw new ArcaAuthError('invalidResponse', 'WSAA devolvió una respuesta sin ticket de acceso.');
  }
  return { token, sign, expiresAt: new Date(expiration) };
}
