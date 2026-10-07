import { formatCuit, isValidCuit, isValidDni, normalizeTaxId } from './argentina-id';

describe('argentina-id', () => {
  it('acepta CUIT válidas con y sin guiones', () => {
    expect(isValidCuit('20-12345678-6')).toBe(true);
    expect(isValidCuit('20123456786')).toBe(true);
    expect(isValidCuit('30-71234567-1')).toBe(true);
    expect(isValidCuit('27176543219')).toBe(true);
  });

  it('rechaza dígito verificador, prefijo o longitud incorrectos', () => {
    expect(isValidCuit('20-12345678-5')).toBe(false);
    expect(isValidCuit('10-12345678-6')).toBe(false);
    expect(isValidCuit('2012345678')).toBe(false);
    expect(isValidCuit('20000000010')).toBe(false);
    expect(isValidCuit('abc')).toBe(false);
    expect(isValidCuit(20123456786)).toBe(false);
  });

  it('valida DNI de 7 u 8 dígitos', () => {
    expect(isValidDni('12.345.678')).toBe(true);
    expect(isValidDni('1234567')).toBe(true);
    expect(isValidDni('123456')).toBe(false);
    expect(isValidDni('00000000')).toBe(false);
  });

  it('normaliza y formatea', () => {
    expect(normalizeTaxId(' 20-12345678-6 ')).toBe('20123456786');
    expect(formatCuit('20123456786')).toBe('20-12345678-6');
  });
});
