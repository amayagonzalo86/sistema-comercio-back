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
  postJson,
} from './ai-provider.types';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

/** Claude (Anthropic Messages API). Los resultados de herramientas viajan como bloques tool_result del usuario. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl = 'https://api.anthropic.com',
  ) {}

  async chat(request: AiChatRequest, signal: AbortSignal): Promise<AiChatResult> {
    const data = asRecord(
      await postJson(
        this.name,
        `${this.baseUrl}/v1/messages`,
        { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: this.model,
          max_tokens: request.maxTokens ?? 1024,
          system: request.system,
          messages: toAnthropicMessages(request.messages),
          tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
        },
        signal,
      ),
    );
    const blocks = asArray(data.content).map(asRecord);
    if (blocks.length === 0 && data.stop_reason !== 'end_turn') {
      throw new AiProviderError(this.name, 'BAD_RESPONSE', 'Respuesta vacía del modelo.');
    }
    const text = blocks
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n')
      .trim();
    const toolCalls: AiToolCall[] = blocks
      .filter((block) => block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string')
      .map((block) => ({ id: block.id as string, name: block.name as string, arguments: asRecord(block.input) }));
    const usage = asRecord(data.usage);
    return {
      text,
      toolCalls,
      usage: { inputTokens: asNumber(usage.input_tokens), outputTokens: asNumber(usage.output_tokens) },
      provider: this.name,
      model: typeof data.model === 'string' ? data.model : this.model,
    };
  }
}

/** Traduce el historial neutral: alterna usuario/asistente y agrupa resultados de herramientas consecutivos. */
export function toAnthropicMessages(messages: AiChatMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];
  const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]): void => {
    if (blocks.length === 0) return;
    const last = result[result.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else result.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === 'user') {
      push('user', [{ type: 'text', text: message.content || '…' }]);
    } else if (message.role === 'tool') {
      push('user', [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }]);
    } else {
      const blocks: AnthropicBlock[] = [];
      if (message.content.trim()) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      push('assistant', blocks);
    }
  }
  if (result[0]?.role !== 'user') result.unshift({ role: 'user', content: [{ type: 'text', text: '(continúa la conversación)' }] });
  return result;
}
