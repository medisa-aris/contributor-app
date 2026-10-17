import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_LIMITS, validateChatMessages } from './limits';
import { buildSystemPrompt, type PromptMode } from './prompts';
import { resolveProviderConfig, type AiProviderSettings } from './provider-resolver';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';
import type {
  AiProviderAdapter,
  ChatImageAttachment,
  ChatMessage,
  ChatResult,
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
}

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private adapter: AiProviderAdapter | null = null;

  constructor(private readonly config: ConfigService) {}

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
    this.adapter =
      resolved.adapter === 'anthropic'
        ? new AnthropicProvider({
            baseUrl: resolved.baseUrl,
            apiKey: resolved.apiKey ?? '',
          })
        : new OpenAiCompatibleProvider({ baseUrl: resolved.baseUrl, apiKey: resolved.apiKey });
    return this.adapter;
  }

  activeModel(): string {
    return this.settings().aiModel;
  }

  private buildRequest(options: GatewayChatOptions) {
    validateChatMessages(options.messages);
    const timeout = AbortSignal.timeout(this.settings().aiTimeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    return {
      model: this.settings().aiModel,
      systemPrompt: buildSystemPrompt(options.mode, options.counterpartStyle, options.extraContext),
      messages: options.messages,
      maxTokens: AI_LIMITS.maxOutputTokens,
      temperature: MODE_TEMPERATURE[options.mode],
      signal,
      ...(options.images && options.images.length > 0 ? { images: options.images } : {}),
    };
  }

  async chat(options: GatewayChatOptions): Promise<ChatResult> {
    return this.resolveAdapter().chat(this.buildRequest(options));
  }

  stream(options: GatewayChatOptions): AsyncGenerator<string, ChatResult> {
    return this.resolveAdapter().stream(this.buildRequest(options));
  }
}
