import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CREATE_DOCUMENT_TOOL } from '../documents/document-spec';
import { GuardedProvider } from './guardrails/guarded-provider';
import { GuardrailsService } from './guardrails/guardrails.service';
import { AI_LIMITS, validateChatMessages } from './limits';
import { buildSystemPrompt, type PromptMode } from './prompts';
import { resolveProviderConfig, type AiProviderSettings } from './provider-resolver';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';
import type {
  AiProviderAdapter,
  ChatImageAttachment,
  ChatMessage,
  ChatRequestOptions,
  ChatResult,
  ChatTool,
  ChatToolCall,
  GuardScope,
} from './providers/types';

const MODE_TEMPERATURE: Record<PromptMode, number> = {
  second_brain: 0.3,
  counterpart: 0.7,
  subordinate: 0.2,
};

export interface GatewayChatOptions {
  mode: PromptMode;
  counterpartStyle?: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  extraContext?: string;
  images?: ChatImageAttachment[];
  /** Izinkan model membuat berkas lewat tool create_document. */
  documents?: boolean;
  /** Tool tambahan (konektor, delegasi, dll.) yang ditawarkan ke model. */
  tools?: ChatTool[];
  /** Ganti seluruh system prompt (dipakai agent pribadi). */
  systemPrompt?: string;
  /** Teks tambahan setelah system prompt bawaan (mis. aturan pemakaian tool). */
  toolRules?: string;
  /** Pemilik permintaan untuk kamus per percakapan dan audit Guardrails. */
  guard?: GuardScope;
}

/** Hasil eksekusi satu tool di dalam loop. */
export type ToolOutcome =
  | { status: 'ok'; content: string; data?: unknown }
  | { status: 'error'; content: string }
  /** Tool butuh persetujuan manusia; loop berhenti dan dapat dilanjutkan kemudian. */
  | { status: 'pending_approval'; content: string; approvalId: string; data?: unknown };

export interface ToolHandler {
  tool: ChatTool;
  /** Label ramah pengguna untuk jejak tool, mis. "Jalankan query · HSE Demo". */
  label?: string;
  /** Nama konektor sumber (untuk tampilan). */
  source?: string;
  execute(input: Record<string, unknown>, call: ChatToolCall): Promise<ToolOutcome>;
}

export type ToolLoopEvent =
  | { type: 'delta'; text: string }
  | { type: 'assistant'; content: string; toolCalls: ChatToolCall[] }
  | { type: 'tool_call'; call: ChatToolCall }
  | { type: 'tool_result'; call: ChatToolCall; outcome: ToolOutcome };

export interface ToolLoopResult {
  /** Teks jawaban akhir (giliran terakhir model). */
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Pesan baru yang ditambahkan loop (asisten + hasil tool), untuk disimpan/dilanjutkan. */
  appended: ChatMessage[];
  stop: 'completed' | 'pending_approval' | 'max_iterations';
  pending?: { call: ChatToolCall; approvalId: string; data?: unknown };
  iterations: number;
  /** Tool yang diminta model pada giliran terakhir tetapi tidak punya handler (mis. create_document). */
  unhandledToolCalls: ChatToolCall[];
  /** Tiap putaran memasking ulang data yang sama, jadi diambil nilai terbesar per kategori. */
  guardrails?: Record<string, number>;
}

export interface ToolLoopOptions extends GatewayChatOptions {
  handlers: ToolHandler[];
  maxIterations?: number;
  /** true: pakai stream penyedia sehingga delta teks dipancarkan sebagai event. */
  stream?: boolean;
}

const NOT_RUN_AFTER_PENDING =
  'Tidak dijalankan karena panggilan tool sebelumnya menunggu persetujuan manusia. Panggil ulang bila masih diperlukan setelah persetujuan.';

/** Potong hasil tool agar tidak membanjiri konteks model. */
export function clampToolResult(
  content: string,
  max: number = AI_LIMITS.maxToolResultLength,
): string {
  if (content.length <= max) return content;
  // Potong di batas baris bila dekat, agar nilai dalam baris terakhir tidak terbelah.
  const lastLine = content.lastIndexOf('\n', max);
  const end = lastLine >= max * 0.8 ? lastLine : max;
  return `${content.slice(0, end)}\n…[dipotong: ${content.length - end} karakter tidak ditampilkan]`;
}

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private adapter: AiProviderAdapter | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly guardrails?: GuardrailsService,
  ) {}

  private settings(): AiProviderSettings {
    return {
      aiProvider: this.config.get<string>('app.aiProvider', 'openrouter'),
      aiModel: this.config.get<string>('app.aiModel', ''),
      aiBaseUrl: this.config.get<string>('app.aiBaseUrl', ''),
      aiTimeoutMs: this.config.get<number>('app.aiTimeoutMs', 60000),
      openrouterApiKey: this.config.get<string | null>('app.openrouterApiKey', null),
      openaiApiKey: this.config.get<string | null>('app.openaiApiKey', null),
      anthropicApiKey: this.config.get<string | null>('app.anthropicApiKey', null),
      ollamaBaseUrl: this.config.get<string | null>('app.ollamaBaseUrl', null),
    };
  }

  /** Adapter di-cache per proses; kredensial hanya ada di memori server. */
  resolveAdapter(): AiProviderAdapter {
    if (this.adapter) return this.adapter;
    const resolved = resolveProviderConfig(this.settings());
    this.logger.log(
      `Penyedia AI aktif: ${resolved.provider} (model ${resolved.model}, batas waktu ${resolved.timeoutMs} ms)`,
    );
    const provider: AiProviderAdapter =
      resolved.adapter === 'anthropic'
        ? new AnthropicProvider({
            baseUrl: resolved.baseUrl,
            apiKey: resolved.apiKey ?? '',
          })
        : new OpenAiCompatibleProvider({ baseUrl: resolved.baseUrl, apiKey: resolved.apiKey });
    this.adapter = this.guardrails ? new GuardedProvider(provider, this.guardrails) : provider;
    return this.adapter;
  }

  activeModel(): string {
    return this.settings().aiModel;
  }

  private buildRequest(options: GatewayChatOptions): ChatRequestOptions {
    const tools = [...(options.documents ? [CREATE_DOCUMENT_TOOL] : []), ...(options.tools ?? [])];
    validateChatMessages(
      options.messages,
      tools.length > 0 ? AI_LIMITS.maxHistoryMessagesWithTools : AI_LIMITS.maxHistoryMessages,
    );
    const timeout = AbortSignal.timeout(this.settings().aiTimeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const basePrompt =
      options.systemPrompt ??
      buildSystemPrompt(
        options.mode,
        options.counterpartStyle,
        options.extraContext,
        options.documents === true,
      );
    return {
      model: this.settings().aiModel,
      systemPrompt: options.toolRules ? `${basePrompt}\n\n${options.toolRules}` : basePrompt,
      messages: options.messages,
      maxTokens:
        options.documents || (options.tools?.length ?? 0) > 0
          ? AI_LIMITS.maxOutputTokensWithDocuments
          : AI_LIMITS.maxOutputTokens,
      temperature: MODE_TEMPERATURE[options.mode],
      signal,
      ...(options.images && options.images.length > 0 ? { images: options.images } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...(options.guard ? { guard: options.guard } : {}),
    };
  }

  async chat(options: GatewayChatOptions): Promise<ChatResult> {
    return this.resolveAdapter().chat(this.buildRequest(options));
  }

  stream(options: GatewayChatOptions): AsyncGenerator<string, ChatResult> {
    return this.resolveAdapter().stream(this.buildRequest(options));
  }

  /**
   * Loop agentic: panggil model, jalankan tool yang diminta lewat `handlers`, umpankan
   * hasilnya kembali, ulangi sampai model menjawab tanpa tool, sebuah tool butuh
   * persetujuan, atau batas iterasi tercapai. Tool tanpa handler (mis. create_document)
   * dibiarkan untuk diproses pemanggil dan tidak memicu putaran berikutnya.
   */
  async *runToolLoop(options: ToolLoopOptions): AsyncGenerator<ToolLoopEvent, ToolLoopResult> {
    const handlers = new Map(options.handlers.map((handler) => [handler.tool.name, handler]));
    const maxIterations = options.maxIterations ?? AI_LIMITS.maxToolIterations;
    const tools = [...(options.tools ?? []), ...options.handlers.map((h) => h.tool)];
    const appended: ChatMessage[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let model = this.activeModel();
    const guardrails: Record<string, number> = {};
    const guardrailsResult = () =>
      Object.keys(guardrails).length > 0 ? { guardrails: { ...guardrails } } : {};

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      options.signal?.throwIfAborted();
      const request: GatewayChatOptions = {
        ...options,
        tools,
        messages: [...options.messages, ...appended],
        // Gambar hanya relevan untuk giliran pertama.
        ...(iteration > 1 ? { images: undefined } : {}),
      };
      let result: ChatResult;
      if (options.stream) {
        const generator = this.stream(request);
        for (;;) {
          const step = await generator.next();
          if (step.done) {
            result = step.value;
            break;
          }
          yield { type: 'delta', text: step.value };
        }
      } else {
        result = await this.chat(request);
      }
      tokensIn += result.tokensIn ?? 0;
      tokensOut += result.tokensOut ?? 0;
      model = result.model || model;
      for (const [category, count] of Object.entries(result.guardrails ?? {})) {
        guardrails[category] = Math.max(guardrails[category] ?? 0, count);
      }

      const calls = (result.toolCalls ?? []).filter((call) => handlers.has(call.name));
      const unhandledToolCalls = (result.toolCalls ?? []).filter(
        (call) => !handlers.has(call.name),
      );
      if (calls.length === 0) {
        return {
          content: result.content,
          model,
          tokensIn,
          tokensOut,
          appended,
          stop: 'completed',
          iterations: iteration,
          unhandledToolCalls,
          ...guardrailsResult(),
        };
      }

      // Pastikan setiap panggilan punya id (beberapa penyedia lokal tidak mengisinya).
      const normalized = calls.map((call, index) =>
        call.id ? call : { ...call, id: `call_${iteration}_${index}` },
      );
      appended.push({ role: 'assistant', content: result.content, toolCalls: normalized });
      yield { type: 'assistant', content: result.content, toolCalls: normalized };

      let pending: ToolLoopResult['pending'];
      for (const call of normalized) {
        if (pending) {
          appended.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: NOT_RUN_AFTER_PENDING,
            isError: true,
          });
          continue;
        }
        yield { type: 'tool_call', call };
        let outcome: ToolOutcome;
        try {
          outcome = await handlers.get(call.name)!.execute(call.input ?? {}, call);
        } catch (error) {
          outcome = {
            status: 'error',
            content: error instanceof Error ? error.message : 'Tool gagal dijalankan.',
          };
        }
        yield { type: 'tool_result', call, outcome };
        if (outcome.status === 'pending_approval') {
          pending = { call, approvalId: outcome.approvalId, data: outcome.data };
          continue;
        }
        appended.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: clampToolResult(outcome.content || '(kosong)'),
          ...(outcome.status === 'error' ? { isError: true } : {}),
        });
      }
      if (pending) {
        return {
          content: result.content,
          model,
          tokensIn,
          tokensOut,
          appended,
          stop: 'pending_approval',
          pending,
          iterations: iteration,
          unhandledToolCalls: [],
          ...guardrailsResult(),
        };
      }
    }
    return {
      content:
        'Batas langkah kerja tercapai sebelum tugas selesai. Persempit permintaan lalu coba lagi.',
      model,
      tokensIn,
      tokensOut,
      appended,
      stop: 'max_iterations',
      iterations: maxIterations,
      unhandledToolCalls: [],
      ...guardrailsResult(),
    };
  }

  /** Jalankan loop tanpa memproses event; kembalikan hasil akhirnya. */
  async drainToolLoop(
    options: ToolLoopOptions,
    onEvent?: (event: ToolLoopEvent) => void | Promise<void>,
  ): Promise<ToolLoopResult> {
    const generator = this.runToolLoop(options);
    for (;;) {
      const step = await generator.next();
      if (step.done) return step.value;
      if (onEvent) await onEvent(step.value);
    }
  }
}
