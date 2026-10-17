import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import { iterateSse } from './sse';
import type {
  AiProviderAdapter,
  ChatRequestOptions,
  ChatResult,
} from './types';

interface AnthropicConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
}

interface AnthropicResponse {
  model?: string;
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string };
  message?: AnthropicResponse;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Adapter untuk Anthropic Messages API (/v1/messages). */
export class AnthropicProvider implements AiProviderAdapter {
  readonly id = 'anthropic';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AnthropicConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private endpoint(): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}/messages`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
    };
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
            ...options.images.map((image) => ({
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mimeType,
                data: image.dataBase64,
              },
            })),
            { type: 'text', text: messages[index]!.content },
          ],
        };
        break;
      }
    }
    return {
      model: options.model,
      stream,
      max_tokens: options.maxTokens,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      system: options.systemPrompt,
      messages,
    };
  }

  private async ensureOk(response: Response): Promise<void> {
    if (response.ok) return;
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // abaikan — tetap laporkan status saja
    }
    throw new AppError(
      ERROR_CODES.aiUpstreamError,
      `Penyedia AI merespons ${response.status}. ${detail}`.trim(),
      502,
    );
  }

  private toResult(json: AnthropicResponse, fallbackModel: string): ChatResult {
    const content = (json.content ?? [])
      .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
      .join('')
      .trim();
    if (!content) {
      throw new AppError(ERROR_CODES.aiUpstreamError, 'Penyedia AI mengembalikan jawaban kosong.', 502);
    }
    return {
      content,
      model: json.model ?? fallbackModel,
      tokensIn: json.usage?.input_tokens ?? null,
      tokensOut: json.usage?.output_tokens ?? null,
    };
  }

  async chat(options: ChatRequestOptions): Promise<ChatResult> {
    const response = await this.fetchImpl(this.endpoint(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(options, false)),
      signal: options.signal,
    });
    await this.ensureOk(response);
    return this.toResult((await response.json()) as AnthropicResponse, options.model);
  }

  async *stream(options: ChatRequestOptions): AsyncGenerator<string, ChatResult> {
    const response = await this.fetchImpl(this.endpoint(), {
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
      const event = raw as AnthropicStreamEvent;
      if (
        event.type === 'content_block_delta' &&
        (event.delta?.type === 'text_delta' || event.delta?.type === 'text') &&
        event.delta.text
      ) {
        text += event.delta.text;
        yield event.delta.text;
      } else if (event.type === 'message_start' && event.message) {
        model = event.message.model ?? model;
        tokensIn = event.message.usage?.input_tokens ?? tokensIn;
        tokensOut = event.message.usage?.output_tokens ?? tokensOut;
      }
      const usage = event.usage;
      if (usage) {
        tokensIn = usage.input_tokens ?? tokensIn;
        tokensOut = usage.output_tokens ?? tokensOut;
      }
    }
    const content = text.trim();
    if (!content) {
      throw new AppError(ERROR_CODES.aiUpstreamError, 'Penyedia AI mengembalikan jawaban kosong.', 502);
    }
    return { content, model, tokensIn, tokensOut };
  }
}
