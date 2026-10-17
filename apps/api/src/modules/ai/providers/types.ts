export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatImageAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface ChatRequestOptions {
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
  images?: ChatImageAttachment[];
}

export interface ChatResult {
  content: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface AiProviderAdapter {
  readonly id: string;
  chat(options: ChatRequestOptions): Promise<ChatResult>;
  stream(options: ChatRequestOptions): AsyncGenerator<string, ChatResult>;
}
