import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import { iterateSse } from './sse';
import type {
  AiProviderAdapter,
  ChatRequestOptions,
  ChatResult,
} from './types';

interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string | null;
  fetchImpl?: typeof fetch;
}

interface OpenAiChoiceMessage {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

interface OpenAiChunk {
  model?: string;
  choices?: Array<{
    delta?: { content?: string; role?: string };
    message?: OpenAiChoiceMessage;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function messageText(message: OpenAiChoiceMessage | undefined): string {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? '').join('');
  }
  return '';
}

/** Adapter untuk endpoint kompatibel OpenAI (/chat/completions): OpenRouter, OpenAI, Ollama. */
export class OpenAiCompatibleProvider implements AiProviderAdapter {
  readonly id = 'openai-compatible';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private endpoint(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  private body(options: ChatRequestOptions, stream: boolean): Record<string, unknown> {
    const messages: Array<{ role: string; content: unknown }> = options.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (options.images && options.images.length > 0) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]!.role !== 'user') continue;
        messages[index] = {
          role: 'user',
          content: [
            { type: 'text', text: messages[index]!.content },
            ...options.images.map((image) => ({
              type: 'image_url',
              image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` },
            })),
          ],
        };
        break;
      }
    }
    return {
      model: options.model,
      stream,
      // OpenRouter/OpenAI hanya mengirim usage pada stream bila diminta eksplisit.
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      max_tokens: options.maxTokens,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      messages: [{ role: 'system', content: options.systemPrompt }, ...messages],
    };
  }

  private async ensureOk(response: Response): Promise<void> {
    if (response.ok) return;
    let detail = '';
    try {
      const text = await response.text();
      detail = text.slice(0, 300);
    } catch {
      // abaikan — tetap laporkan status saja
    }
    throw new AppError(
      ERROR_CODES.aiUpstreamError,
      `Penyedia AI merespons ${response.status}. ${detail}`.trim(),
      502,
    );
  }

  async chat(options: ChatRequestOptions): Promise<ChatResult> {
    const response = await this.fetchImpl(this.endpoint('/chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(options, false)),
      signal: options.signal,
    });
    await this.ensureOk(response);
    const json = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: OpenAiChoiceMessage }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = messageText(json.choices?.[0]?.message).trim();
    if (!content) {
      throw new AppError(ERROR_CODES.aiUpstreamError, 'Penyedia AI mengembalikan jawaban kosong.', 502);
    }
    return {
      content,
      model: json.model ?? options.model,
      tokensIn: json.usage?.prompt_tokens ?? null,
      tokensOut: json.usage?.completion_tokens ?? null,
    };
  }

  async *stream(options: ChatRequestOptions): AsyncGenerator<string, ChatResult> {
    const response = await this.fetchImpl(this.endpoint('/chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(options, true)),
      signal: options.signal,
    });
    await this.ensureOk(response);

    let text = '';
    let model = options.model;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    for await (const raw of iterateSse(response)) {
      const chunk = raw as OpenAiChunk;
      if (typeof chunk.model === 'string' && chunk.model) model = chunk.model;
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        yield delta.content;
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? tokensIn;
        tokensOut = chunk.usage.completion_tokens ?? tokensOut;
      }
    }
    const content = text.trim();
    if (!content) {
      throw new AppError(ERROR_CODES.aiUpstreamError, 'Penyedia AI mengembalikan jawaban kosong.', 502);
    }
    return { content, model, tokensIn, tokensOut };
  }
}
