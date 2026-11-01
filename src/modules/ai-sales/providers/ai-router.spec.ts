import { toAnthropicMessages } from './anthropic.provider';
import { AiChatMessage, AiChatRequest, AiChatResult, AiProvider, AiProviderError, AllAiProvidersFailedError, classifyHttpFailure } from './ai-provider.types';
import { AiRouter, providersFromEnv } from './ai-router';
import { toGeminiContents } from './gemini.provider';
import { toOpenAiMessages } from './openai.provider';

const request: AiChatRequest = { system: 'sos un vendedor', messages: [{ role: 'user', content: 'hola' }], tools: [] };

class StubProvider implements AiProvider {
  calls = 0;
  constructor(
    readonly name: 'anthropic' | 'openai' | 'gemini',
    private readonly behavior: () => AiChatResult,
    readonly model = 'modelo',
  ) {}
  async chat(): Promise<AiChatResult> {
    this.calls += 1;
    return this.behavior();
  }
}

const ok = (provider: 'anthropic' | 'openai' | 'gemini') => (): AiChatResult => ({
  text: `respondió ${provider}`,
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  provider,
  model: 'modelo',
});
const fail = (provider: 'anthropic' | 'openai' | 'gemini', kind: AiProviderError['kind']) => (): AiChatResult => {
  throw new AiProviderError(provider, kind, kind);
};

describe('AiRouter (respaldo entre proveedores de IA)', () => {
  it('usa el primero cuando responde', async () => {
    const first = new StubProvider('anthropic', ok('anthropic'));
    const second = new StubProvider('openai', ok('openai'));
    const result = await new AiRouter([first, second]).chat(request);
    expect(result.provider).toBe('anthropic');
    expect(second.calls).toBe(0);
  });

  it('si se queda sin tokens salta al siguiente y lo deja en espera', async () => {
    let now = 1_000_000;
    const first = new StubProvider('anthropic', fail('anthropic', 'QUOTA'));
    const second = new StubProvider('openai', ok('openai'));
    const router = new AiRouter([first, second]);
    expect((await router.chat(request, () => now)).provider).toBe('openai');
    // Mientras está en espera no se lo vuelve a probar.
    expect((await router.chat(request, () => now)).provider).toBe('openai');
    expect(first.calls).toBe(1);
    expect(router.status(now)[0]).toMatchObject({ provider: 'anthropic', available: false, lastFailure: 'QUOTA' });
    // Pasada la espera (15 min) se lo prueba de nuevo.
    now += 16 * 60_000;
    await router.chat(request, () => now);
    expect(first.calls).toBe(2);
  });

  it('recorre la cadena completa (Anthropic → OpenAI → Gemini)', async () => {
    const providers = [
      new StubProvider('anthropic', fail('anthropic', 'RATE_LIMIT')),
      new StubProvider('openai', fail('openai', 'OVERLOADED')),
      new StubProvider('gemini', ok('gemini')),
    ];
    expect((await new AiRouter(providers).chat(request)).provider).toBe('gemini');
  });

  it('si todos fallan avisa para derivar a una persona', async () => {
    const router = new AiRouter([new StubProvider('anthropic', fail('anthropic', 'AUTH')), new StubProvider('openai', fail('openai', 'TIMEOUT'))]);
    await expect(router.chat(request)).rejects.toBeInstanceOf(AllAiProvidersFailedError);
  });

  it('un error genérico también pasa al siguiente', async () => {
    const broken = new StubProvider('anthropic', () => {
      throw new Error('boom');
    });
    expect((await new AiRouter([broken, new StubProvider('openai', ok('openai'))]).chat(request)).provider).toBe('openai');
  });

  it('arma la cadena desde el entorno, en orden y solo con claves', () => {
    const providers = providersFromEnv({ AI_PROVIDER_ORDER: 'gemini, anthropic,openai', GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', AI_OPENAI_MODEL: 'gpt-x' });
    expect(providers.map((provider) => `${provider.name}:${provider.model}`)).toEqual(['gemini:gemini-2.5-flash', 'openai:gpt-x']);
    expect(providersFromEnv({})).toEqual([]);
  });
});

describe('classifyHttpFailure', () => {
  it('distingue falta de crédito de límite por minuto', () => {
    expect(classifyHttpFailure(429, '{"error":{"code":"insufficient_quota"}}')).toBe('QUOTA');
    expect(classifyHttpFailure(429, '{"error":{"type":"rate_limit_error"}}')).toBe('RATE_LIMIT');
    expect(classifyHttpFailure(400, '{"error":{"message":"Your credit balance is too low"}}')).toBe('QUOTA');
    expect(classifyHttpFailure(402, '')).toBe('QUOTA');
    expect(classifyHttpFailure(401, '')).toBe('AUTH');
    expect(classifyHttpFailure(529, '')).toBe('OVERLOADED');
    expect(classifyHttpFailure(500, '')).toBe('SERVER');
    expect(classifyHttpFailure(400, '{"error":"bad schema"}')).toBe('BAD_REQUEST');
  });
});

describe('traducción del historial a cada API', () => {
  const history: AiChatMessage[] = [
    { role: 'user', content: 'busco yerba' },
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'buscar_productos', arguments: { texto: 'yerba' } }, { id: 't2', name: 'promociones_vigentes', arguments: {} }] },
    { role: 'tool', toolCallId: 't1', name: 'buscar_productos', content: '{"productos":[]}' },
    { role: 'tool', toolCallId: 't2', name: 'promociones_vigentes', content: '{"promociones":[]}' },
    { role: 'assistant', content: 'No tengo yerba hoy.' },
  ];

  it('Anthropic: resultados agrupados en un mensaje de usuario', () => {
    const messages = toAnthropicMessages(history);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: '{"productos":[]}' },
      { type: 'tool_result', tool_use_id: 't2', content: '{"promociones":[]}' },
    ]);
    // Si la ventana empieza con el asistente se antepone un turno de usuario.
    expect(toAnthropicMessages([{ role: 'assistant', content: 'hola' }])[0].role).toBe('user');
  });

  it('OpenAI: tool_calls con argumentos en texto y mensajes role=tool', () => {
    const messages = toOpenAiMessages('sistema', history);
    expect(messages[0]).toEqual({ role: 'system', content: 'sistema' });
    expect(messages[2]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'buscar_productos', arguments: '{"texto":"yerba"}' } }, { id: 't2' }] });
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: '{"productos":[]}' });
  });

  it('Gemini: functionCall / functionResponse por nombre', () => {
    const contents = toGeminiContents(history);
    expect(contents.map((content) => content.role)).toEqual(['user', 'model', 'user', 'model']);
    expect(contents[2].parts[0]).toEqual({ functionResponse: { name: 'buscar_productos', response: { productos: [] } } });
  });
});
