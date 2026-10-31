import { parsePersonSearch, personSearchPositional } from './person-search';

const columns = { firstName: 'p.first_name', lastName: 'p.last_name', nationalId: 'p.national_id', accountNumber: 'p.account_number' };

describe('búsqueda de personas', () => {
  it('separa palabras y dígitos (DNI con puntos o guiones)', () => {
    expect(parsePersonSearch('  Gómez   María ')).toEqual({ words: ['Gómez', 'María'], digits: '' });
    expect(parsePersonSearch('28.412.337')).toEqual({ words: [], digits: '28412337' });
    expect(parsePersonSearch('20-28412337-5')).toEqual({ words: [], digits: '20284123375' });
    expect(parsePersonSearch('perez 28412')).toEqual({ words: ['perez'], digits: '28412' });
  });

  it('apellido y nombre en cualquier orden: cada palabra en nombre o apellido', () => {
    const { sql, params } = personSearchPositional(columns, 'maria gomez');
    expect(sql).toBe('(((p.first_name LIKE ? OR p.last_name LIKE ?) AND (p.first_name LIKE ? OR p.last_name LIKE ?)))');
    expect(params).toEqual(['%maria%', '%maria%', '%gomez%', '%gomez%']);
  });

  it('DNI: busca el documento que lo contiene (también una CUIT) y el n.º de cuenta', () => {
    const { sql, params } = personSearchPositional(columns, '28.412.337');
    expect(sql).toBe('(p.national_id LIKE ? OR p.account_number = ?)');
    expect(params).toEqual(['%28412337%', 28412337]);
  });

  it('mixto: nombre y documento a la vez; escapa comodines', () => {
    const { sql, params } = personSearchPositional(columns, 'per%ez 2841');
    expect(sql).toContain('AND (p.national_id LIKE ? OR p.account_number = ?)');
    expect(params[0]).toBe('%per\\%ez%');
  });

  it('pocos dígitos: solo n.º de cuenta; vacío: sin condición', () => {
    expect(personSearchPositional(columns, '12')).toEqual({ sql: '(p.account_number = ?)', params: [12] });
    expect(personSearchPositional(columns, '   ').sql).toBeNull();
  });
});
