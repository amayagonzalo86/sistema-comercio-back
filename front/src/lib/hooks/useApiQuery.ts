'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';

export interface ApiQueryState<T> {
  data: T | undefined;
  error: string | null;
  status: number | null;
  loading: boolean;
  /** Vuelve a pedir los datos (por ejemplo, después de guardar). */
  reload: () => void;
  /** Reemplaza los datos en memoria sin volver a pedirlos (actualización optimista). */
  setData: (updater: T | ((current: T | undefined) => T)) => void;
}

/**
 * Carga datos de la API y los vuelve a pedir cuando cambian las dependencias.
 * Cancela la petición anterior si las dependencias cambian antes de que termine (sin respuestas cruzadas).
 * Pasar `enabled = false` para esperar un dato previo (por ejemplo, la sucursal).
 */
export function useApiQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  enabled = true,
): ApiQueryState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [version, setVersion] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDataState(result);
        setStatus(200);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(caught));
        setStatus(caught instanceof ApiError ? caught.status : null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // Las dependencias las define quien llama; el fetcher se lee siempre actualizado desde la ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const setData = useCallback((updater: T | ((current: T | undefined) => T)) => {
    setDataState((current) => (typeof updater === 'function' ? (updater as (value: T | undefined) => T)(current) : updater));
  }, []);

  return { data, error, status, loading, reload, setData };
}
