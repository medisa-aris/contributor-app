import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CREATE_DOCUMENT_TOOL } from '../documents/document-spec';
import {
  CONTEXT_LIMITS,
  COMPACTION_PROMPT,
  clearOldToolResults,
  compactionCut,
  estimateTokens,
  transcriptText,
  type ContextCache,
} from './context-budget';
import { AI_LIMITS, validateChatMessages } from './limits';
import { buildSystemPrompt, type PromptMode } from './prompts';
import { ModelAccessService, type AuthorizedCall } from './models/model-access.service';
import { ModelCatalogService } from './models/model-catalog.service';
import { ProviderRegistryService } from './models/provider-registry.service';
import { UsageLedgerService, type AiUsageSource } from './models/usage-ledger.service';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';
import type {
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
  /** Blok "Memori yang relevan" dari memori terpusat, ditambahkan setelah system prompt. */
  memoryContext?: string;
  /** id model penyedia untuk panggilan sistem (mis. model ekstraksi memori); dicocokkan ke katalog. */
  model?: string;
  /** Model katalog yang diminta eksplisit; wajib diizinkan untuk pengguna. */
  modelId?: string | null;
  /** Agent yang melakukan panggilan (model agent dan izin agent). */
  agentId?: string;
  /** Sumber pemakaian untuk buku besar; bawaan diturunkan dari `guard`. */
  usageSource?: AiUsageSource;
  /**
   * Kerja panjang (§14): batas diam stream + batas per panggilan menggantikan AI_TIMEOUT_MS,
   * riwayat tidak dibatasi jumlah pesan, dan konteks dijaga lewat pembersihan/ringkasan.
   */
  longRun?: boolean;
  /** Cache ringkasan konteks yang dipakai ulang antar-iterasi loop. */
  contextCache?: ContextCache;
  /** Dipanggil saat konteks diringkas (untuk event "Konteks diringkas"). */
  onCompaction?: (info: { cut: number; tokensBefore: number }) => void;
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
  | { type: 'tool_result'; call: ChatToolCall; outcome: ToolOutcome }
  /** Pemakaian satu panggilan model di dalam loop (untuk anggaran kerja panjang). */
  | { type: 'usage'; tokensIn: number; tokensOut: number };

export interface ToolLoopResult {
  /** Teks jawaban akhir (giliran terakhir model). */
  content: string;
  model: string;
  /** Model katalog yang menjalankan loop. */
  modelId?: string;
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
  private readonly embedders = new Map<string, OpenAiCompatibleProvider>();

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistryService,
    private readonly catalog: ModelCatalogService,
    private readonly access: ModelAccessService,
    private readonly ledger: UsageLedgerService,
  ) {}

  /** id model bawaan dari env; hanya nilai awal tampilan sebelum hasil panggilan tersedia. */
  activeModel(): string {
    return this.config.get<string>('app.aiModel', '');
  }

  /**
   * Embedding teks lewat penyedia model bawaan bila kompatibel OpenAI. null bila penyedia
   * itu tidak punya endpoint embedding (Anthropic). Pemanggil wajib menyaring data pribadi.
   */
  async embed(texts: string[], model: string, signal?: AbortSignal): Promise<number[][] | null> {
    const defaultModel = await this.catalog.defaultModel();
    if (defaultModel.provider === 'anthropic') return null;
    const settings = this.registry.settings(defaultModel.provider);
    if (!settings.configured) return null;
    let embedder = this.embedders.get(settings.code);
    if (!embedder) {
      embedder = new OpenAiCompatibleProvider({ baseUrl: settings.baseUrl, apiKey: settings.apiKey });
      this.embedders.set(settings.code, embedder);
    }
    const timeout = AbortSignal.timeout(this.registry.timeoutMs());
    return embedder.embed(texts, model, signal ? AbortSignal.any([timeout, signal]) : timeout);
  }

  private usageSource(options: GatewayChatOptions): AiUsageSource {
    if (options.usageSource) return options.usageSource;
    if (options.guard?.conversationId) return 'conversation';
    if (options.guard?.taskId) return 'task';
    return 'system';
  }

  /** Tentukan model (dan periksa izin/kuota), lalu susun permintaan untuk adapter penyedianya. */
  private async prepare(
    options: GatewayChatOptions,
  ): Promise<{ call: AuthorizedCall; request: ChatRequestOptions; idle: AbortController | null }> {
    const tools = [...(options.documents ? [CREATE_DOCUMENT_TOOL] : []), ...(options.tools ?? [])];
    validateChatMessages(
      options.messages,
      options.longRun
        ? Number.MAX_SAFE_INTEGER
        : tools.length > 0
          ? AI_LIMITS.maxHistoryMessagesWithTools
          : AI_LIMITS.maxHistoryMessages,
    );
    const images = options.images && options.images.length > 0 ? options.images : undefined;
    const call = await this.access.authorize({
      userId: options.guard?.userId ?? null,
      source: this.usageSource(options),
      ...(options.guard?.conversationId ? { conversationId: options.guard.conversationId } : {}),
      ...(options.guard?.taskId ? { taskId: options.guard.taskId } : {}),
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      ...(options.model ? { modelKey: options.model } : {}),
      needs: { tools: tools.length > 0, vision: Boolean(images) },
    });
    const longRun = options.longRun ? this.registry.longRunTimeouts() : null;
    const idle = longRun ? new AbortController() : null;
    const timeout = AbortSignal.timeout(longRun ? longRun.callMs : this.registry.timeoutMs());
    const signal = AbortSignal.any([timeout, ...(options.signal ? [options.signal] : []), ...(idle ? [idle.signal] : [])]);
    const basePrompt =
      options.systemPrompt ??
      buildSystemPrompt(
        options.mode,
        options.counterpartStyle,
        options.extraContext,
        options.documents === true,
      );
    const imageNote =
      images && call.dropImages
        ? `Catatan sistem: ${images.length} gambar terlampir tidak dikirim karena model ${call.model.displayName} tidak mendukung gambar.`
        : undefined;
    const systemPrompt = [basePrompt, options.memoryContext, options.toolRules, imageNote]
      .filter((part): part is string => Boolean(part?.trim()))
      .join('\n\n');
    const baseMax =
      options.documents || (options.tools?.length ?? 0) > 0
        ? AI_LIMITS.maxOutputTokensWithDocuments
        : AI_LIMITS.maxOutputTokens;
    const messages =
      options.longRun || options.contextCache
        ? await this.fitContext(call, systemPrompt, options.messages, options, signal)
        : options.messages;
    return {
      call,
      idle,
      request: {
        model: call.model.modelKey,
        systemPrompt,
        messages,
        maxTokens: call.maxTokens === null ? baseMax : Math.max(1, Math.min(baseMax, call.maxTokens)),
        // Model Claude terbaru menolak parameter sampling (400); hanya dikirim bila diterima.
        ...(call.model.acceptsSamplingParams ? { temperature: MODE_TEMPERATURE[options.mode] } : {}),
        signal,
        ...(images && !call.dropImages ? { images } : {}),
        ...(tools.length > 0 ? { tools } : {}),
        ...(options.guard ? { guard: options.guard } : {}),
      },
    };
  }

  /**
   * Jaga permintaan di bawah jendela konteks model (§14.6): bersihkan hasil tool lama di atas
   * 50%, ringkas bagian awal di atas 75%. Transkrip asli tidak berubah.
   */
  private async fitContext(
    call: AuthorizedCall,
    systemPrompt: string,
    messages: ChatMessage[],
    options: GatewayChatOptions,
    signal: AbortSignal,
  ): Promise<ChatMessage[]> {
    const window = call.model.contextWindow ?? CONTEXT_LIMITS.defaultWindow;
    const before = estimateTokens(messages, systemPrompt);
    if (before <= window * CONTEXT_LIMITS.clearToolResultsAt) return messages;
    let fitted = clearOldToolResults(messages);
    if (estimateTokens(fitted, systemPrompt) <= window * CONTEXT_LIMITS.compactAt) return fitted;
    const cut = compactionCut(fitted);
    if (cut === 0) return fitted;
    const cache = options.contextCache;
    let summary = cache?.cut === cut ? cache.summary : undefined;
    if (!summary) {
      // Bagian yang diringkas dipotong dari belakang agar permintaan ringkasan sendiri muat.
      const text = transcriptText(fitted.slice(0, cut)).slice(-Math.floor(window * 0.6 * 4));
      const request: ChatRequestOptions = {
        model: call.model.modelKey,
        systemPrompt: COMPACTION_PROMPT,
        messages: [{ role: 'user', content: text }],
        maxTokens: 4000,
        signal,
      };
      const result = await call.adapter.chat(request);
      await this.record(call, request, result);
      summary = result.content.trim();
      if (cache) {
        cache.cut = cut;
        cache.summary = summary;
        cache.compactions += 1;
      }
      options.onCompaction?.({ cut, tokensBefore: before });
    }
    fitted = [{ role: 'user', content: `Ringkasan kerja sejauh ini:\n${summary}` }, ...fitted.slice(cut)];
    return fitted;
  }

  /** Satu baris buku besar per panggilan; token diestimasi bila penyedia tidak melaporkannya. */
  private async record(call: AuthorizedCall, request: ChatRequestOptions, result: ChatResult): Promise<void> {
    const estimated = result.tokensIn === null || result.tokensOut === null;
    const inputChars =
      request.systemPrompt.length + request.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    await this.ledger.record({
      userId: call.userId,
      modelId: call.model.id,
      provider: call.model.provider,
      modelKey: call.model.modelKey,
      source: call.source,
      sourceId: call.sourceId,
      agentId: call.agentId,
      tokensIn: result.tokensIn ?? Math.ceil(inputChars / 4),
      tokensOut: result.tokensOut ?? Math.ceil(result.content.length / 4),
      estimated,
    });
  }

  async chat(options: GatewayChatOptions): Promise<ChatResult> {
    const { call, request } = await this.prepare(options);
    const result = await call.adapter.chat(request);
    await this.record(call, request, result);
    return { ...result, modelId: call.model.id };
  }

  async *stream(options: GatewayChatOptions): AsyncGenerator<string, ChatResult> {
    const { call, request, idle } = await this.prepare(options);
    const inner = call.adapter.stream(request);
    const idleMs = idle ? this.registry.longRunTimeouts().idleMs : 0;
    for (;;) {
      // Kerja panjang: putus hanya bila penyedia diam terlalu lama, bukan karena total durasi.
      const timer = idle ? setTimeout(() => idle.abort(new Error('Penyedia AI tidak mengirim data terlalu lama.')), idleMs) : null;
      let step: IteratorResult<string, ChatResult>;
      try {
        step = await inner.next();
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (step.done) {
        await this.record(call, request, step.value);
        return { ...step.value, modelId: call.model.id };
      }
      yield step.value;
    }
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
    let modelId: string | undefined;
    const guardrails: Record<string, number> = {};
    const guardrailsResult = () =>
      Object.keys(guardrails).length > 0 ? { guardrails: { ...guardrails } } : {};

    const contextCache = options.contextCache ?? (options.longRun ? { compactions: 0 } : undefined);
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      options.signal?.throwIfAborted();
      const request: GatewayChatOptions = {
        ...options,
        ...(contextCache ? { contextCache } : {}),
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
      yield { type: 'usage', tokensIn: result.tokensIn ?? 0, tokensOut: result.tokensOut ?? 0 };
      model = result.model || model;
      modelId = result.modelId ?? modelId;
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
          ...(modelId ? { modelId } : {}),
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
          ...(modelId ? { modelId } : {}),
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
      ...(modelId ? { modelId } : {}),
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
