import { csvCell } from './marketing.service';

describe('csvCell', () => {
  it('escapa comas, comillas y saltos de línea', () => {
    expect(csvCell('Pérez, Juan')).toBe('"Pérez, Juan"');
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell(null)).toBe('');
  });

  it('neutraliza fórmulas para evitar inyección en planillas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+5491100000000')).toBe("'+5491100000000");
  });
});
