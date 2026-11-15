import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG_KEYS } from '@bara/shared';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';

export interface MemorySettings {
  enabled: boolean;
  embeddingModel: string;
  extractorModel: string;
  maxContextTokens: number;
  maxExtractionsPerDay: number;
  retentionDays: number;
}

const DEFAULTS: MemorySettings = {
  enabled: true,
  embeddingModel: 'openai/text-embedding-3-small',
  extractorModel: '',
  maxContextTokens: 1500,
  maxExtractionsPerDay: 50,
  retentionDays: 0,
};

const TTL_MS = 10_000;

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Pengaturan memori dari tabel app_config (cache singkat). */
@Injectable()
export class MemorySettingsService {
  private cached: { at: number; value: MemorySettings } | null = null;

  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async get(): Promise<MemorySettings> {
    if (this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.value;
    const rows = (await this.dataSource.query(
      `SELECT key, value FROM app_config WHERE key LIKE 'ai.memory\\_%'`,
    )) as { key: string; value: unknown }[];
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const value: MemorySettings = {
      enabled: map.has(APP_CONFIG_KEYS.memoryEnabled)
        ? map.get(APP_CONFIG_KEYS.memoryEnabled) === true
        : DEFAULTS.enabled,
      embeddingModel:
        String(map.get(APP_CONFIG_KEYS.memoryEmbeddingModel) ?? '').trim() || DEFAULTS.embeddingModel,
      extractorModel: String(map.get(APP_CONFIG_KEYS.memoryExtractorModel) ?? '').trim(),
      maxContextTokens: asNumber(map.get(APP_CONFIG_KEYS.memoryMaxContextTokens), DEFAULTS.maxContextTokens, 200, 8000),
      maxExtractionsPerDay: asNumber(
        map.get(APP_CONFIG_KEYS.memoryMaxExtractionsPerDay),
        DEFAULTS.maxExtractionsPerDay,
        0,
        10_000,
      ),
      retentionDays: asNumber(map.get(APP_CONFIG_KEYS.memoryRetentionDays), DEFAULTS.retentionDays, 0, 36_500),
    };
    this.cached = { at: Date.now(), value };
    return value;
  }

  invalidate(): void {
    this.cached = null;
  }
}
