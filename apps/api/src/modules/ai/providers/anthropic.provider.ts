import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import { fetchProvider, iterateSse } from './sse';
import {
  parseToolInput,
  type AiProviderAdapter,
  type ChatMessage,
  type ChatRequestOptions,
  type ChatResult,
  type ChatToolCall,
} from './types';

interface AnthropicConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  model?: string;
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: { type?: string; text?: string; partial_json?: string };
  message?: AnthropicResponse;
  usage?: { input_tokens?: number; output_tokens?: number };
}

type AnthropicMessage = { role: 'user' | 'assistant'; content: unknown };

/**
 * Ubah pesan netral menjadi format Anthropic:
 * - asisten dengan toolCalls → blok `text` (opsional) + blok `tool_use`;
 * - pesan `tool` berurutan digabung menjadi satu pesan `user` berisi blok `tool_result`.
 * Pesan `system` di riwayat dilewati (system prompt dikirim terpisah).
 */
export function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: [
          ...(message.content.trim() ? [{ type: 'text', text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.input,
          })),
        ],
      });
      continue;
    }
    out.push({ role: message.role, content: message.content });
  }
  return out;
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
    const messages = toAnthropicMessages(options.messages);
    if (options.images && options.images.length > 0) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]!.role !== 'user' || typeof messages[index]!.content !== 'string') {
          continue;
        }
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
      ...(options.tools && options.tools.length > 0
        ? {
            tools: options.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema,
            })),
          }
        : {}),
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
    const toolCalls: ChatToolCall[] = (json.content ?? [])
      .filter((block) => block.type === 'tool_use' && block.name)
      .map((block) => ({
        id: block.id ?? '',
        name: block.name ?? '',
        input: block.input ?? {},
      }));
    if (!content && toolCalls.length === 0) {
      throw new AppError(
        ERROR_CODES.aiUpstreamError,
        'Penyedia AI mengembalikan jawaban kosong.',
        502,
      );
    }
    return {
      content,
      model: json.model ?? fallbackModel,
      tokensIn: json.usage?.input_tokens ?? null,
      tokensOut: json.usage?.output_tokens ?? null,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  async chat(options: ChatRequestOptions): Promise<ChatResult> {
    const response = await fetchProvider(this.fetchImpl, this.endpoint(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(options, false)),
      signal: options.signal,
    });
    await this.ensureOk(response);
    return this.toResult((await response.json()) as AnthropicResponse, options.model);
  }

  async *stream(options: ChatRequestOptions): AsyncGenerator<string, ChatResult> {
    const response = await fetchProvider(this.fetchImpl, this.endpoint(), {
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
    const pendingTools = new Map<number, { id: string; name: string; json: string }>();
    for await (const raw of iterateSse(response)) {
      const event = raw as AnthropicStreamEvent;
      if (
        event.type === 'content_block_start' &&
        event.content_block?.type === 'tool_use' &&
        typeof event.index === 'number'
      ) {
        pendingTools.set(event.index, {
          id: event.content_block.id ?? '',
          name: event.content_block.name ?? '',
          json: '',
        });
      } else if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'input_json_delta' &&
        typeof event.index === 'number'
      ) {
        const pending = pendingTools.get(event.index);
        if (pending) pending.json += event.delta.partial_json ?? '';
      } else if (
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
    const toolCalls: ChatToolCall[] = [...pendingTools.values()]
      .filter((tool) => tool.name)
      .map((tool) => ({ id: tool.id, name: tool.name, input: parseToolInput(tool.json) }));
    if (!content && toolCalls.length === 0) {
      throw new AppError(
        ERROR_CODES.aiUpstreamError,
        'Penyedia AI mengembalikan jawaban kosong.',
        502,
      );
    }
    return { content, model, tokensIn, tokensOut, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
  }
}
