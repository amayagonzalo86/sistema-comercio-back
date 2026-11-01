import { generateKeyPairSync, sign } from 'node:crypto';
import {
  cleanDeviceName,
  deviceCode,
  deviceThumbprint,
  issueDeviceChallenge,
  isValidDeviceChallenge,
  normalizeDeviceJwk,
  verifyDeviceSignature,
} from './device-proof';

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789-abcdefghijklmnop';

const newDevice = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const signChallenge = (challenge: string) => sign('sha256', Buffer.from(challenge), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { jwk, signChallenge };
};

describe('prueba de equipo (equipos autorizados)', () => {
  it('acepta la firma del equipo dueño de la llave y rechaza la de otro', () => {
    const device = newDevice();
    const other = newDevice();
    const { challenge } = issueDeviceChallenge();
    const jwk = normalizeDeviceJwk(device.jwk)!;
    expect(verifyDeviceSignature(jwk, challenge, device.signChallenge(challenge))).toBe(true);
    expect(verifyDeviceSignature(jwk, challenge, other.signChallenge(challenge))).toBe(false);
    expect(verifyDeviceSignature(jwk, `${challenge}x`, device.signChallenge(challenge))).toBe(false);
    expect(verifyDeviceSignature(jwk, challenge, 'no-es-una-firma')).toBe(false);
  });

  it('el desafío vence y no se puede falsificar', () => {
    const now = Date.now();
    const { challenge } = issueDeviceChallenge(now);
    expect(isValidDeviceChallenge(challenge, now + 60_000)).toBe(true);
    expect(isValidDeviceChallenge(challenge, now + 6 * 60_000)).toBe(false);
    const [time, nonce] = challenge.split('.');
    expect(isValidDeviceChallenge(`${time}.${nonce}.AAAA`, now)).toBe(false);
    expect(isValidDeviceChallenge('basura', now)).toBe(false);
  });

  it('solo acepta llaves públicas P-256 y calcula una huella estable', () => {
    const { jwk } = newDevice();
    const normalized = normalizeDeviceJwk(jwk)!;
    expect(deviceThumbprint(normalized)).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceThumbprint(normalized)).toBe(deviceThumbprint(normalizeDeviceJwk({ ...jwk, extra: 1 })!));
    expect(deviceCode('7f3a91c2' + '0'.repeat(56))).toBe('7F3A-91C2');
    expect(normalizeDeviceJwk({ ...jwk, crv: 'P-384' })).toBeNull();
    expect(normalizeDeviceJwk({ ...jwk, d: 'privada' })).toBeNull();
    expect(normalizeDeviceJwk({ kty: 'RSA' })).toBeNull();
  });

  it('limpia el nombre del equipo y sugiere uno por el navegador', () => {
    expect(cleanDeviceName('  Caja   1 <b> ', undefined)).toBe('Caja 1 b');
    expect(cleanDeviceName('', 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36')).toBe('Windows · Chrome');
  });
});
