import type { AccessTokenClaims, ApiErrorBody, RefreshResponse } from './types';

/**
 * Cliente HTTP del ERP.
 *
 * Seguridad de la sesión:
 * - El access token (15 min) vive SOLO en memoria de esta pestaña: nunca en localStorage/sessionStorage,
 *   así un script inyectado no puede robar una sesión persistente.
 * - El refresh token viaja en una cookie HttpOnly + SameSite=Strict que JavaScript no puede leer.
 *   La API está en el mismo origen (Next.js reenvía /api/v1), por eso alcanza con credentials: 'same-origin'.
 * - Ante un 401 se renueva el token una sola vez (single-flight: varias peticiones simultáneas comparten
 *   la misma renovación, lo que evita disparar la detección de reutilización del backend).
 */

export const API_BASE = '/api/v1';

const REQUEST_TIMEOUT_MS = 20_000;

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
const sessionListeners = new Set<(token: string | null) => void>();

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  readonly messages: string[];

  constructor(status: number, messages: string[], requestId: string | null) {
    super(messages.join(' · ') || `Error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.messages = messages;
    this.requestId = requestId;
  }

  /** Error de red o tiempo agotado: conviene reintentar con la MISMA Idempotency-Key. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of sessionListeners) listener(token);
}

/** Notifica cambios de sesión (login, renovación, cierre o expiración). Devuelve la función para desuscribirse. */
export function onSessionChange(listener: (token: string | null) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/** Lee los claims del JWT solo para la interfaz (rol, empresa). La autorización real la hace el backend. */
export function decodeClaims(token: string): AccessTokenClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const json = decodeURIComponent(
      Array.from(atob(base64), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { sub?: unknown }).sub !== 'string') return null;
    return parsed as AccessTokenClaims;
  } catch {
    return null;
  }
}

/** Clave para operaciones que mueven dinero o stock: reintentar con la misma clave no duplica la operación. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export type QueryValue = string | number | boolean | null | undefined;

export function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Para respuestas que no son JSON (por ejemplo, CSV). */
  responseType?: 'json' | 'text';
}

async function parseError(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await response.json()) as Partial<ApiErrorBody>;
  } catch {
    body = null;
  }
  const raw = body?.message;
  const messages = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [defaultMessage(response.status)];
  return new ApiError(response.status, messages, body?.requestId ?? response.headers.get('x-request-id'));
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Tu sesión venció. Ingresá nuevamente.';
  if (status === 403) return 'No tenés permiso para realizar esta acción.';
  if (status === 404) return 'No se encontró el recurso solicitado.';
  if (status === 409) return 'La operación entra en conflicto con otra ya registrada.';
  if (status === 429) return 'Demasiados intentos. Esperá unos segundos y volvé a probar.';
  if (status >= 500) return 'El servidor no pudo completar la operación. Intentá nuevamente.';
  return `Error ${status}`;
}

async function rawFetch(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Tiempo de espera agotado', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, ['No se pudo conectar con el servidor. Revisá la conexión e intentá nuevamente.'], null);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Renueva el access token con la cookie HttpOnly. Devuelve null si la sesión ya no es válida. */
export function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await rawFetch('/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!response.ok) {
          setAccessToken(null);
          return null;
        }
        const data = (await response.json()) as RefreshResponse;
        setAccessToken(data.accessToken);
        return data.accessToken;
      } catch {
        // Sin red no se descarta la sesión: el usuario puede reintentar cuando vuelva la conexión.
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, idempotencyKey, signal, responseType = 'json' } = options;
  const url = `${path}${buildQuery(query)}`;

  const send = (token: string | null) => {
    const headers: Record<string, string> = { Accept: responseType === 'json' ? 'application/json' : 'text/plain, text/csv' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return rawFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, signal);
  };

  let response = await send(accessToken);
  const isAuthEndpoint = path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
  if (response.status === 401 && !isAuthEndpoint) {
    const renewed = await refreshSession();
    if (renewed) response = await send(renewed);
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  if (responseType === 'text') return (await response.text()) as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) => apiRequest<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => apiRequest<T>(path, { method: 'POST', body: body ?? {}, idempotencyKey }),
  put: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/** Usado por el proveedor de sesión tras un login correcto o al cerrar sesión. */
export const sessionStore = {
  set: setAccessToken,
  clear: () => setAccessToken(null),
};

/** Mensaje legible para mostrar en pantalla a partir de cualquier error. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof DOMException && error.name === 'AbortError') return 'Operación cancelada.';
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado.';
}
