'use client';

import { useCallback } from 'react';
import { personsApi } from '../api/endpoints';
import type { Uuid } from '../api/types';
import { personName } from '../format';
import { useApiQuery } from './useApiQuery';

/**
 * Resuelve nombres de proveedores/clientes para tablas que solo traen el id.
 * Trae hasta 100 contactos (alcanza para la cartera de proveedores de una pyme) y cae a "Contacto" si falta.
 */
export function usePersonNames(role: 'suppliers' | 'customers'): (personId: Uuid | null | undefined) => string {
  const people = useApiQuery(() => personsApi.list({ role, status: 'all', limit: 100 }), [role]);
  return useCallback(
    (personId) => {
      if (!personId) return '—';
      const person = people.data?.items.find((item) => item.id === personId);
      return person ? personName(person) : 'Contacto';
    },
    [people.data],
  );
}
