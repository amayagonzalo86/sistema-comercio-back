import { Inject, Injectable, Logger } from '@nestjs/common';
import { AnthropicProvider } from './anthropic.provider';
import {
  AiChatRequest,
  AiChatResult,
  AiFailureKind,
  AiProvider,
  AiProviderError,
  AiProviderName,
  AllAiProvidersFailedError,
} from './ai-provider.types';
import { GeminiProvider } from './gemini.provider';
import { OpenAiProvider } from './openai.provider';

/** Lista ordenada de proveedores configurados (en e2e se reemplaza por un proveedor falso). */
export const AI_PROVIDERS = Symbol('AI_PROVIDERS');

const MINUTE = 60_000;

/** Cuánto descansa un proveedor después de cada tipo de falla antes de volver a probarlo. */
export const COOLDOWN_MS: Record<AiFailureKind, number> = {
  QUOTA: 15 * MINUTE,
  AUTH: 30 * MINUTE,
  RATE_LIMIT: 1 * MINUTE,
  OVERLOADED: 2 * MINUTE,
  SERVER: 2 * MINUTE,
  TIMEOUT: 2 * MINUTE,
  NETWORK: 2 * MINUTE,
  BAD_RESPONSE: 1 * MINUTE,
  // Un 400 suele ser propio de esa conversación (formato, longitud): se pasa al siguiente sin castigarlo.
  BAD_REQUEST: 0,
};

const DEFAULT_MODELS: Record<'anthropic' | 'openai' | 'gemini', string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-2.5-flash',
};

export interface AiProviderStatus {
  provider: AiProviderName;
  model: string;
  available: boolean;
  /** Hasta cuándo queda en espera (ISO) y por qué. */
  cooldownUntil: string | null;
  lastFailure: AiFailureKind | null;
}

/**
 * Construye los proveedores desde el entorno, en el orden de AI_PROVIDER_ORDER (por defecto anthropic,openai,gemini).
 * Los que no tienen clave se omiten: con una sola clave funciona igual, sin respaldo.
 */
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): AiProvider[] {
  const order = (env.AI_PROVIDER_ORDER || 'anthropic,openai,gemini')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name, index, list) => name && list.indexOf(name) === index);
  const providers: AiProvider[] = [];
  for (const name of order) {
    if (name === 'anthropic' && env.ANTHROPIC_API_KEY) {
      providers.push(new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic));
    } else if (name === 'openai' && env.OPENAI_API_KEY) {
      providers.push(new OpenAiProvider(env.OPENAI_API_KEY, env.AI_OPENAI_MODEL || DEFAULT_MODELS.openai, env.OPENAI_BASE_URL || undefined));
    } else if (name === 'gemini' && env.GEMINI_API_KEY) {
      providers.push(new GeminiProvider(env.GEMINI_API_KEY, env.AI_GEMINI_MODEL || DEFAULT_MODELS.gemini));
    }
  }
  return providers;
}

/**
 * Enrutador con respaldo: prueba los proveedores en orden. Si uno se queda sin tokens/crédito, limita
 * peticiones, está saturado o no responde, lo deja en espera un tiempo y pasa al siguiente.
 * Si todos fallan lanza AllAiProvidersFailedError y la conversación se deriva a una persona.
 */
@Injectable()
export class AiRouter {
  private readonly logger = new Logger(AiRouter.name);
  private readonly cooldowns = new Map<AiProviderName, { until: number; kind: AiFailureKind }>();
  private readonly timeoutMs: number;

  constructor(@Inject(AI_PROVIDERS) private readonly providers: AiProvider[]) {
    const configured = Number(process.env.AI_TIMEOUT_MS);
    this.timeoutMs = Number.isFinite(configured) && configured >= 5_000 ? configured : 45_000;
  }

  get configured(): boolean {
    return this.providers.length > 0;
  }

  status(now = Date.now()): AiProviderStatus[] {
    return this.providers.map((provider) => {
      const cooldown = this.cooldowns.get(provider.name);
      const waiting = cooldown && cooldown.until > now ? cooldown : null;
      return {
        provider: provider.name,
        model: provider.model,
        available: !waiting,
        cooldownUntil: waiting ? new Date(waiting.until).toISOString() : null,
        lastFailure: cooldown?.kind ?? null,
      };
    });
  }

  async chat(request: AiChatRequest, now: () => number = Date.now): Promise<AiChatResult> {
    const attempts: Array<{ provider: AiProviderName; kind: AiFailureKind | 'COOLDOWN'; message: string }> = [];
    const ready = this.providers.filter((provider) => (this.cooldowns.get(provider.name)?.until ?? 0) <= now());
    // Si todos están en espera se prueba igual el que termina antes (mejor un intento que derivar sin probar).
    const candidates = ready.length > 0 ? ready : [...this.providers].sort((a, b) => (this.cooldowns.get(a.name)?.until ?? 0) - (this.cooldowns.get(b.name)?.until ?? 0)).slice(0, 1);
    for (const provider of this.providers) {
      if (!candidates.includes(provider)) attempts.push({ provider: provider.name, kind: 'COOLDOWN', message: 'En espera por una falla reciente.' });
    }
    for (const provider of candidates) {
      try {
        const result = await provider.chat(request, AbortSignal.timeout(this.timeoutMs));
        this.cooldowns.delete(provider.name);
        return result;
      } catch (error) {
        const failure =
          error instanceof AiProviderError ? error : new AiProviderError(provider.name, 'BAD_RESPONSE', error instanceof Error ? error.message : String(error));
        attempts.push({ provider: provider.name, kind: failure.kind, message: failure.message });
        const pause = COOLDOWN_MS[failure.kind];
        if (pause > 0) this.cooldowns.set(provider.name, { until: now() + pause, kind: failure.kind });
        this.logger.warn(`IA ${provider.name} (${provider.model}) falló [${failure.kind}]: ${failure.message.slice(0, 200)} — se prueba el siguiente proveedor.`);
      }
    }
    throw new AllAiProvidersFailedError(attempts);
  }
}
