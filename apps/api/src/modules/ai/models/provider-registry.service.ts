import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_PROVIDER_CODES, type AiProviderCode } from '@bara/shared';
import { GuardedProvider } from '../guardrails/guarded-provider';
import { GuardrailsService } from '../guardrails/guardrails.service';
import { AnthropicProvider } from '../providers/anthropic.provider';
import { OpenAiCompatibleProvider } from '../providers/openai-compatible.provider';
import type { AiProviderAdapter } from '../providers/types';

export interface ProviderSettings {
  code: AiProviderCode;
  configured: boolean;
  baseUrl: string;
  apiKey: string | null;
  envVar: string;
}

export interface ProviderCheck {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

/** Pembuat adapter mentah; dapat diganti di tes integrasi (mis. adapter palsu). */
export type ProviderAdapterFactory = (settings: ProviderSettings) => AiProviderAdapter;
export const PROVIDER_ADAPTER_FACTORY = Symbol('PROVIDER_ADAPTER_FACTORY');

export const DEFAULT_BASE_URLS: Record<AiProviderCode, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://localhost:11434/v1',
};

const ENV_VARS: Record<AiProviderCode, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  ollama: 'OLLAMA_BASE_URL',
};

export function defaultAdapterFactory(settings: ProviderSettings): AiProviderAdapter {
  return settings.code === 'anthropic'
    ? new AnthropicProvider({ baseUrl: settings.baseUrl, apiKey: settings.apiKey ?? '' })
    : new OpenAiCompatibleProvider({ baseUrl: settings.baseUrl, apiKey: settings.apiKey });
}

/**
 * Penyedia LLM dari `.env` saja (tidak ada kredensial di DB/UI). Satu adapter per penyedia
 * yang dikonfigurasi, masing-masing dibungkus Guardrails seperti jalur keluar lama.
 */
@Injectable()
export class ProviderRegistryService {
  private readonly logger = new Logger(ProviderRegistryService.name);
  private readonly adapters = new Map<AiProviderCode, AiProviderAdapter>();
  private readonly rawAdapters = new Map<AiProviderCode, AiProviderAdapter>();
  private readonly checks = new Map<AiProviderCode, ProviderCheck>();
  private warnedLegacyBaseUrl = false;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly guardrails?: GuardrailsService,
    @Optional() @Inject(PROVIDER_ADAPTER_FACTORY) private readonly factory?: ProviderAdapterFactory,
  ) {}

  private legacyProvider(): string {
    return this.config.get<string>('app.aiProvider', 'openrouter').trim().toLowerCase();
  }

  timeoutMs(): number {
    const value = this.config.get<number>('app.aiTimeoutMs', 60000);
    return Number.isFinite(value) && value > 0 ? value : 60000;
  }

  settings(code: AiProviderCode): ProviderSettings {
    const legacy = this.legacyProvider() === code ? this.config.get<string>('app.aiBaseUrl', '') : '';
    if (legacy && !this.warnedLegacyBaseUrl) {
      this.warnedLegacyBaseUrl = true;
      this.logger.warn(`AI_BASE_URL usang; gunakan ${code.toUpperCase()}_BASE_URL.`);
    }
    const specific: Record<AiProviderCode, string | null> = {
      openrouter: this.config.get<string | null>('app.openrouterBaseUrl', null),
      openai: this.config.get<string | null>('app.openaiBaseUrl', null),
      anthropic: this.config.get<string | null>('app.anthropicBaseUrl', null),
      ollama: this.config.get<string | null>('app.ollamaBaseUrl', null),
    };
    const keys: Record<AiProviderCode, string | null> = {
      openrouter: this.config.get<string | null>('app.openrouterApiKey', null),
      openai: this.config.get<string | null>('app.openaiApiKey', null),
      anthropic: this.config.get<string | null>('app.anthropicApiKey', null),
      ollama: null,
    };
    // Pabrik adapter khusus (tes) menyediakan semua penyedia tanpa kredensial nyata.
    const configured =
      Boolean(this.factory) ||
      (code === 'ollama'
        ? Boolean(specific.ollama) || this.legacyProvider() === 'ollama'
        : Boolean(keys[code]));
    let baseUrl = (specific[code] || legacy || DEFAULT_BASE_URLS[code]).replace(/\/+$/, '');
    // Adapter Anthropic menambahkan "/messages"; URL tanpa versi (api.anthropic.com) perlu "/v1".
    if (code === 'anthropic' && !/\/v\d+$/.test(baseUrl)) baseUrl = `${baseUrl}/v1`;
    return {
      code,
      configured,
      baseUrl,
      apiKey: keys[code],
      envVar: ENV_VARS[code],
    };
  }

  all(): ProviderSettings[] {
    return AI_PROVIDER_CODES.map((code) => this.settings(code));
  }

  isConfigured(code: AiProviderCode): boolean {
    return this.settings(code).configured;
  }

  /** Adapter berpelindung Guardrails; null bila penyedia belum dikonfigurasi. */
  adapter(code: AiProviderCode): AiProviderAdapter | null {
    const cached = this.adapters.get(code);
    if (cached) return cached;
    const raw = this.raw(code);
    if (!raw) return null;
    const guarded = this.guardrails ? new GuardedProvider(raw, this.guardrails) : raw;
    this.adapters.set(code, guarded);
    return guarded;
  }

  /** Adapter tanpa Guardrails, hanya untuk uji model dan pencarian model (tanpa data pengguna). */
  raw(code: AiProviderCode): AiProviderAdapter | null {
    const cached = this.rawAdapters.get(code);
    if (cached) return cached;
    const settings = this.settings(code);
    if (!settings.configured) return null;
    const adapter = (this.factory ?? defaultAdapterFactory)(settings);
    this.rawAdapters.set(code, adapter);
    return adapter;
  }

  /** Header untuk endpoint daftar model penyedia (dipakai cek koneksi dan pencarian model). */
  listHeaders(code: AiProviderCode): Record<string, string> {
    const settings = this.settings(code);
    if (code === 'anthropic') {
      return { 'x-api-key': settings.apiKey ?? '', 'anthropic-version': '2023-06-01' };
    }
    return settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {};
  }

  /** Cek koneksi lewat endpoint daftar model; hasil disimpan di memori proses. */
  async check(code: AiProviderCode, fetchImpl: typeof fetch = fetch): Promise<ProviderCheck> {
    const settings = this.settings(code);
    const started = Date.now();
    let check: ProviderCheck;
    if (!settings.configured) {
      check = { ok: false, latencyMs: null, error: `Atur ${settings.envVar} di .env lalu mulai ulang API.`, checkedAt: new Date().toISOString() };
    } else {
      try {
        const response = await fetchImpl(`${settings.baseUrl}/models`, {
          headers: this.listHeaders(code),
          signal: AbortSignal.timeout(15_000),
        });
        check = {
          ok: response.ok,
          latencyMs: Date.now() - started,
          error: response.ok ? null : `Penyedia merespons ${response.status}.`,
          checkedAt: new Date().toISOString(),
        };
      } catch (error) {
        const cause = (error as { cause?: { code?: string } }).cause?.code;
        check = {
          ok: false,
          latencyMs: Date.now() - started,
          error: `Tidak dapat menghubungi penyedia${cause ? ` (${cause})` : ''}.`,
          checkedAt: new Date().toISOString(),
        };
      }
    }
    this.checks.set(code, check);
    return check;
  }

  lastCheck(code: AiProviderCode): ProviderCheck | null {
    return this.checks.get(code) ?? null;
  }

}
