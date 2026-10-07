import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaxConditionEnum } from '../../../common/enums/afip.enum';
import { VoucherClass } from '../vat/vat';
import { isValidSecretReference, resolveSecret, SecretBox } from './secrets';
import { loginTicketRequest, parseLoginResponse } from './wsaa';
import {
  caeRequestXml,
  FiscalDocumentKind,
  parseCaeResponse,
  parseConsult,
  parseLastAuthorized,
  qrUrl,
  receiverConditionId,
  receiverDocument,
  voucherTypeCode,
} from './wsfe';
import { tagValue, unescapeXml } from './xml';

const auth = { token: 'TOKEN', sign: 'SIGN', cuit: '20123456786' };

describe('ARCA WSFEv1', () => {
  it('mapea clase y tipo de comprobante', () => {
    expect(voucherTypeCode(VoucherClass.A, FiscalDocumentKind.INVOICE)).toBe(1);
    expect(voucherTypeCode(VoucherClass.B, FiscalDocumentKind.CREDIT_NOTE)).toBe(8);
    expect(voucherTypeCode(VoucherClass.C, FiscalDocumentKind.INVOICE)).toBe(11);
    expect(() => voucherTypeCode(VoucherClass.E, FiscalDocumentKind.INVOICE)).toThrow(RangeError);
  });

  it('mapea receptor: documento y condición frente al IVA', () => {
    expect(receiverDocument('20-12345678-6', 80)).toEqual({ docType: 80, docNumber: '20123456786' });
    expect(receiverDocument('12.345.678', null)).toEqual({ docType: 96, docNumber: '12345678' });
    expect(receiverDocument(null, null)).toEqual({ docType: 99, docNumber: '0' });
    expect(receiverConditionId(TaxConditionEnum.RESPONSABLE_INSCRIPTO)).toBe(1);
    expect(receiverConditionId(TaxConditionEnum.MONOTRIBUTO)).toBe(6);
    expect(receiverConditionId(null)).toBe(5);
  });

  it('arma FECAESolicitar con alícuotas, condición del receptor y comprobante asociado', () => {
    const xml = caeRequestXml(auth, {
      pointOfSale: 3,
      voucherType: 3,
      number: 15,
      date: '20261007',
      docType: 80,
      docNumber: '20123456786',
      receiverConditionId: 1,
      total: '121.00',
      netTaxed: '100.00',
      notTaxed: '0.00',
      exempt: '0.00',
      vat: '21.00',
      currency: 'PES',
      vatRates: [{ arcaId: 5, base: '100.00', amount: '21.00' }],
      associated: { voucherType: 1, pointOfSale: 3, number: 14, cuit: '20123456786', date: '20261006' },
    });
    expect(tagValue(xml, 'CbteDesde')).toBe('15');
    expect(tagValue(xml, 'CondicionIVAReceptorId')).toBe('1');
    expect(tagValue(xml, 'Nro')).toBe('14');
    expect(xml.indexOf('<ar:CondicionIVAReceptorId>')).toBeLessThan(xml.indexOf('<ar:CbtesAsoc>'));
    expect(xml.indexOf('<ar:CbtesAsoc>')).toBeLessThan(xml.indexOf('<ar:Iva>'));
  });

  it('interpreta respuestas aprobadas, rechazadas y consultas', () => {
    const approved = parseCaeResponse(
      '<FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>76123456789012</CAE><CAEFchVto>20261017</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult>',
    );
    expect(approved.result).toBe('A');
    expect(approved.cae).toBe('76123456789012');
    const rejected = parseCaeResponse(
      '<FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10015</Code><Msg>Falta doc</Msg></Obs></Observaciones></FECAEDetResponse>',
    );
    expect(rejected.result).toBe('R');
    expect(rejected.observations[0].code).toBe('10015');
    expect(parseLastAuthorized('<FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>6</CbteTipo><CbteNro>41</CbteNro></FECompUltimoAutorizadoResult>')).toBe(41);
    expect(() => parseLastAuthorized('<Errors><Err><Code>600</Code><Msg>No autorizado</Msg></Err></Errors>')).toThrow(Error);
    expect(parseConsult('<ResultGet><CodAutorizacion>76123456789012</CodAutorizacion><FchVto>20261017</FchVto><ImpTotal>121</ImpTotal></ResultGet>').found).toBe(true);
  });

  it('genera la URL del QR según la especificación de ARCA', () => {
    const url = qrUrl({
      date: '2026-10-07',
      cuit: '30-71234567-1',
      pointOfSale: 3,
      voucherType: 6,
      number: 42,
      total: '3267.00',
      docType: 99,
      docNumber: '0',
      cae: '76123456789012',
    });
    expect(url.startsWith('https://www.arca.gob.ar/fe/qr/?p=')).toBe(true);
    const payload = JSON.parse(Buffer.from(url.split('p=')[1], 'base64').toString('utf8'));
    expect(payload.ver).toBe(1);
    expect(payload.cuit).toBe(30712345671);
    expect(payload.codAut).toBe(76123456789012);
    expect(payload.tipoDocRec).toBe(undefined);
  });
});

describe('ARCA WSAA y secretos', () => {
  it('arma el TRA y lee el ticket de acceso', () => {
    const tra = loginTicketRequest('wsfe', new Date('2026-10-07T12:00:00Z'));
    expect(tagValue(tra, 'service')).toBe('wsfe');
    expect(tagValue(tra, 'generationTime')).toBe('2026-10-07T11:50:00Z');
    const ticket = parseLoginResponse(
      '<loginCmsReturn>&lt;loginTicketResponse&gt;&lt;header&gt;&lt;expirationTime&gt;2026-10-08T00:00:00-03:00&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;TK&lt;/token&gt;&lt;sign&gt;SG&lt;/sign&gt;&lt;/credentials&gt;&lt;/loginTicketResponse&gt;</loginCmsReturn>',
    );
    expect(ticket.token).toBe('TK');
    expect(ticket.expiresAt.toISOString()).toBe('2026-10-08T03:00:00.000Z');
    expect(() => parseLoginResponse('<soap:Fault><faultcode>ns1:coe.alreadyAuthenticated</faultcode><faultstring>Ya posee TA</faultstring></soap:Fault>')).toThrow(Error);
    expect(unescapeXml('a &amp;lt; b')).toBe('a &lt; b');
  });

  it('cifra y descifra el ticket', () => {
    const box = new SecretBox('x'.repeat(40));
    const sealed = box.seal('token-secreto');
    expect(sealed.includes('token-secreto')).toBe(false);
    expect(box.open(sealed)).toBe('token-secreto');
    expect(() => new SecretBox('corta')).toThrow(Error);
  });

  it('resuelve secretos de entorno y archivos sin salir de la carpeta permitida', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    expect(resolveSecret('env:ARCA_CERT', { ARCA_CERT: Buffer.from(pem).toString('base64') })).toBe(pem);
    const dir = mkdtempSync(join(tmpdir(), 'sec-'));
    try {
      writeFileSync(join(dir, 'cert.pem'), pem);
      expect(resolveSecret('file:cert.pem', { FISCAL_SECRETS_DIR: dir })).toBe(pem);
      expect(() => resolveSecret('file:../etc/passwd', { FISCAL_SECRETS_DIR: dir })).toThrow(Error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(isValidSecretReference('env:ARCA_CERT')).toBe(true);
    expect(isValidSecretReference('file:../x.pem')).toBe(false);
    expect(isValidSecretReference('http://x')).toBe(false);
  });
});
