import { createHash, createPrivateKey, sign, X509Certificate } from 'node:crypto';

/**
 * Firma CMS/PKCS#7 (SignedData, RFC 5652) del ticket de acceso que exige WSAA de ARCA.
 * Implementada con node:crypto y un codificador DER mínimo: no requiere el binario openssl ni dependencias.
 */

// ── Codificación DER ──────────────────────────────────────────────

function encodeLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

export const sequence = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
/** SET OF en DER: los elementos se ordenan por su codificación. */
const setOf = (items: Buffer[]): Buffer => set(...[...items].sort(Buffer.compare));
const octetString = (value: Buffer): Buffer => tlv(0x04, value);
const nullValue = (): Buffer => Buffer.from([0x05, 0x00]);
const explicit = (index: number, content: Buffer): Buffer => tlv(0xa0 + index, content);

export function integer(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  } while (remaining > 0);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}

export function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const bytes: number[] = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let value = part >> 7;
    while (value > 0) {
      chunk.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function utcTime(date: Date): Buffer {
  const pad = (value: number) => value.toString().padStart(2, '0');
  const text =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return tlv(0x17, Buffer.from(text, 'ascii'));
}

// ── Lectura DER mínima (para tomar emisor y número de serie del certificado) ──

interface Node {
  tag: number;
  start: number;
  headerLength: number;
  length: number;
}

function readNode(buffer: Buffer, offset: number): Node {
  const tag = buffer[offset];
  let length = buffer[offset + 1];
  let headerLength = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = (length << 8) | buffer[offset + 2 + index];
    }
    headerLength += count;
  }
  return { tag, start: offset, headerLength, length };
}

const raw = (buffer: Buffer, node: Node): Buffer => buffer.subarray(node.start, node.start + node.headerLength + node.length);
const next = (node: Node): number => node.start + node.headerLength + node.length;

/** Devuelve el DER crudo del emisor (Name) y del número de serie del certificado X.509. */
export function issuerAndSerial(certificateDer: Buffer): { issuer: Buffer; serial: Buffer } {
  const certificate = readNode(certificateDer, 0);
  const tbs = readNode(certificateDer, certificate.start + certificate.headerLength);
  let cursor = tbs.start + tbs.headerLength;
  let node = readNode(certificateDer, cursor);
  if (node.tag === 0xa0) {
    cursor = next(node); // versión explícita
    node = readNode(certificateDer, cursor);
  }
  const serial = raw(certificateDer, node);
  const signatureAlgorithm = readNode(certificateDer, next(node));
  const issuer = readNode(certificateDer, next(signatureAlgorithm));
  return { issuer: raw(certificateDer, issuer), serial };
}

// ── CMS SignedData ────────────────────────────────────────────────

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
};

/**
 * Firma `content` con la clave y el certificado (PEM) y devuelve el CMS en DER (contenido incluido).
 * Equivale a: openssl cms -sign -nodetach -binary -outform DER -md sha256 -signer cert -inkey key
 */
export function signCms(content: Buffer, certificatePem: string, privateKeyPem: string, signingTime: Date = new Date()): Buffer {
  const certificate = new X509Certificate(certificatePem);
  const certificateDer = certificate.raw;
  const key = createPrivateKey(privateKeyPem);
  if (!certificate.checkPrivateKey(key)) {
    throw new Error('La clave privada no corresponde al certificado.');
  }

  const sha256Algorithm = sequence(oid(OID.sha256), nullValue());
  const attributes = [
    sequence(oid(OID.contentType), set(oid(OID.data))),
    sequence(oid(OID.signingTime), set(utcTime(signingTime))),
    sequence(oid(OID.messageDigest), set(octetString(createHash('sha256').update(content).digest()))),
  ];
  const signedAttributesSet = setOf(attributes);
  const signature = sign('sha256', signedAttributesSet, key);
  // En SignerInfo los atributos firmados van con etiqueta [0] IMPLICIT en lugar de SET.
  const signedAttributes = Buffer.concat([Buffer.from([0xa0]), signedAttributesSet.subarray(1)]);

  const { issuer, serial } = issuerAndSerial(certificateDer);
  const signerInfo = sequence(
    integer(1),
    sequence(issuer, serial),
    sha256Algorithm,
    signedAttributes,
    sequence(oid(OID.rsaEncryption), nullValue()),
    octetString(signature),
  );
  const signedData = sequence(
    integer(1),
    set(sha256Algorithm),
    sequence(oid(OID.data), explicit(0, octetString(content))),
    tlv(0xa0, certificateDer),
    set(signerInfo),
  );
  return sequence(oid(OID.signedData), explicit(0, signedData));
}
