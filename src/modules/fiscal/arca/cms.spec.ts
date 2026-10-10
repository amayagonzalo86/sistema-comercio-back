import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integer, oid, signCms } from './cms';

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('cms', () => {
  it('codifica OID y enteros en DER', () => {
    expect(oid('1.2.840.113549.1.7.2').toString('hex')).toBe('06092a864886f70d010702');
    expect(integer(1).toString('hex')).toBe('020101');
    expect(integer(128).toString('hex')).toBe('02020080');
  });

  it('rechaza una clave que no corresponde al certificado', () => {
    if (!hasOpenssl()) return;
    const dir = mkdtempSync(join(tmpdir(), 'cms-'));
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=test'], { stdio: 'ignore' });
      const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      expect(() => signCms(Buffer.from('x'), readFileSync(join(dir, 'c.pem'), 'utf8'), other)).toThrow(Error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('genera un CMS que OpenSSL verifica y del que recupera el contenido', () => {
    if (!hasOpenssl()) return;
    const dir = mkdtempSync(join(tmpdir(), 'cms-'));
    try {
      execFileSync(
        'openssl',
        ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/C=AR/O=Prueba SA/CN=erp-test/serialNumber=CUIT 20123456786'],
        { stdio: 'ignore' },
      );
      const content = Buffer.from('<loginTicketRequest version="1.0"><service>wsfe</service></loginTicketRequest>');
      const cms = signCms(content, readFileSync(join(dir, 'cert.pem'), 'utf8'), readFileSync(join(dir, 'key.pem'), 'utf8'));
      writeFileSync(join(dir, 'tra.cms'), cms);
      const recovered = execFileSync('openssl', [
        'cms', '-verify', '-inform', 'DER', '-in', join(dir, 'tra.cms'), '-CAfile', join(dir, 'cert.pem'), '-purpose', 'any',
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      expect(recovered.toString()).toBe(content.toString());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
