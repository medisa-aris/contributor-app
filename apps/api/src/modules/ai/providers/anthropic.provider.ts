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
  [key: string]: unknown;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface AnthropicResponse {
  model?: string;
  content?: AnthropicContentBlock[];
  usage?: AnthropicUsage;
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
}

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string; [key: string]: unknown };
  message?: AnthropicResponse;
  usage?: AnthropicUsage;
}

/** Header beta per fitur (§14.6). Nama beta wajib dicek ulang ke dokumentasi Anthropic saat berubah. */
export const ANTHROPIC_BETAS = {
  compaction: 'compact-2026-01-12',
  contextEditing: 'context-management-2025-06-27',
  taskBudget: 'task-budgets-2026-03-13',
  fallback: 'server-side-fallback-2026-07-01',
} as const;

/** Input token total = tanpa cache + baca cache + tulis cache (kuota menghitung semuanya, D12). */
function usageTotals(usage: AnthropicUsage | undefined) {
  if (!usage) return null;
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  return {
    tokensIn: usage.input_tokens === undefined ? null : usage.input_tokens + read + write,
    tokensOut: usage.output_tokens ?? null,
    cacheRead: read,
    cacheWrite: write,
  };
}

function refusalError(details: AnthropicResponse['stop_details']): AppError {
  return new AppError(
    ERROR_CODES.aiRefused,
    'Model menolak melanjutkan permintaan ini.',
    422,
    { category: details?.category ?? null },
  );
}

/**
 * Susun ulang blok konten dari event stream: content_block_start membawa bentuk awal blok,
 * content_block_delta menambahkan isinya (text, thinking, signature, input JSON, dsb.).
 * Delta bertipe baru ditangani generik: field string disambung, lainnya ditimpa.
 */
export class BlockAssembler {
  private readonly blocks = new Map<number, AnthropicContentBlock>();
  private readonly json = new Map<number, string>();

  start(index: number, block: AnthropicContentBlock): void {
    this.blocks.set(index, { ...block });
  }

  delta(index: number, delta: Record<string, unknown>): void {
    const block = this.blocks.get(index);
    if (!block) return;
    for (const [key, value] of Object.entries(delta)) {
      if (key === 'type') continue;
      if (key === 'partial_json') {
        this.json.set(index, (this.json.get(index) ?? '') + String(value));
      } else if (typeof value === 'string' && typeof block[key] === 'string') {
        block[key] = (block[key] as string) + value;
      } else {
        block[key] = value;
      }
    }
  }

  result(): AnthropicContentBlock[] {
    return [...this.blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, block]) =>
        block.type === 'tool_use' ? { ...block, input: parseToolInput(this.json.get(index) ?? '') } : block,
      );
  }
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
    // Blok asli (thinking, compaction) dikirim balik apa adanya; riwayat bersifat append-only.
    if (message.role === 'assistant' && Array.isArray(message.providerContent) && message.providerContent.length > 0) {
      out.push({ role: 'assistant', content: message.providerContent });
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

  private headers(options: ChatRequestOptions): Record<string, string> {
    const betas = this.betas(options);
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      ...(betas.length > 0 ? { 'anthropic-beta': betas.join(',') } : {}),
    };
  }

  private betas(options: ChatRequestOptions): string[] {
    const native = options.native ?? {};
    const betas: string[] = [];
    if (native.compaction) betas.push(ANTHROPIC_BETAS.compaction);
    else if (native.contextEditing) betas.push(ANTHROPIC_BETAS.contextEditing);
    if (native.taskBudget && native.taskBudget >= 20_000) betas.push(ANTHROPIC_BETAS.taskBudget);
    if (native.fallbackModels?.length) betas.push(ANTHROPIC_BETAS.fallback);
    return betas;
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
    const native = options.native ?? {};
    const outputConfig = {
      ...(native.effort ? { effort: native.effort } : {}),
      ...(native.taskBudget && native.taskBudget >= 20_000
        ? { task_budget: { type: 'tokens', total: Math.floor(native.taskBudget) } }
        : {}),
    };
    return {
      model: options.model,
      stream,
      max_tokens: options.maxTokens,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      // Prompt caching: system prompt stabil di-cache eksplisit, ekor percakapan otomatis.
      system: native.promptCache
        ? [{ type: 'text', text: options.systemPrompt, cache_control: { type: 'ephemeral' } }]
        : options.systemPrompt,
      ...(native.promptCache ? { cache_control: { type: 'ephemeral' } } : {}),
      ...(native.thinking ? { thinking: { type: 'adaptive' } } : {}),
      ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
      ...(native.compaction
        ? { context_management: { edits: [{ type: 'compact_20260112' }] } }
        : native.contextEditing
          ? { context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] } }
          : {}),
      ...(native.fallbackModels?.length ? { fallbacks: native.fallbackModels.map((model) => ({ model })) } : {}),
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
    if (json.stop_reason === 'refusal') throw refusalError(json.stop_details);
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
    const usage = usageTotals(json.usage);
    return {
      content,
      model: json.model ?? fallbackModel,
      tokensIn: usage?.tokensIn ?? null,
      tokensOut: usage?.tokensOut ?? null,
      ...(usage ? { cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(json.content ? { providerContent: json.content } : {}),
      ...(json.stop_reason ? { stopReason: json.stop_reason } : {}),
    };
  }

  async chat(options: ChatRequestOptions): Promise<ChatResult> {
    const response = await fetchProvider(this.fetchImpl, this.endpoint(), {
      method: 'POST',
      headers: this.headers(options),
      body: JSON.stringify(this.body(options, false)),
      signal: options.signal,
    });
    await this.ensureOk(response);
    return this.toResult((await response.json()) as AnthropicResponse, options.model);
  }

  async *stream(options: ChatRequestOptions): AsyncGenerator<string, ChatResult> {
    const response = await fetchProvider(this.fetchImpl, this.endpoint(), {
      method: 'POST',
      headers: this.headers(options),
      body: JSON.stringify(this.body(options, true)),
      signal: options.signal,
    });
    await this.ensureOk(response);

    let text = '';
    let model = options.model;
    let usage: AnthropicUsage = {};
    let stopReason: string | undefined;
    const blocks = new BlockAssembler();
    for await (const raw of iterateSse(response)) {
      const event = raw as AnthropicStreamEvent;
      if (event.type === 'content_block_start' && event.content_block && typeof event.index === 'number') {
        blocks.start(event.index, event.content_block);
      } else if (event.type === 'content_block_delta' && event.delta) {
        if (typeof event.index === 'number') blocks.delta(event.index, event.delta);
        if ((event.delta.type === 'text_delta' || event.delta.type === 'text') && event.delta.text) {
          text += event.delta.text;
          yield event.delta.text;
        }
      } else if (event.type === 'message_start' && event.message) {
        model = event.message.model ?? model;
        usage = { ...usage, ...event.message.usage };
      } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
      if (event.usage) usage = { ...usage, ...event.usage };
    }
    if (stopReason === 'refusal') throw refusalError(null);
    // Blok hanya dipakai untuk diputar ulang bila lengkap (stream tanpa index tidak bisa dirakit).
    const assembled = blocks.result();
    const providerContent = text && !assembled.some((b) => b.type === 'text') ? undefined : assembled;
    const content = text.trim();
    const toolCalls: ChatToolCall[] = assembled
      .filter((block) => block.type === 'tool_use' && block.name)
      .map((block) => ({ id: block.id ?? '', name: block.name ?? '', input: block.input ?? {} }));
    if (!content && toolCalls.length === 0) {
      throw new AppError(
        ERROR_CODES.aiUpstreamError,
        'Penyedia AI mengembalikan jawaban kosong.',
        502,
      );
    }
    const totals = usageTotals(usage);
    return {
      content,
      model,
      tokensIn: totals?.tokensIn ?? null,
      tokensOut: totals?.tokensOut ?? null,
      ...(totals ? { cacheReadTokens: totals.cacheRead, cacheWriteTokens: totals.cacheWrite } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(providerContent ? { providerContent } : {}),
      ...(stopReason ? { stopReason } : {}),
    };
  }
}
