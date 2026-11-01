import {
  AiChatMessage,
  AiChatRequest,
  AiChatResult,
  AiProvider,
  AiProviderError,
  AiToolCall,
  asArray,
  asNumber,
  asRecord,
  parseArguments,
  postJson,
} from './ai-provider.types';

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/** OpenAI Chat Completions (también sirve para APIs compatibles cambiando la URL base). */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  async chat(request: AiChatRequest, signal: AbortSignal): Promise<AiChatResult> {
    const data = asRecord(
      await postJson(
        this.name,
        `${this.baseUrl}/chat/completions`,
        { authorization: `Bearer ${this.apiKey}` },
        {
          model: this.model,
          max_completion_tokens: request.maxTokens ?? 1024,
          messages: toOpenAiMessages(request.system, request.messages),
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
        },
        signal,
      ),
    );
    const choice = asRecord(asArray(data.choices)[0]);
    const message = asRecord(choice.message);
    if (Object.keys(message).length === 0) {
      throw new AiProviderError(this.name, 'BAD_RESPONSE', 'Respuesta sin mensaje del modelo.');
    }
    const toolCalls: AiToolCall[] = asArray(message.tool_calls)
      .map(asRecord)
      .filter((call) => typeof call.id === 'string')
      .map((call) => {
        const fn = asRecord(call.function);
        return { id: call.id as string, name: String(fn.name ?? ''), arguments: parseArguments(fn.arguments) };
      })
      .filter((call) => call.name !== '');
    const usage = asRecord(data.usage);
    return {
      text: typeof message.content === 'string' ? message.content.trim() : '',
      toolCalls,
      usage: { inputTokens: asNumber(usage.prompt_tokens), outputTokens: asNumber(usage.completion_tokens) },
      provider: this.name,
      model: typeof data.model === 'string' ? data.model : this.model,
    };
  }
}

export function toOpenAiMessages(system: string, messages: AiChatMessage[]): OpenAiMessage[] {
  const result: OpenAiMessage[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') result.push({ role: 'user', content: message.content });
    else if (message.role === 'tool') result.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
    else {
      const calls = message.toolCalls ?? [];
      result.push({
        role: 'assistant',
        content: message.content || (calls.length > 0 ? null : '…'),
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
    }
  }
  return result;
}
