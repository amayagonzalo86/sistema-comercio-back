import { Injectable, Logger } from '@nestjs/common';
import { ArcaEnvironment } from '../../platform/entities/fiscal-profile.entity';
import { signCms } from './cms';
import { resolveSecret } from './secrets';
import { AccessTicket, loginCmsEnvelope, loginTicketRequest, parseLoginResponse } from './wsaa';
import {
  CaeRequest,
  CaeResult,
  caeRequestXml,
  ConsultResult,
  consultXml,
  dummyXml,
  lastAuthorizedXml,
  parseCaeResponse,
  parseConsult,
  parseLastAuthorized,
  parseReceiverConditions,
  receiverConditionsXml,
  WSFE_NAMESPACE,
  WsfeAuth,
} from './wsfe';
import { tagValue } from './xml';

export const ARCA_CLIENT = Symbol('ARCA_CLIENT');

export interface ArcaCredentials {
  environment: ArcaEnvironment;
  cuit: string;
  certificateRef: string | null | undefined;
  privateKeyRef: string | null | undefined;
}

/** Operaciones de ARCA usadas por el sistema. Se inyecta para poder simularla en pruebas. */
export interface ArcaClient {
  authenticate(credentials: ArcaCredentials, service: string): Promise<AccessTicket>;
  lastAuthorized(environment: ArcaEnvironment, auth: WsfeAuth, pointOfSale: number, voucherType: number): Promise<number>;
  requestCae(environment: ArcaEnvironment, auth: WsfeAuth, request: CaeRequest): Promise<CaeResult>;
  consult(environment: ArcaEnvironment, auth: WsfeAuth, pointOfSale: number, voucherType: number, number: number): Promise<ConsultResult>;
  receiverConditions(environment: ArcaEnvironment, auth: WsfeAuth): Promise<Array<{ id: number; description: string }>>;
  health(environment: ArcaEnvironment): Promise<{ app: string | null; db: string | null; auth: string | null }>;
}

const DEFAULT_URLS: Record<ArcaEnvironment, { wsaa: string; wsfe: string }> = {
  [ArcaEnvironment.HOMOLOGATION]: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  [ArcaEnvironment.PRODUCTION]: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};

export class ArcaTransportError extends Error {}

/** Código técnico del error de red (fetch lo envuelve en `cause`). */
export function networkErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'TIMEOUT';
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause && typeof cause === 'object' && 'code' in cause && typeof (cause as { code: unknown }).code === 'string') {
    return (cause as { code: string }).code;
  }
  if ('code' in error && typeof (error as { code: unknown }).code === 'string') return (error as { code: string }).code;
  return error.name || 'UNKNOWN';
}

/** Mensaje claro según el motivo por el que no se pudo hablar con ARCA. */
export function transportMessage(host: string, code: string): string {
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `No se encontró el servidor de ARCA ${host} (DNS). Revisá la conexión a internet del servidor.`;
  }
  if (code === 'TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return `ARCA (${host}) no respondió a tiempo. El servicio puede estar caído o lento: reintentá en unos minutos.`;
  }
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') {
    return `ARCA (${host}) cortó la conexión (${code}). Suele ser una caída del servicio de ARCA; si persiste, revisá que el firewall o el antivirus no bloqueen ${host}.`;
  }
  if (code.startsWith('ERR_SSL') || code.startsWith('ERR_TLS') || code.includes('CERT')) {
    return `Error de seguridad TLS con ARCA (${host}: ${code}). Revisá la fecha y hora de la PC y que ningún proxy o antivirus intercepte HTTPS.`;
  }
  return `No se pudo comunicar con ARCA (${host}: ${code}). Reintentá en unos minutos.`;
}

const RETRY_DELAY_MS = 1_500;
/** Consultas sin efecto en ARCA: se pueden reintentar si se corta la conexión. */
const READ_ONLY_ACTIONS = new Set(['FEDummy', 'FECompUltimoAutorizado', 'FECompConsultar', 'FEParamGetCondicionIvaReceptor']);

/** Cliente SOAP real contra ARCA (URLs reemplazables por variables de entorno si ARCA las cambia). */
@Injectable()
export class HttpArcaClient implements ArcaClient {
  private readonly logger = new Logger(HttpArcaClient.name);

  async authenticate(credentials: ArcaCredentials, service: string): Promise<AccessTicket> {
    const certificate = resolveSecret(credentials.certificateRef);
    const privateKey = resolveSecret(credentials.privateKeyRef);
    const cms = signCms(Buffer.from(loginTicketRequest(service), 'utf8'), certificate, privateKey);
    const xml = await this.post(this.url(credentials.environment, 'wsaa'), loginCmsEnvelope(cms.toString('base64')), '""');
    return parseLoginResponse(xml);
  }

  async lastAuthorized(environment: ArcaEnvironment, auth: WsfeAuth, pointOfSale: number, voucherType: number): Promise<number> {
    const xml = await this.wsfe(environment, 'FECompUltimoAutorizado', lastAuthorizedXml(auth, pointOfSale, voucherType));
    return parseLastAuthorized(xml);
  }

  async requestCae(environment: ArcaEnvironment, auth: WsfeAuth, request: CaeRequest): Promise<CaeResult> {
    return parseCaeResponse(await this.wsfe(environment, 'FECAESolicitar', caeRequestXml(auth, request)));
  }

  async consult(environment: ArcaEnvironment, auth: WsfeAuth, pointOfSale: number, voucherType: number, number: number): Promise<ConsultResult> {
    return parseConsult(await this.wsfe(environment, 'FECompConsultar', consultXml(auth, pointOfSale, voucherType, number)));
  }

  async receiverConditions(environment: ArcaEnvironment, auth: WsfeAuth) {
    return parseReceiverConditions(await this.wsfe(environment, 'FEParamGetCondicionIvaReceptor', receiverConditionsXml(auth)));
  }

  async health(environment: ArcaEnvironment) {
    const xml = await this.wsfe(environment, 'FEDummy', dummyXml());
    return { app: tagValue(xml, 'AppServer'), db: tagValue(xml, 'DbServer'), auth: tagValue(xml, 'AuthServer') };
  }

  private async wsfe(environment: ArcaEnvironment, action: string, body: string): Promise<string> {
    const url = this.url(environment, 'wsfe');
    const soapAction = `"${WSFE_NAMESPACE}${action}"`;
    try {
      return await this.post(url, body, soapAction);
    } catch (error) {
      // Un corte de red en una consulta se reintenta una vez. FECAESolicitar no: si ARCA llegó a autorizarlo,
      // la emisión lo recupera con FECompConsultar antes de volver a pedir el CAE.
      if (!(error instanceof ArcaTransportError) || !READ_ONLY_ACTIONS.has(action)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return this.post(url, body, soapAction);
    }
  }

  private url(environment: ArcaEnvironment, service: 'wsaa' | 'wsfe'): string {
    const suffix = environment === ArcaEnvironment.PRODUCTION ? 'PROD' : 'HOMO';
    return process.env[`ARCA_${service.toUpperCase()}_URL_${suffix}`] || DEFAULT_URLS[environment][service];
  }

  private async post(url: string, body: string, soapAction: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: soapAction },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const host = new URL(url).host;
      const code = networkErrorCode(error);
      this.logger.warn(`Sin respuesta de ARCA (${host}): ${code} ${error instanceof Error ? error.message : String(error)}`);
      throw new ArcaTransportError(transportMessage(host, code));
    }
    const text = await response.text();
    // WSAA responde 500 con un SOAP Fault legible; se devuelve para que el parser lo interprete.
    if (!response.ok && !text.includes('Fault')) {
      throw new ArcaTransportError(`ARCA (${new URL(url).host}) respondió HTTP ${response.status}: el servicio no está disponible en este momento.`);
    }
    return text;
  }
}
