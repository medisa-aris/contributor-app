export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Pesan percakapan netral-penyedia.
 * - `assistant` dapat membawa `toolCalls` (permintaan tool dari model pada giliran itu).
 * - `tool` membawa hasil satu tool: `toolCallId` wajib, `content` berisi hasilnya.
 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  /**
   * Blok konten asli penyedia untuk pesan asisten (mis. thinking dan compaction Claude).
   * Dikirim balik apa adanya ke penyedia yang sama; penyedia lain mengabaikannya.
   */
  providerContent?: unknown[];
}

export interface ChatImageAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

/** Definisi tool (function calling) yang ditawarkan ke model. */
export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema objek untuk argumen tool. */
  inputSchema: Record<string, unknown>;
  /** Guardrails tidak mengembalikan data asli pada argumen tool ini (mis. layanan pihak ketiga). */
  keepMasked?: boolean;
}

export interface ChatToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Pemilik permintaan LLM untuk kamus dan audit Guardrails. */
export interface GuardScope {
  userId?: string;
  conversationId?: string;
  taskId?: string;
}

export interface ChatRequestOptions {
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
  images?: ChatImageAttachment[];
  tools?: ChatTool[];
  guard?: GuardScope;
  /** Fitur bawaan penyedia untuk kerja panjang (§14.6); diisi gateway dari kemampuan model. */
  native?: NativeOptions;
}

export interface NativeOptions {
  effort?: string;
  /** Adaptive thinking (Claude). */
  thinking?: boolean;
  /** Ringkasan konteks di sisi server (Claude compaction). */
  compaction?: boolean;
  /** Pembersihan hasil tool lama di sisi server (Claude context editing). */
  contextEditing?: boolean;
  /** Anggaran token agar model mengatur langkahnya sendiri (Claude task budget). */
  taskBudget?: number;
  promptCache?: boolean;
  /** Model pengganti bila model menolak (hanya model yang diizinkan untuk pengguna). */
  fallbackModels?: string[];
}

export interface ChatResult {
  content: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Tool yang dipanggil model pada giliran ini; kosong bila tidak ada. */
  toolCalls?: ChatToolCall[];
  /** Jumlah data pribadi yang dimasking per kategori; tanpa nilainya. */
  guardrails?: Record<string, number>;
  /** Model katalog (ai_models.id) yang menjalankan panggilan; diisi gateway. */
  modelId?: string;
  /** Blok konten asli jawaban (lihat ChatMessage.providerContent). */
  providerContent?: unknown[];
  /** Token input yang dibaca dari / ditulis ke cache prompt (sudah termasuk di tokensIn). */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  stopReason?: string;
}

export interface AiProviderAdapter {
  readonly id: string;
  chat(options: ChatRequestOptions): Promise<ChatResult>;
  stream(options: ChatRequestOptions): AsyncGenerator<string, ChatResult>;
}

/** Parse argumen tool berupa string JSON; hasil rusak menjadi objek kosong. */
export function parseToolInput(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
