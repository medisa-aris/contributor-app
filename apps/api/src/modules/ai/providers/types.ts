export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequestOptions {
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
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
