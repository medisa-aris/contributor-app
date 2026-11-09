import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  APP_CONFIG_KEYS,
  AUDIT_EVENTS,
  GUARDRAIL_CATEGORY_IDS,
  type GuardrailSettingsDto,
} from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import { decryptSecret, encryptSecret, loadEncryptionKey } from '../../../common/utils/secret-box';
import { DATA_SOURCE } from '../../../database/database.module';
import { AuditService } from '../../audit/audit.service';
import type { ChatRequestOptions, GuardScope } from '../providers/types';
import { Detector, type KnownTerm } from './detectors';
import { MaskSession } from './masker';

const SETTINGS_TTL_MS = 5_000;
const DIRECTORY_TTL_MS = 60_000;

const TOKEN_INSTRUCTION = `Sebagian data pribadi pada percakapan ini diganti token 16 karakter, misalnya MNFE7f3a9c2b1d4e atau MNFE7f3a9c2b1d4e@GHNB1a2b3c4d5e6f.com. Tiap token mewakili satu nilai. Salin token persis apa adanya setiap kali menyebutnya, jangan mengubah, menyingkat, atau menebak nilai aslinya, dan jangan menjelaskan keberadaan token kepada pengguna.`;

type Settings = Omit<GuardrailSettingsDto, 'keyConfigured'>;

const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  blockImages: true,
  categories: [...GUARDRAIL_CATEGORY_IDS],
  terms: [],
};

export interface GuardedRequest {
  request: ChatRequestOptions;
  session: MaskSession;
  scope?: GuardScope;
}

@Injectable()
export class GuardrailsService {
  private readonly logger = new Logger(GuardrailsService.name);
  private cachedSettings: { at: number; value: Settings } | null = null;
  private cachedDirectory: { at: number; value: string[] } | null = null;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private secretKey(): Buffer | null {
    return loadEncryptionKey(this.config.get<string | null>('app.guardrailsSecretKey') ?? undefined);
  }

  private async settings(): Promise<Settings> {
    if (this.cachedSettings && Date.now() - this.cachedSettings.at < SETTINGS_TTL_MS) {
      return this.cachedSettings.value;
    }
    const rows = (await this.dataSource.query(
      `SELECT key, value FROM app_config WHERE key = ANY($1::text[])`,
      [
        [
          APP_CONFIG_KEYS.guardrailsEnabled,
          APP_CONFIG_KEYS.guardrailsBlockImages,
          APP_CONFIG_KEYS.guardrailsCategories,
          APP_CONFIG_KEYS.guardrailsTerms,
        ],
      ],
    )) as { key: string; value: unknown }[];
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const list = (key: string, fallback: string[]): string[] => {
      const value = stored.get(key);
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : fallback;
    };
    const value: Settings = {
      enabled: stored.get(APP_CONFIG_KEYS.guardrailsEnabled) === true,
      blockImages: stored.get(APP_CONFIG_KEYS.guardrailsBlockImages) !== false,
      categories: list(APP_CONFIG_KEYS.guardrailsCategories, DEFAULT_SETTINGS.categories),
      terms: list(APP_CONFIG_KEYS.guardrailsTerms, DEFAULT_SETTINGS.terms),
    };
    this.cachedSettings = { at: Date.now(), value };
    return value;
  }

  async getSettings(): Promise<GuardrailSettingsDto> {
    return { ...(await this.settings()), keyConfigured: this.secretKey() !== null };
  }

  async updateSettings(input: Settings, userId: string): Promise<GuardrailSettingsDto> {
    if (input.enabled && !this.secretKey()) {
      throw new AppError(
        ERROR_CODES.validation,
        'GUARDRAILS_SECRET_KEY belum diatur di server, jadi Guardrails tidak bisa diaktifkan.',
        400,
      );
    }
    const entries: [string, unknown][] = [
      [APP_CONFIG_KEYS.guardrailsEnabled, input.enabled],
      [APP_CONFIG_KEYS.guardrailsBlockImages, input.blockImages],
      [APP_CONFIG_KEYS.guardrailsCategories, input.categories],
      [APP_CONFIG_KEYS.guardrailsTerms, input.terms],
    ];
    for (const [key, value] of entries) {
      await this.dataSource.query(
        `INSERT INTO app_config (key, value, description, is_public, updated_at, updated_by)
         VALUES ($1, $2::jsonb, 'Pengaturan Guardrails', false, now(), $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [key, JSON.stringify(value), userId],
      );
    }
    this.cachedSettings = null;
    // Daftar istilah bisa berisi nama orang, jadi hanya jumlahnya yang dicatat.
    await this.audit.record({
      eventKey: AUDIT_EVENTS.guardrailsUpdated,
      severity: 'warn',
      summary: input.enabled ? 'Guardrails diaktifkan' : 'Guardrails dinonaktifkan',
      actorUserId: userId,
      entityType: 'config',
      payload: {
        enabled: input.enabled,
        blockImages: input.blockImages,
        categories: input.categories,
        termCount: input.terms.length,
      },
    });
    return this.getSettings();
  }

  private async directory(): Promise<string[]> {
    if (this.cachedDirectory && Date.now() - this.cachedDirectory.at < DIRECTORY_TTL_MS) {
      return this.cachedDirectory.value;
    }
    const rows = (await this.dataSource.query(`SELECT display_name FROM users`)) as {
      display_name: string;
    }[];
    const value = rows.map((row) => row.display_name).filter(Boolean);
    this.cachedDirectory = { at: Date.now(), value };
    return value;
  }

  private async storedTerms(scope: GuardScope | undefined, key: Buffer): Promise<KnownTerm[]> {
    if (!scope?.conversationId && !scope?.taskId) return [];
    const rows = (await this.dataSource.query(
      `SELECT value_encrypted, category FROM guardrail_terms WHERE conversation_id = $1 OR task_id = $2`,
      [scope.conversationId ?? null, scope.taskId ?? null],
    )) as { value_encrypted: string; category: string }[];
    return rows.map((row) => ({
      value: decryptSecret(row.value_encrypted, key),
      category: row.category,
    }));
  }

  private async saveTerms(
    scope: GuardScope | undefined,
    discovered: ReadonlyMap<string, string>,
    session: MaskSession,
    key: Buffer,
  ): Promise<void> {
    if ((!scope?.conversationId && !scope?.taskId) || discovered.size === 0) return;
    const values = [...discovered.keys()];
    await this.dataSource.query(
      `INSERT INTO guardrail_terms (conversation_id, task_id, token, value_encrypted, category)
       SELECT $1::uuid, $2::uuid, t.token, t.value, t.category
         FROM unnest($3::text[], $4::text[], $5::text[]) AS t(token, value, category)
       ON CONFLICT DO NOTHING`,
      [
        scope.conversationId ?? null,
        scope.taskId ?? null,
        values.map((value) => session.mask(value, 'stored')),
        values.map((value) => encryptSecret(value, key)),
        values.map((value) => discovered.get(value)!),
      ],
    );
    delete session.counts.stored;
  }

  private transformInput(value: unknown, fn: (s: string, key?: string) => string, key?: string): unknown {
    if (typeof value === 'string') return fn(value, key);
    if (typeof value === 'number' && key !== undefined) {
      const text = String(value);
      const masked = fn(text, key);
      return masked === text ? value : masked;
    }
    if (Array.isArray(value)) return value.map((entry) => this.transformInput(entry, fn, key));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, entry]) => [k, this.transformInput(entry, fn, k)]),
      );
    }
    return value;
  }

  /**
   * Siapkan permintaan yang aman dikirim; null bila Guardrails nonaktif.
   * Kegagalan apa pun melempar error, sehingga tidak ada data yang keluar (gagal tertutup).
   */
  async prepare(options: ChatRequestOptions): Promise<GuardedRequest | null> {
    let settings: Settings;
    try {
      settings = await this.settings();
    } catch (error) {
      this.logger.error(`Pengaturan Guardrails tidak terbaca: ${(error as Error).message}`);
      throw this.unavailable();
    }
    if (!settings.enabled) return null;

    if (settings.blockImages && (options.images?.length ?? 0) > 0) {
      throw new AppError(
        ERROR_CODES.validation,
        'Lampiran gambar diblokir oleh Guardrails karena dapat memuat data pribadi. Nonaktifkan lampiran gambar lalu kirim lagi.',
        422,
      );
    }
    const key = this.secretKey();
    if (!key) throw this.unavailable();

    try {
      const categories = new Set(settings.categories);
      const hmacKey = createHmac('sha256', key).update('guardrails-token').digest();
      const session = new MaskSession(hmacKey);
      const directory = categories.has('full_name') ? await this.directory() : [];
      const detector = new Detector(session, categories, [
        ...directory.map((value) => ({ value, category: 'full_name' })),
        ...settings.terms.map((value) => ({ value, category: 'custom' })),
        ...(await this.storedTerms(options.guard, key)),
      ]);

      // Lintasan pertama menyelesaikan seluruh kamus, agar nama dari hasil tool
      // juga tertutup di pesan yang lebih awal.
      const firstPass = (text: string, field?: string): string =>
        (field !== undefined ? detector.maskByKey(field, text) : null) ?? detector.structured(text);
      const secondPass = (text: string): string => detector.apply(text);
      const pass = (fn: (s: string, k?: string) => string, source: ChatRequestOptions): ChatRequestOptions => ({
        ...source,
        systemPrompt: fn(source.systemPrompt),
        messages: source.messages.map((message) => ({
          ...message,
          content: fn(message.content),
          ...(message.toolCalls
            ? {
                toolCalls: message.toolCalls.map((call) => ({
                  ...call,
                  input: this.transformInput(call.input, fn) as Record<string, unknown>,
                })),
              }
            : {}),
        })),
      });
      const masked = pass(secondPass, pass(firstPass, options));

      await this.saveTerms(options.guard, detector.discovered, session, key);
      const request =
        session.size > 0
          ? { ...masked, systemPrompt: `${masked.systemPrompt}\n\n${TOKEN_INSTRUCTION}` }
          : masked;
      return {
        request,
        session,
        ...(options.guard ? { scope: options.guard } : {}),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error(`Masking gagal: ${(error as Error).name}`);
      throw this.unavailable();
    }
  }

  /** Catat jumlahnya saja; nilai data pribadi tidak pernah masuk audit atau log. */
  async finish(guarded: GuardedRequest): Promise<void> {
    if (guarded.session.size === 0) return;
    try {
      await this.audit.record({
        eventKey: AUDIT_EVENTS.guardrailsApplied,
        severity: guarded.session.unresolved > 0 ? 'warn' : 'info',
        summary: 'Data pribadi dimasking sebelum dikirim ke LLM',
        actorUserId: guarded.scope?.userId ?? null,
        entityType: guarded.scope?.taskId ? 'ai_task' : 'conversation',
        entityId: guarded.scope?.taskId ?? guarded.scope?.conversationId ?? null,
        payload: { counts: guarded.session.counts, unresolved: guarded.session.unresolved },
      });
    } catch (error) {
      this.logger.warn(`Audit Guardrails gagal: ${(error as Error).name}`);
    }
  }

  private unavailable(): AppError {
    return new AppError(
      ERROR_CODES.aiUpstreamError,
      'Guardrails tidak dapat memproses permintaan ini, jadi tidak ada data yang dikirim ke AI.',
      503,
    );
  }
}
