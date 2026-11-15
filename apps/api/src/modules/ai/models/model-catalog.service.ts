import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_PROVIDER_CODES,
  APP_CONFIG_KEYS,
  type AiModelDto,
  type AiProviderCode,
  type DefaultModelLimitsDto,
  type ModelTestProbeDto,
  type QuotaPeriod,
} from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import { DATA_SOURCE } from '../../../database/database.module';
import { updatedRows } from '../../../database/query-result';
import type { ChatResult } from '../providers/types';
import { ProviderRegistryService } from './provider-registry.service';

export interface CatalogModel {
  id: string;
  provider: AiProviderCode;
  modelKey: string;
  displayName: string;
  description: string | null;
  status: 'draft' | 'enabled' | 'disabled';
  isDefault: boolean;
  leaderGrantable: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStream: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  costTier: 1 | 2 | 3 | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestLatencyMs: number | null;
  lastTestError: string | null;
  sortOrder: number;
}

interface ModelRow {
  id: string;
  provider: AiProviderCode;
  model_key: string;
  display_name: string;
  description: string | null;
  status: CatalogModel['status'];
  is_default: boolean;
  leader_grantable: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_stream: boolean;
  context_window: number | null;
  max_output_tokens: number | null;
  cost_tier: number | null;
  last_test_at: Date | string | null;
  last_test_ok: boolean | null;
  last_test_latency_ms: number | null;
  last_test_error: string | null;
  sort_order: number;
}

export interface ModelPatch {
  displayName?: string;
  description?: string | null;
  leaderGrantable?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsStream?: boolean;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  costTier?: 1 | 2 | 3 | null;
  sortOrder?: number;
}

const VERSION_TTL_MS = 3000;
const PING_TOOL = {
  name: 'ping',
  description: 'Alat uji. Panggil dengan value "ok".',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
};
// PNG 2×2 merah.
const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBNAMDADXIBfu9pQvHAAAAAElFTkSuQmCC';

/** Samarkan pola kredensial di pesan galat penyedia sebelum ditampilkan atau disimpan. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, '$1-***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/("?(api[_-]?key|x-api-key|authorization)"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1***');
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toModel(row: ModelRow): CatalogModel {
  return {
    id: row.id,
    provider: row.provider,
    modelKey: row.model_key,
    displayName: row.display_name,
    description: row.description,
    status: row.status,
    isDefault: row.is_default,
    leaderGrantable: row.leader_grantable,
    supportsTools: row.supports_tools,
    supportsVision: row.supports_vision,
    supportsStream: row.supports_stream,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    costTier: (row.cost_tier as 1 | 2 | 3 | null) ?? null,
    lastTestAt: iso(row.last_test_at),
    lastTestOk: row.last_test_ok,
    lastTestLatencyMs: row.last_test_latency_ms,
    lastTestError: row.last_test_error,
    sortOrder: row.sort_order,
  };
}

/**
 * Katalog model (`ai_models`). Cache seluruh katalog per proses, dimuat ulang saat
 * `ai_models_meta.version` naik (setiap perubahan katalog, izin, atau batas model bawaan).
 */
@Injectable()
export class ModelCatalogService {
  private readonly logger = new Logger(ModelCatalogService.name);
  private cache: { version: number; models: CatalogModel[] } | null = null;
  private versionCache: { value: number; at: number } | null = null;
  private seeding: Promise<void> | null = null;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistryService,
  ) {}

  async version(): Promise<number> {
    const now = Date.now();
    if (this.versionCache && now - this.versionCache.at < VERSION_TTL_MS) return this.versionCache.value;
    const rows = (await this.dataSource.query(`SELECT version FROM ai_models_meta WHERE id = 1`)) as {
      version: string;
    }[];
    const value = Number(rows[0]?.version ?? 0);
    this.versionCache = { value, at: now };
    return value;
  }

  /** Naikkan versi agar cache katalog/izin di semua instance dimuat ulang. */
  async bump(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ai_models_meta (id, version) VALUES (1, 1)
       ON CONFLICT (id) DO UPDATE SET version = ai_models_meta.version + 1, updated_at = now()`,
    );
    this.versionCache = null;
  }

  async list(): Promise<CatalogModel[]> {
    await this.ensureDefault();
    const version = await this.version();
    if (this.cache && this.cache.version === version) return this.cache.models;
    const rows = (await this.dataSource.query(
      `SELECT * FROM ai_models ORDER BY is_default DESC, sort_order, display_name`,
    )) as ModelRow[];
    const models = rows.map(toModel);
    this.cache = { version, models };
    return models;
  }

  async get(id: string): Promise<CatalogModel> {
    const model = (await this.list()).find((m) => m.id === id);
    if (!model) throw new AppError(ERROR_CODES.notFound, 'Model tidak ditemukan.', 404);
    return model;
  }

  async findByKey(modelKey: string): Promise<CatalogModel | null> {
    const models = (await this.list()).filter((m) => m.modelKey === modelKey);
    return models.find((m) => m.status === 'enabled' && this.registry.isConfigured(m.provider)) ?? models[0] ?? null;
  }

  async defaultModel(): Promise<CatalogModel> {
    const model = (await this.list()).find((m) => m.isDefault);
    if (!model) {
      throw new AppError(
        ERROR_CODES.aiProviderNotConfigured,
        'Model bawaan belum ditetapkan. Minta admin menetapkannya di menu Model AI.',
        503,
      );
    }
    return model;
  }

  /** Model dapat dipakai: aktif dan penyedianya dikonfigurasi di .env. */
  usable(model: CatalogModel): boolean {
    return model.status === 'enabled' && this.registry.isConfigured(model.provider);
  }

  toDto(model: CatalogModel): AiModelDto {
    const { sortOrder: _sortOrder, ...rest } = model;
    return { ...rest, providerConfigured: this.registry.isConfigured(model.provider) };
  }

  /**
   * Katalog kosong (instalasi lama atau DB tes yang baru dikosongkan): jadikan
   * AI_PROVIDER + AI_MODEL sebagai model bawaan agar perilaku lama tetap jalan.
   */
  async ensureDefault(): Promise<void> {
    if (this.cache?.models.some((m) => m.isDefault)) return;
    this.seeding ??= this.seedDefault().finally(() => {
      this.seeding = null;
    });
    await this.seeding;
  }

  private async seedDefault(): Promise<void> {
    const existing = (await this.dataSource.query(
      `SELECT 1 FROM ai_models WHERE is_default LIMIT 1`,
    )) as unknown[];
    if (existing.length > 0) return;
    const provider = this.config.get<string>('app.aiProvider', 'openrouter').trim().toLowerCase();
    const modelKey = this.config.get<string>('app.aiModel', '').trim();
    if (!AI_PROVIDER_CODES.includes(provider as AiProviderCode) || !modelKey) {
      this.logger.warn('Model bawaan tidak dapat diisi dari env (AI_PROVIDER/AI_MODEL tidak valid).');
      return;
    }
    try {
      await this.dataSource.query(
        `INSERT INTO ai_models (provider, model_key, display_name, status, is_default,
                               supports_tools, supports_vision, cost_tier)
         VALUES ($1, $2, $2, 'enabled', true, true, true, 1)
         ON CONFLICT (provider, model_key)
           DO UPDATE SET status = 'enabled', is_default = true, updated_at = now()`,
        [provider, modelKey],
      );
      await this.bump();
      this.logger.log(`Model bawaan diisi dari env: ${provider} / ${modelKey}`);
    } catch (error) {
      // Instance lain mungkin mengisinya bersamaan (indeks unik model bawaan).
      this.logger.debug(`Pengisian model bawaan dilewati: ${(error as Error).message}`);
    }
  }

  async create(
    userId: string,
    items: { provider: AiProviderCode; modelKey: string; displayName?: string; description?: string | null }[],
  ): Promise<CatalogModel[]> {
    const ids: string[] = [];
    for (const item of items) {
      const rows = (await this.dataSource.query(
        `INSERT INTO ai_models (provider, model_key, display_name, description, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (provider, model_key) DO NOTHING
         RETURNING id`,
        [item.provider, item.modelKey.trim(), item.displayName?.trim() || item.modelKey.trim(), item.description ?? null, userId],
      )) as { id: string }[];
      if (rows[0]) ids.push(rows[0].id);
    }
    if (ids.length === 0) {
      throw new AppError(ERROR_CODES.conflict, 'Model sudah ada di katalog.', 409);
    }
    await this.bump();
    const all = await this.list();
    return all.filter((m) => ids.includes(m.id));
  }

  async update(id: string, patch: ModelPatch): Promise<CatalogModel> {
    await this.get(id);
    const columns: Record<keyof ModelPatch, string> = {
      displayName: 'display_name',
      description: 'description',
      leaderGrantable: 'leader_grantable',
      supportsTools: 'supports_tools',
      supportsVision: 'supports_vision',
      supportsStream: 'supports_stream',
      contextWindow: 'context_window',
      maxOutputTokens: 'max_output_tokens',
      costTier: 'cost_tier',
      sortOrder: 'sort_order',
    };
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, column] of Object.entries(columns) as [keyof ModelPatch, string][]) {
      if (patch[key] === undefined) continue;
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length > 0) {
      await this.dataSource.query(
        `UPDATE ai_models SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params,
      );
      await this.bump();
    }
    return this.get(id);
  }

  async enable(id: string): Promise<CatalogModel> {
    const model = await this.get(id);
    if (model.lastTestOk !== true) {
      throw new AppError(ERROR_CODES.conflict, 'Uji model ini dulu sebelum diaktifkan.', 409);
    }
    await this.dataSource.query(
      `UPDATE ai_models SET status = 'enabled', updated_at = now() WHERE id = $1`,
      [id],
    );
    await this.bump();
    return this.get(id);
  }

  async disable(id: string): Promise<CatalogModel> {
    const model = await this.get(id);
    if (model.isDefault) {
      throw new AppError(
        ERROR_CODES.conflict,
        'Model bawaan tidak dapat dinonaktifkan. Tetapkan model bawaan lain terlebih dahulu.',
        409,
      );
    }
    await this.dataSource.query(
      `UPDATE ai_models SET status = 'disabled', updated_at = now() WHERE id = $1`,
      [id],
    );
    await this.bump();
    return this.get(id);
  }

  async setDefault(id: string): Promise<CatalogModel> {
    const model = await this.get(id);
    if (!this.usable(model)) {
      throw new AppError(
        ERROR_CODES.conflict,
        'Model bawaan harus aktif dan penyedianya sudah dikonfigurasi di .env.',
        409,
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`UPDATE ai_models SET is_default = false WHERE is_default AND id <> $1`, [id]);
      await manager.query(`UPDATE ai_models SET is_default = true, updated_at = now() WHERE id = $1`, [id]);
    });
    await this.bump();
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const model = await this.get(id);
    if (model.status === 'enabled') {
      throw new AppError(ERROR_CODES.conflict, 'Nonaktifkan model ini sebelum dihapus.', 409);
    }
    updatedRows(await this.dataSource.query(`DELETE FROM ai_models WHERE id = $1`, [id]));
    await this.bump();
  }

  /** Uji langsung model dengan kredensial env, tanpa Guardrails dan tanpa data pengguna. */
  async test(
    id: string,
    options: { vision?: boolean },
  ): Promise<{ model: CatalogModel; probes: ModelTestProbeDto[]; usage: ChatResult[] }> {
    const model = await this.get(id);
    const adapter = this.registry.raw(model.provider);
    if (!adapter) {
      throw new AppError(
        ERROR_CODES.aiModelUnavailable,
        `Penyedia ${model.provider} belum dikonfigurasi di .env.`,
        409,
        { modelId: id, reason: 'provider_unconfigured' },
      );
    }
    const probes: ModelTestProbeDto[] = [];
    const usage: ChatResult[] = [];
    const base = {
      model: model.modelKey,
      systemPrompt: 'Anda sedang diuji. Jawab sesingkat mungkin.',
      maxTokens: 64,
    };

    let supportsStream = model.supportsStream;
    const basicStarted = Date.now();
    try {
      const stream = adapter.stream({
        ...base,
        messages: [{ role: 'user', content: 'Balas tepat dengan kata: OK' }],
        signal: AbortSignal.timeout(30_000),
      });
      let firstAt: number | null = null;
      for (;;) {
        const step = await stream.next();
        if (step.done) {
          usage.push(step.value);
          break;
        }
        firstAt ??= Date.now();
      }
      supportsStream = true;
      probes.push({ probe: 'basic', ok: true, latencyMs: Date.now() - basicStarted, detail: firstAt ? `Token pertama ${firstAt - basicStarted} ms` : null });
    } catch (error) {
      probes.push({ probe: 'basic', ok: false, latencyMs: Date.now() - basicStarted, detail: this.errorText(error) });
    }

    let supportsTools = false;
    if (probes[0]?.ok) {
      const started = Date.now();
      try {
        const result = await adapter.chat({
          ...base,
          messages: [{ role: 'user', content: 'Panggil alat ping dengan value "ok". Jangan menjawab dengan teks.' }],
          tools: [PING_TOOL],
          signal: AbortSignal.timeout(30_000),
        });
        usage.push(result);
        supportsTools = (result.toolCalls ?? []).some((c) => c.name === 'ping');
        probes.push({ probe: 'tools', ok: supportsTools, latencyMs: Date.now() - started, detail: supportsTools ? null : 'Model tidak memanggil alat.' });
      } catch (error) {
        probes.push({ probe: 'tools', ok: false, latencyMs: Date.now() - started, detail: this.errorText(error) });
      }
    }

    let supportsVision = model.supportsVision;
    if (options.vision && probes[0]?.ok) {
      const started = Date.now();
      try {
        const result = await adapter.chat({
          ...base,
          messages: [{ role: 'user', content: 'Apa warna dominan gambar ini? Jawab satu kata.' }],
          images: [{ name: 'uji.png', mimeType: 'image/png', dataBase64: RED_PNG }],
          signal: AbortSignal.timeout(30_000),
        });
        usage.push(result);
        supportsVision = true;
        probes.push({ probe: 'vision', ok: true, latencyMs: Date.now() - started, detail: result.content.slice(0, 80) });
      } catch (error) {
        supportsVision = false;
        probes.push({ probe: 'vision', ok: false, latencyMs: Date.now() - started, detail: this.errorText(error) });
      }
    }

    const basic = probes[0]!;
    await this.dataSource.query(
      `UPDATE ai_models
          SET last_test_at = now(), last_test_ok = $2, last_test_latency_ms = $3, last_test_error = $4,
              supports_tools = CASE WHEN $2 THEN $5 ELSE supports_tools END,
              supports_vision = $6, supports_stream = $7, updated_at = now()
        WHERE id = $1`,
      [id, basic.ok, basic.latencyMs, basic.ok ? null : basic.detail, supportsTools, supportsVision, supportsStream],
    );
    await this.bump();
    return { model: await this.get(id), probes, usage };
  }

  private errorText(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Kesalahan tidak dikenal.';
    return scrubSecrets(message).slice(0, 300);
  }

  async defaultLimits(): Promise<DefaultModelLimitsDto> {
    const rows = (await this.dataSource.query(
      `SELECT key, value FROM app_config WHERE key = ANY($1::text[])`,
      [[APP_CONFIG_KEYS.defaultModelTokenLimit, APP_CONFIG_KEYS.defaultModelPeriod, APP_CONFIG_KEYS.defaultModelRequestsPerMinute]],
    )) as { key: string; value: unknown }[];
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const positive = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    const period = map.get(APP_CONFIG_KEYS.defaultModelPeriod);
    return {
      tokenLimit: positive(map.get(APP_CONFIG_KEYS.defaultModelTokenLimit)),
      period: (period === 'week' ? 'week' : 'day') as QuotaPeriod,
      requestsPerMinute: positive(map.get(APP_CONFIG_KEYS.defaultModelRequestsPerMinute)),
    };
  }

  async setDefaultLimits(userId: string, limits: DefaultModelLimitsDto): Promise<DefaultModelLimitsDto> {
    const values: [string, unknown][] = [
      [APP_CONFIG_KEYS.defaultModelTokenLimit, limits.tokenLimit],
      [APP_CONFIG_KEYS.defaultModelPeriod, limits.period],
      [APP_CONFIG_KEYS.defaultModelRequestsPerMinute, limits.requestsPerMinute],
    ];
    for (const [key, value] of values) {
      await this.dataSource.query(
        `INSERT INTO app_config (key, value, is_public, updated_by) VALUES ($1, $2::jsonb, false, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [key, JSON.stringify(value), userId],
      );
    }
    await this.bump();
    return this.defaultLimits();
  }
}
