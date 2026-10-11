'use client';

import { useCallback, useEffect, useState } from 'react';

/** Preferencia de interfaz recordada en este navegador (nunca datos sensibles ni tokens). */
export function usePersistentState<T extends string | boolean | number>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`erp.pref.${key}`);
      if (stored === null) return;
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed === typeof initial) setValue(parsed as T);
    } catch {
      // Valor corrupto o almacenamiento bloqueado: se usa el valor inicial.
    }
    // Solo al montar: el valor inicial es una constante del componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(`erp.pref.${key}`, JSON.stringify(next));
      } catch {
        // Sin almacenamiento disponible la preferencia dura hasta recargar.
      }
    },
    [key],
  );

  return [value, update];
}
