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

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Google Gemini (generateContent). Gemini no numera las llamadas a funciones: se generan ids locales. */
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  ) {}

  async chat(request: AiChatRequest, signal: AbortSignal): Promise<AiChatResult> {
    const data = asRecord(
      await postJson(
        this.name,
        `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
        { 'x-goog-api-key': this.apiKey },
        {
          systemInstruction: { parts: [{ text: request.system }] },
          contents: toGeminiContents(request.messages),
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            },
          ],
          generationConfig: { maxOutputTokens: request.maxTokens ?? 1024 },
        },
        signal,
      ),
    );
    const candidate = asRecord(asArray(data.candidates)[0]);
    if (Object.keys(candidate).length === 0) {
      const feedback = asRecord(data.promptFeedback);
      throw new AiProviderError(this.name, 'BAD_RESPONSE', `Gemini no devolvió respuesta${feedback.blockReason ? ` (${String(feedback.blockReason)})` : ''}.`);
    }
    const parts = asArray(asRecord(candidate.content).parts).map(asRecord);
    const text = parts
      .filter((part) => typeof part.text === 'string' && part.thought !== true)
      .map((part) => part.text as string)
      .join('\n')
      .trim();
    const toolCalls: AiToolCall[] = parts
      .map((part) => asRecord(part.functionCall))
      .filter((call) => typeof call.name === 'string')
      .map((call, index) => ({ id: `gemini-${Date.now().toString(36)}-${index}`, name: call.name as string, arguments: asRecord(call.args) }));
    const usage = asRecord(data.usageMetadata);
    return {
      text,
      toolCalls,
      usage: { inputTokens: asNumber(usage.promptTokenCount), outputTokens: asNumber(usage.candidatesTokenCount) },
      provider: this.name,
      model: typeof data.modelVersion === 'string' ? data.modelVersion : this.model,
    };
  }
}

export function toGeminiContents(messages: AiChatMessage[]): GeminiContent[] {
  const result: GeminiContent[] = [];
  const push = (role: 'user' | 'model', parts: GeminiPart[]): void => {
    if (parts.length === 0) return;
    const last = result[result.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else result.push({ role, parts });
  };
  for (const message of messages) {
    if (message.role === 'user') push('user', [{ text: message.content || '…' }]);
    else if (message.role === 'tool') {
      let response: Record<string, unknown>;
      try {
        const parsed = JSON.parse(message.content) as unknown;
        response = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { resultado: parsed };
      } catch {
        response = { resultado: message.content };
      }
      push('user', [{ functionResponse: { name: message.name, response } }]);
    } else {
      const parts: GeminiPart[] = [];
      if (message.content.trim()) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.arguments } });
      push('model', parts);
    }
  }
  if (result[0]?.role !== 'user') result.unshift({ role: 'user', parts: [{ text: '(continúa la conversación)' }] });
  return result;
}
