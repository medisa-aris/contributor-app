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
