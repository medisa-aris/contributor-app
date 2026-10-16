import { AppError, ERROR_CODES } from '../../common/errors/app-error';

export interface AiProviderSettings {
  aiProvider: string;
  aiModel: string;
  aiBaseUrl: string;
  aiTimeoutMs: number;
  openrouterApiKey: string | null;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  ollamaBaseUrl: string | null;
}

export interface ResolvedProvider {
  adapter: 'openai-compatible' | 'anthropic';
  provider: 'openrouter' | 'openai' | 'ollama' | 'anthropic';
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
}

const DEFAULT_BASE_URLS = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  anthropic: 'https://api.anthropic.com',
} as const;

export function resolveProviderConfig(settings: AiProviderSettings): ResolvedProvider {
  const provider = settings.aiProvider.trim().toLowerCase();
  const timeoutMs =
    Number.isFinite(settings.aiTimeoutMs) && settings.aiTimeoutMs > 0 ? settings.aiTimeoutMs : 60000;

  switch (provider) {
    case 'openrouter':
      if (!settings.openrouterApiKey) {
        throw missingKey('OPENROUTER_API_KEY', provider);
      }
      return {
        adapter: 'openai-compatible',
        provider,
        baseUrl: settings.aiBaseUrl || DEFAULT_BASE_URLS.openrouter,
        apiKey: settings.openrouterApiKey,
        model: settings.aiModel,
        timeoutMs,
      };
    case 'openai':
      if (!settings.openaiApiKey) {
        throw missingKey('OPENAI_API_KEY', provider);
      }
      return {
        adapter: 'openai-compatible',
        provider,
        baseUrl: settings.aiBaseUrl || DEFAULT_BASE_URLS.openai,
        apiKey: settings.openaiApiKey,
        model: settings.aiModel,
        timeoutMs,
      };
    case 'ollama':
      return {
        adapter: 'openai-compatible',
        provider,
        baseUrl: settings.ollamaBaseUrl ?? DEFAULT_BASE_URLS.ollama,
        apiKey: null,
        model: settings.aiModel,
        timeoutMs,
      };
    case 'anthropic':
      if (!settings.anthropicApiKey) {
        throw missingKey('ANTHROPIC_API_KEY', provider);
      }
      return {
        adapter: 'anthropic',
        provider,
        baseUrl: settings.aiBaseUrl || DEFAULT_BASE_URLS.anthropic,
        apiKey: settings.anthropicApiKey,
        model: settings.aiModel,
        timeoutMs,
      };
    default:
      throw new AppError(
        ERROR_CODES.aiProviderNotConfigured,
        `Penyedia AI "${settings.aiProvider}" tidak dikenal. Gunakan openrouter, openai, anthropic, atau ollama.`,
        503,
      );
  }
}

function missingKey(envName: string, provider: string): AppError {
  return new AppError(
    ERROR_CODES.aiProviderNotConfigured,
    `Kunci API untuk penyedia "${provider}" belum dikonfigurasi (variabel ${envName} kosong).`,
    503,
  );
}
