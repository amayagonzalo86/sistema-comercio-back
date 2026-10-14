'use client';

import { useId } from 'react';

/** Las 24 jurisdicciones argentinas; el campo acepta otro valor (clientes del exterior). */
export const ARGENTINE_PROVINCES = [
  'Buenos Aires',
  'Ciudad Autónoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const;

/** Campo de provincia con sugerencias. */
export function ProvinceInput({ value, onChange, id }: { value: string; onChange: (value: string) => void; id?: string }) {
  const listId = useId();
  return (
    <>
      <input id={id} className="form-control" list={listId} value={value} maxLength={60} onChange={(event) => onChange(event.target.value)} autoComplete="off" />
      <datalist id={listId}>
        {ARGENTINE_PROVINCES.map((province) => (
          <option key={province} value={province} />
        ))}
      </datalist>
    </>
  );
}
