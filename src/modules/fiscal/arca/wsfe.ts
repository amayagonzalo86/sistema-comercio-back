import { TaxConditionEnum } from '../../../common/enums/afip.enum';
import { normalizeTaxId } from '../../../common/validators/argentina-id';
import { VoucherClass } from '../vat/vat';
import { codeMessages, escapeXml, tagValue, unescapeXml } from './xml';

export const WSFE_NAMESPACE = 'http://ar.gov.afip.dif.FEV1/';

export enum FiscalDocumentKind {
  INVOICE = 'INVOICE',
  CREDIT_NOTE = 'CREDIT_NOTE',
}

/** Códigos de tipo de comprobante de WSFEv1. La clase E (exportación) se emite por WSFEX. */
const VOUCHER_TYPES: Record<string, Record<FiscalDocumentKind, number>> = {
  A: { INVOICE: 1, CREDIT_NOTE: 3 },
  B: { INVOICE: 6, CREDIT_NOTE: 8 },
  C: { INVOICE: 11, CREDIT_NOTE: 13 },
};

export function voucherTypeCode(voucherClass: VoucherClass | string, kind: FiscalDocumentKind): number {
  const types = VOUCHER_TYPES[voucherClass];
  if (!types) {
    throw new RangeError(`Los comprobantes clase ${voucherClass} no se emiten por WSFEv1 (exportación requiere WSFEX).`);
  }
  return types[kind];
}

/**
 * Condición frente al IVA del receptor (campo CondicionIVAReceptorId, obligatorio — RG 5616).
 * Valores de la tabla FEParamGetCondicionIvaReceptor; se pueden verificar en GET /fiscal/receiver-conditions.
 */
export function receiverConditionId(condition: TaxConditionEnum | string | null | undefined): number {
  switch (condition) {
    case TaxConditionEnum.RESPONSABLE_INSCRIPTO:
      return 1;
    case TaxConditionEnum.EXENTO:
      return 4;
    case TaxConditionEnum.MONOTRIBUTO:
      return 6;
    case TaxConditionEnum.SUJETO_NO_CATEGORIZADO:
      return 7;
    case TaxConditionEnum.CLIENTE_DEL_EXTERIOR:
      return 9;
    case TaxConditionEnum.NO_RESPONSABLE:
      return 15;
    default:
      return 5; // Consumidor final
  }
}

export interface ReceiverDocument {
  docType: number;
  docNumber: string;
}

/** Documento del receptor: CUIT (80), DNI (96) o consumidor final sin identificar (99 / 0). */
export function receiverDocument(nationalId: string | null | undefined, documentType: number | null | undefined): ReceiverDocument {
  const digits = nationalId ? normalizeTaxId(nationalId) : '';
  if (digits && documentType && [80, 86, 96].includes(documentType)) {
    return { docType: documentType, docNumber: digits };
  }
  if (/^\d{11}$/.test(digits)) return { docType: 80, docNumber: digits };
  if (/^\d{7,8}$/.test(digits)) return { docType: 96, docNumber: digits };
  return { docType: 99, docNumber: '0' };
}

export interface VatRateAmount {
  arcaId: number;
  base: string;
  amount: string;
}

export interface CaeRequest {
  pointOfSale: number;
  voucherType: number;
  number: number;
  /** AAAAMMDD */
  date: string;
  docType: number;
  docNumber: string;
  receiverConditionId: number;
  total: string;
  netTaxed: string;
  notTaxed: string;
  exempt: string;
  vat: string;
  currency: 'PES';
  vatRates: VatRateAmount[];
  associated?: { voucherType: number; pointOfSale: number; number: number; cuit: string; date: string } | null;
}

export interface WsfeAuth {
  token: string;
  sign: string;
  cuit: string;
}

const authXml = (auth: WsfeAuth) =>
  `<ar:Auth><ar:Token>${escapeXml(auth.token)}</ar:Token><ar:Sign>${escapeXml(auth.sign)}</ar:Sign><ar:Cuit>${escapeXml(auth.cuit)}</ar:Cuit></ar:Auth>`;

export function envelope(body: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${WSFE_NAMESPACE}">` +
    `<soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`
  );
}

export function lastAuthorizedXml(auth: WsfeAuth, pointOfSale: number, voucherType: number): string {
  return envelope(`<ar:FECompUltimoAutorizado>${authXml(auth)}<ar:PtoVta>${pointOfSale}</ar:PtoVta><ar:CbteTipo>${voucherType}</ar:CbteTipo></ar:FECompUltimoAutorizado>`);
}

export function consultXml(auth: WsfeAuth, pointOfSale: number, voucherType: number, number: number): string {
  return envelope(
    `<ar:FECompConsultar>${authXml(auth)}<ar:FeCompConsReq><ar:CbteTipo>${voucherType}</ar:CbteTipo><ar:CbteNro>${number}</ar:CbteNro><ar:PtoVta>${pointOfSale}</ar:PtoVta></ar:FeCompConsReq></ar:FECompConsultar>`,
  );
}

export function dummyXml(): string {
  return envelope('<ar:FEDummy/>');
}

export function receiverConditionsXml(auth: WsfeAuth): string {
  return envelope(`<ar:FEParamGetCondicionIvaReceptor>${authXml(auth)}</ar:FEParamGetCondicionIvaReceptor>`);
}

/** Arma FECAESolicitar respetando el orden de elementos del esquema de WSFEv1. */
export function caeRequestXml(auth: WsfeAuth, request: CaeRequest): string {
  const associated = request.associated
    ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${request.associated.voucherType}</ar:Tipo><ar:PtoVta>${request.associated.pointOfSale}</ar:PtoVta><ar:Nro>${request.associated.number}</ar:Nro><ar:Cuit>${escapeXml(request.associated.cuit)}</ar:Cuit><ar:CbteFch>${request.associated.date}</ar:CbteFch></ar:CbteAsoc></ar:CbtesAsoc>`
    : '';
  const iva = request.vatRates.length
    ? `<ar:Iva>${request.vatRates
        .map((rate) => `<ar:AlicIva><ar:Id>${rate.arcaId}</ar:Id><ar:BaseImp>${rate.base}</ar:BaseImp><ar:Importe>${rate.amount}</ar:Importe></ar:AlicIva>`)
        .join('')}</ar:Iva>`
    : '';
  const detail =
    '<ar:FECAEDetRequest>' +
    '<ar:Concepto>1</ar:Concepto>' +
    `<ar:DocTipo>${request.docType}</ar:DocTipo>` +
    `<ar:DocNro>${escapeXml(request.docNumber)}</ar:DocNro>` +
    `<ar:CbteDesde>${request.number}</ar:CbteDesde>` +
    `<ar:CbteHasta>${request.number}</ar:CbteHasta>` +
    `<ar:CbteFch>${request.date}</ar:CbteFch>` +
    `<ar:ImpTotal>${request.total}</ar:ImpTotal>` +
    `<ar:ImpTotConc>${request.notTaxed}</ar:ImpTotConc>` +
    `<ar:ImpNeto>${request.netTaxed}</ar:ImpNeto>` +
    `<ar:ImpOpEx>${request.exempt}</ar:ImpOpEx>` +
    '<ar:ImpTrib>0.00</ar:ImpTrib>' +
    `<ar:ImpIVA>${request.vat}</ar:ImpIVA>` +
    `<ar:MonId>${request.currency}</ar:MonId>` +
    '<ar:MonCotiz>1</ar:MonCotiz>' +
    `<ar:CondicionIVAReceptorId>${request.receiverConditionId}</ar:CondicionIVAReceptorId>` +
    associated +
    iva +
    '</ar:FECAEDetRequest>';
  return envelope(
    `<ar:FECAESolicitar>${authXml(auth)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${request.pointOfSale}</ar:PtoVta><ar:CbteTipo>${request.voucherType}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq>${detail}</ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>`,
  );
}

export interface CaeResult {
  /** A = aprobado, R = rechazado, P = parcial. */
  result: 'A' | 'R' | 'P' | string;
  cae: string | null;
  /** AAAAMMDD */
  caeExpiration: string | null;
  observations: Array<{ code: string; message: string }>;
  errors: Array<{ code: string; message: string }>;
}

export function parseCaeResponse(xml: string): CaeResult {
  const detail = tagValue(xml, 'FECAEDetResponse') ?? '';
  const header = tagValue(xml, 'FeCabResp') ?? '';
  const cae = tagValue(detail, 'CAE');
  return {
    result: tagValue(detail, 'Resultado') ?? tagValue(header, 'Resultado') ?? 'R',
    cae: cae && /^\d{14}$/.test(cae) ? cae : null,
    caeExpiration: tagValue(detail, 'CAEFchVto') || null,
    observations: codeMessages(detail, 'Obs'),
    errors: codeMessages(xml, 'Err'),
  };
}

export function parseLastAuthorized(xml: string): number {
  const errors = codeMessages(xml, 'Err');
  if (errors.length) {
    throw new Error(`ARCA: ${errors.map((error) => `${error.code} ${error.message}`).join('; ')}`);
  }
  const value = tagValue(xml, 'CbteNro');
  if (value === null || !/^\d+$/.test(value)) {
    throw new Error('ARCA no informó el último comprobante autorizado.');
  }
  return Number(value);
}

export interface ConsultResult {
  found: boolean;
  cae: string | null;
  caeExpiration: string | null;
  total: string | null;
}

export function parseConsult(xml: string): ConsultResult {
  const result = tagValue(xml, 'ResultGet');
  if (!result) return { found: false, cae: null, caeExpiration: null, total: null };
  return {
    found: true,
    cae: tagValue(result, 'CodAutorizacion'),
    caeExpiration: tagValue(result, 'FchVto'),
    total: tagValue(result, 'ImpTotal'),
  };
}

export function parseReceiverConditions(xml: string): Array<{ id: number; description: string }> {
  return (tagValue(xml, 'ResultGet') ?? '')
    .split(/<\/(?:[\w-]+:)?CondicionIvaReceptor>/)
    .map((block) => ({ id: Number(tagValue(block, 'Id')), description: unescapeXml(tagValue(block, 'Desc') ?? '') }))
    .filter((item) => Number.isFinite(item.id) && item.id > 0);
}

/** URL del código QR obligatorio en el comprobante impreso (especificación ARCA, versión 1). */
export function qrUrl(input: {
  date: string; // AAAA-MM-DD
  cuit: string;
  pointOfSale: number;
  voucherType: number;
  number: number;
  total: string;
  docType: number;
  docNumber: string;
  cae: string;
}): string {
  const payload: Record<string, string | number> = {
    ver: 1,
    fecha: input.date,
    cuit: Number(normalizeTaxId(input.cuit)),
    ptoVta: input.pointOfSale,
    tipoCmp: input.voucherType,
    nroCmp: input.number,
    importe: Number(input.total),
    moneda: 'PES',
    ctz: 1,
    tipoCodAut: 'E',
    codAut: Number(input.cae),
  };
  if (input.docType !== 99) {
    payload.tipoDocRec = input.docType;
    payload.nroDocRec = Number(input.docNumber);
  }
  return `https://www.arca.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
}

/** Fecha AAAAMMDD en la zona horaria indicada. */
export function arcaDate(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at).replace(/-/g, '');
}
