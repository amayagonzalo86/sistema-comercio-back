import { isIpAllowed, isValidIpOrCidr, normalizeIp } from './ip-allowlist';

describe('ip-allowlist', () => {
  it('sin lista configurada permite cualquier IP', () => {
    expect(isIpAllowed('8.8.8.8', null)).toBe(true);
    expect(isIpAllowed('8.8.8.8', [])).toBe(true);
  });

  it('permite IPs exactas y rangos CIDR', () => {
    const ranges = ['190.2.10.4', '10.0.0.0/24', '2803:9800::/32'];
    expect(isIpAllowed('190.2.10.4', ranges)).toBe(true);
    expect(isIpAllowed('10.0.0.200', ranges)).toBe(true);
    expect(isIpAllowed('2803:9800:1::5', ranges)).toBe(true);
    expect(isIpAllowed('10.0.1.1', ranges)).toBe(false);
    expect(isIpAllowed('190.2.10.5', ranges)).toBe(false);
  });

  it('normaliza IPv4 mapeada en IPv6', () => {
    expect(normalizeIp('::ffff:10.0.0.7')).toBe('10.0.0.7');
    expect(isIpAllowed('::ffff:10.0.0.7', ['10.0.0.0/24'])).toBe(true);
  });

  it('deniega IP ausente o inválida cuando hay lista', () => {
    expect(isIpAllowed(undefined, ['10.0.0.0/24'])).toBe(false);
    expect(isIpAllowed('no-ip', ['10.0.0.0/24'])).toBe(false);
  });

  it('valida formatos', () => {
    expect(isValidIpOrCidr('10.0.0.0/24')).toBe(true);
    expect(isValidIpOrCidr('10.0.0.0/33')).toBe(false);
    expect(isValidIpOrCidr('10.0.0.0/24/1')).toBe(false);
    expect(isValidIpOrCidr('300.1.1.1')).toBe(false);
    expect(isValidIpOrCidr('::1/128')).toBe(true);
  });
});
