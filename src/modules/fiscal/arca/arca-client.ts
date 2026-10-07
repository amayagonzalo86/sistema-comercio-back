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

  private wsfe(environment: ArcaEnvironment, action: string, body: string): Promise<string> {
    return this.post(this.url(environment, 'wsfe'), body, `"${WSFE_NAMESPACE}${action}"`);
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
      this.logger.warn(`Sin respuesta de ARCA (${new URL(url).host}): ${error instanceof Error ? error.message : String(error)}`);
      throw new ArcaTransportError('No se pudo comunicar con ARCA. Reintentá en unos minutos.');
    }
    const text = await response.text();
    // WSAA responde 500 con un SOAP Fault legible; se devuelve para que el parser lo interprete.
    if (!response.ok && !text.includes('Fault')) {
      throw new ArcaTransportError(`ARCA respondió HTTP ${response.status}.`);
    }
    return text;
  }
}
