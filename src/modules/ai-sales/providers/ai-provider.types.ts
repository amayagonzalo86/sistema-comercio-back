/**
 * Tipos neutrales para hablar con cualquier proveedor de IA (Anthropic, OpenAI, Gemini).
 * El agente trabaja solo con estos tipos; cada adaptador los traduce al formato de su API.
 */

export type AiProviderName = 'anthropic' | 'openai' | 'gemini' | 'fake';

/** Esquema JSON (subconjunto común a los tres proveedores) de los parámetros de una herramienta. */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema & { type: 'object' };
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AiChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface AiChatRequest {
  system: string;
  messages: AiChatMessage[];
  tools: AiToolDefinition[];
  maxTokens?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiChatResult {
  text: string;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  provider: AiProviderName;
  model: string;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly model: string;
  chat(request: AiChatRequest, signal: AbortSignal): Promise<AiChatResult>;
}

/**
 * Por qué falló un proveedor. Decide cuánto tiempo se lo deja descansar antes de volver a probarlo:
 * sin crédito/tokens (QUOTA) o credenciales inválidas (AUTH) descansan más que un pico de tráfico.
 */
export type AiFailureKind = 'QUOTA' | 'RATE_LIMIT' | 'OVERLOADED' | 'AUTH' | 'TIMEOUT' | 'SERVER' | 'NETWORK' | 'BAD_REQUEST' | 'BAD_RESPONSE';

export class AiProviderError extends Error {
  constructor(
    readonly provider: AiProviderName,
    readonly kind: AiFailureKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Todos los proveedores configurados fallaron (o están en espera): la conversación pasa a un humano. */
export class AllAiProvidersFailedError extends Error {
  constructor(readonly attempts: Array<{ provider: AiProviderName; kind: AiFailureKind | 'COOLDOWN'; message: string }>) {
    super(`Ningún proveedor de IA respondió (${attempts.map((attempt) => `${attempt.provider}: ${attempt.kind}`).join(', ') || 'sin proveedores configurados'}).`);
    this.name = 'AllAiProvidersFailedError';
  }
}

const QUOTA_HINTS = /(insufficient_quota|quota|credit balance|billing|exceeded your current|resource_exhausted|out of credits|payment required)/i;

/** Clasifica una respuesta HTTP fallida de un proveedor. */
export function classifyHttpFailure(status: number, body: string): AiFailureKind {
  if (status === 402) return 'QUOTA';
  // 429 puede ser «muchas peticiones por minuto» o «se acabó la cuota/el crédito»: lo dice el cuerpo.
  if (status === 429) return QUOTA_HINTS.test(body) ? 'QUOTA' : 'RATE_LIMIT';
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 529 || status === 503) return 'OVERLOADED';
  if (status >= 500) return 'SERVER';
  // Anthropic responde 400 cuando no queda saldo ("Your credit balance is too low").
  if (QUOTA_HINTS.test(body)) return 'QUOTA';
  return 'BAD_REQUEST';
}

/** Hace la petición HTTP y traduce cortes de red, tiempo agotado y errores HTTP a AiProviderError. */
export async function postJson(
  provider: AiProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AiProviderError(provider, 'TIMEOUT', 'El proveedor de IA no respondió a tiempo.');
    }
    throw new AiProviderError(provider, 'NETWORK', `No se pudo conectar con el proveedor de IA: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  if (!response.ok) {
    const kind = classifyHttpFailure(response.status, text);
    throw new AiProviderError(provider, kind, `HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiProviderError(provider, 'BAD_RESPONSE', 'El proveedor de IA devolvió una respuesta que no es JSON.');
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Parsea los argumentos de una herramienta (OpenAI los manda como texto JSON). */
export function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return asRecord(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return asRecord(raw);
}
