import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_EVENTS,
  type QuotaPeriod,
  type QuotaWindowDto,
  type UserModelDto,
  type UserModelsResponseDto,
} from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import { DATA_SOURCE } from '../../../database/database.module';
import { AuditService } from '../../audit/audit.service';
import type { AiProviderAdapter } from '../providers/types';
import { ModelCatalogService, type CatalogModel } from './model-catalog.service';
import {
  quotaWindow,
  resolveAccess,
  resolveAgentAccess,
  type GrantRow,
  type ResolvedAccess,
  type ResolvedLimit,
  type Subject,
} from './model-access';
import { ProviderRegistryService } from './provider-registry.service';
import { NON_QUOTA_SOURCES, UsageLedgerService, type AiUsageSource } from './usage-ledger.service';

export interface CallContext {
  userId: string | null;
  source: AiUsageSource;
  conversationId?: string;
  taskId?: string;
  agentId?: string;
  /** Model katalog yang diminta eksplisit (wajib diizinkan, tidak diganti diam-diam). */
  modelId?: string | null;
  /** id model penyedia (mis. model ekstraksi memori); dicocokkan ke katalog. */
  modelKey?: string;
  needs: { tools: boolean; vision: boolean };
}

export interface AuthorizedCall {
  model: CatalogModel;
  adapter: AiProviderAdapter;
  /** Batas keluaran dari sisa kuota/kapasitas model; null = pakai batas bawaan gateway. */
  maxTokens: number | null;
  dropImages: boolean;
  userId: string | null;
  agentId: string | null;
  source: AiUsageSource;
  sourceId: string | null;
}

interface SubjectInfo extends Subject {
  isSuperadmin: boolean;
}

interface QuotaCheck {
  period: QuotaPeriod;
  limit: number;
  used: number;
  resetsAt: Date;
  sourceGrantId: string | null;
  sourceLabel: string;
  scope: 'user' | 'agent';
}

const ENFORCED_SOURCES: readonly AiUsageSource[] = ['conversation', 'regenerate', 'task', 'agent_subtask'];
const PERIOD_LABEL: Record<QuotaPeriod, string> = { day: 'harian', week: 'mingguan' };

function formatTokens(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value);
}

/**
 * Penentu model dan penjaga kuota untuk SETIAP panggilan LLM
 * (docs/LLM-MultiModel-requirement.md §6). Klien hanya mengirim modelId; keputusan di sini.
 */
@Injectable()
export class ModelAccessService {
  private grantCache: { version: number; rows: GrantRow[] } | null = null;
  private timezoneCache: { value: string; at: number } | null = null;
  private readonly exceededLogged = new Set<string>();

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly catalog: ModelCatalogService,
    private readonly registry: ProviderRegistryService,
    private readonly ledger: UsageLedgerService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── Data ─────────────────────────

  async grants(): Promise<GrantRow[]> {
    const version = await this.catalog.version();
    if (this.grantCache && this.grantCache.version === version) return this.grantCache.rows;
    const rows = (await this.dataSource.query(
      `SELECT g.id, g.target_type, g.target_id, g.include_sub_departments, g.model_id,
              g.token_limit, g.period, g.granted_scope, g.created_by,
              CASE g.target_type
                WHEN 'user' THEN 'Izin pribadi'
                WHEN 'department' THEN 'Izin Departemen ' || COALESCE(d.name, '?')
                WHEN 'agent' THEN 'Izin agent ' || COALESCE(a.name, '?')
                ELSE 'Izin semua orang'
              END || ' (oleh ' || COALESCE(cu.display_name, '?') || ', '
                  || CASE g.granted_scope WHEN 'admin' THEN 'Admin' ELSE 'Leader' END || ')' AS label
         FROM ai_model_grants g
         LEFT JOIN departments d ON g.target_type = 'department' AND d.id = g.target_id
         LEFT JOIN agents a ON g.target_type = 'agent' AND a.id = g.target_id
         LEFT JOIN users cu ON cu.id = g.created_by`,
    )) as {
      id: string;
      target_type: GrantRow['targetType'];
      target_id: string | null;
      include_sub_departments: boolean;
      model_id: string;
      token_limit: string | null;
      period: QuotaPeriod;
      granted_scope: 'admin' | 'leader';
      created_by: string;
      label: string;
    }[];
    const mapped: GrantRow[] = rows.map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      includeSubDepartments: r.include_sub_departments,
      modelId: r.model_id,
      tokenLimit: r.token_limit === null ? null : Number(r.token_limit),
      period: r.period,
      grantedScope: r.granted_scope,
      createdBy: r.created_by,
      label: r.label,
    }));
    this.grantCache = { version, rows: mapped };
    return mapped;
  }

  private async subject(userId: string): Promise<SubjectInfo> {
    const rows = (await this.dataSource.query(
      `WITH RECURSIVE chain AS (
         SELECT d.id, d.parent_id, 0 AS depth FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = $1
         UNION ALL
         SELECT p.id, p.parent_id, c.depth + 1 FROM departments p JOIN chain c ON p.id = c.parent_id WHERE c.depth < 30
       )
       SELECT (SELECT is_superadmin FROM users WHERE id = $1) AS is_superadmin,
              COALESCE((SELECT array_agg(id ORDER BY depth) FROM chain), '{}') AS chain`,
      [userId],
    )) as { is_superadmin: boolean | null; chain: string[] }[];
    return {
      userId,
      departmentChain: rows[0]?.chain ?? [],
      isSuperadmin: rows[0]?.is_superadmin === true,
    };
  }

  async timezone(): Promise<string> {
    const now = Date.now();
    if (this.timezoneCache && now - this.timezoneCache.at < 60_000) return this.timezoneCache.value;
    const rows = (await this.dataSource.query(`SELECT value FROM app_config WHERE key = 'app.timezone'`)) as {
      value: unknown;
    }[];
    const value = typeof rows[0]?.value === 'string' ? rows[0].value : 'Asia/Jakarta';
    this.timezoneCache = { value, at: now };
    return value;
  }

  private async resolved(userId: string): Promise<{ subject: SubjectInfo; access: ResolvedAccess; defaultModel: CatalogModel }> {
    const [subject, rows, defaultModel] = await Promise.all([
      this.subject(userId),
      this.grants(),
      this.catalog.defaultModel(),
    ]);
    return { subject, access: resolveAccess(rows, subject, defaultModel.id), defaultModel };
  }

  /** Model yang boleh dipakai pengguna: model bawaan + model berizin yang aktif. */
  async allowedModelIds(userId: string): Promise<Set<string>> {
    const { subject, access, defaultModel } = await this.resolved(userId);
    const models = await this.catalog.list();
    if (subject.isSuperadmin) return new Set(models.filter((m) => this.catalog.usable(m)).map((m) => m.id));
    const ids = new Set<string>([defaultModel.id, ...access.models.keys()]);
    return new Set(models.filter((m) => ids.has(m.id) && this.catalog.usable(m)).map((m) => m.id));
  }

  // ───────────────────────── Penegakan ─────────────────────────

  async authorize(ctx: CallContext): Promise<AuthorizedCall> {
    const enforced = Boolean(ctx.userId) && ENFORCED_SOURCES.includes(ctx.source);
    const task = ctx.taskId ? await this.taskInfo(ctx.taskId) : null;
    const agentId = ctx.agentId ?? task?.agent_id ?? null;
    const source: AiUsageSource =
      ctx.source === 'task' && task?.parent_task_id ? 'agent_subtask' : ctx.source;

    const model = enforced
      ? await this.pickEnforced(ctx.userId!, ctx, task, agentId)
      : await this.pickSystem(ctx);

    if (ctx.needs.tools && !model.supportsTools) {
      throw new AppError(
        ERROR_CODES.aiModelCapabilityMissing,
        `Model ${model.displayName} tidak mendukung dokumen, konektor, dan alat lain. Pilih model lain.`,
        422,
        { modelId: model.id, missing: ['tools'] },
      );
    }
    const adapter = this.registry.adapter(model.provider);
    if (!adapter) throw this.unavailable(model, 'provider_unconfigured');

    let maxTokens = model.maxOutputTokens;
    if (enforced && !NON_QUOTA_SOURCES.includes(source)) {
      const remaining = await this.checkQuota(ctx.userId!, model, agentId);
      if (remaining !== null) maxTokens = maxTokens === null ? remaining : Math.min(maxTokens, remaining);
    }
    return {
      model,
      adapter,
      maxTokens,
      dropImages: ctx.needs.vision && !model.supportsVision,
      userId: ctx.userId,
      agentId,
      source,
      sourceId: ctx.conversationId ?? ctx.taskId ?? null,
    };
  }

  private async taskInfo(taskId: string) {
    const rows = (await this.dataSource.query(
      `SELECT t.model_id, t.agent_id, t.parent_task_id, a.model_id AS agent_model_id
         FROM ai_tasks t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.id = $1`,
      [taskId],
    )) as { model_id: string | null; agent_id: string | null; parent_task_id: string | null; agent_model_id: string | null }[];
    return rows[0] ?? null;
  }

  private async pickSystem(ctx: CallContext): Promise<CatalogModel> {
    let model: CatalogModel | null = null;
    if (ctx.modelId) model = await this.catalog.get(ctx.modelId);
    else if (ctx.modelKey) model = await this.catalog.findByKey(ctx.modelKey);
    model ??= await this.catalog.defaultModel();
    if (!this.catalog.usable(model)) {
      const fallback = await this.catalog.defaultModel();
      if (!this.catalog.usable(fallback)) throw this.unavailable(fallback, 'provider_unconfigured');
      return fallback;
    }
    return model;
  }

  private async pickEnforced(
    userId: string,
    ctx: CallContext,
    task: Awaited<ReturnType<ModelAccessService['taskInfo']>>,
    agentId: string | null,
  ): Promise<CatalogModel> {
    const allowed = await this.allowedModelIds(userId);
    const agentAllowed = agentId ? await this.agentAllowed(agentId) : null;
    const ok = (id: string) => allowed.has(id) && (!agentAllowed || agentAllowed.has(id));

    if (ctx.modelId) {
      const model = await this.catalog.get(ctx.modelId);
      if (!this.catalog.usable(model)) {
        throw this.unavailable(model, model.status !== 'enabled' ? 'disabled' : 'provider_unconfigured');
      }
      if (!ok(model.id)) throw this.notAllowed(model, Boolean(agentAllowed?.size) && allowed.has(model.id));
      return model;
    }

    const candidates: (string | null | undefined)[] = [];
    if (ctx.conversationId) {
      const rows = (await this.dataSource.query(`SELECT model_id FROM conversations WHERE id = $1`, [
        ctx.conversationId,
      ])) as { model_id: string | null }[];
      candidates.push(rows[0]?.model_id);
    }
    candidates.push(task?.model_id);
    if (agentId) {
      const rows = (await this.dataSource.query(`SELECT model_id FROM agents WHERE id = $1`, [agentId])) as {
        model_id: string | null;
      }[];
      const agentModel = rows[0]?.model_id;
      // Model pilihan agent wajib diizinkan untuk pemilik tugas: gagal cepat, jangan diganti diam-diam.
      if (agentModel && !ok(agentModel)) {
        throw new AppError(
          ERROR_CODES.aiModelNotAllowed,
          'Model agent tidak lagi diizinkan untuk Anda. Ubah model di konfigurasi agent.',
          403,
          { modelId: agentModel },
        );
      }
      candidates.push(agentModel);
    }
    const preferred = (await this.dataSource.query(`SELECT preferred_model_id FROM users WHERE id = $1`, [userId])) as {
      preferred_model_id: string | null;
    }[];
    candidates.push(preferred[0]?.preferred_model_id);
    const defaultModel = await this.catalog.defaultModel();
    candidates.push(defaultModel.id);

    for (const id of candidates) {
      if (id && ok(id)) return this.catalog.get(id);
    }
    if (!this.catalog.usable(defaultModel)) throw this.unavailable(defaultModel, 'provider_unconfigured');
    throw this.notAllowed(defaultModel, false);
  }

  /** null = agent tanpa izin khusus (memakai izin pemilik). */
  private async agentAllowed(agentId: string): Promise<Set<string> | null> {
    const defaultModel = await this.catalog.defaultModel();
    const access = resolveAgentAccess(await this.grants(), agentId, defaultModel.id);
    if (!access) return null;
    return new Set([defaultModel.id, ...access.models.keys()]);
  }

  /** Sisa token terkecil yang berlaku (null = tanpa batas); lempar bila habis. */
  private async checkQuota(userId: string, model: CatalogModel, agentId: string | null): Promise<number | null> {
    const checks = await this.quotaChecks(userId, model, agentId);
    if (checks === 'superadmin') return null;
    if (model.isDefault) {
      const limits = await this.catalog.defaultLimits();
      if (limits.requestsPerMinute) {
        const since = new Date(Date.now() - 60_000);
        const calls = await this.ledger.callsSince(userId, model.id, since);
        if (calls >= limits.requestsPerMinute) {
          this.logExceeded(userId, model, 'rpm', AUDIT_EVENTS.aiRateLimited);
          throw new AppError(
            ERROR_CODES.aiRateLimited,
            `Terlalu banyak permintaan ke model bawaan (maks. ${limits.requestsPerMinute} per menit). Coba lagi dalam beberapa detik.`,
            429,
            { modelId: model.id, requestsPerMinute: limits.requestsPerMinute, retryAfterSeconds: 60 },
          );
        }
      }
    }
    let remaining: number | null = null;
    for (const check of checks) {
      const left = check.limit - check.used;
      if (left <= 0) {
        this.logExceeded(userId, model, `${check.scope}:${check.period}:${check.resetsAt.toISOString()}`, AUDIT_EVENTS.aiQuotaExceeded);
        const who = check.scope === 'agent' ? 'agent ini' : 'Anda';
        throw new AppError(
          ERROR_CODES.aiQuotaExceeded,
          `Kuota ${PERIOD_LABEL[check.period]} ${who} untuk ${model.displayName} sudah habis (${formatTokens(check.limit)} token). Kuota direset ${await this.formatReset(check.resetsAt)}.`,
          429,
          { modelId: model.id, period: check.period, limit: check.limit, used: check.used, resetsAt: check.resetsAt.toISOString() },
        );
      }
      remaining = remaining === null ? left : Math.min(remaining, left);
    }
    return remaining;
  }

  private async quotaChecks(
    userId: string,
    model: CatalogModel,
    agentId: string | null,
  ): Promise<QuotaCheck[] | 'superadmin'> {
    const { subject, access } = await this.resolved(userId);
    if (subject.isSuperadmin) return 'superadmin';
    const tz = await this.timezone();
    const now = new Date();
    const checks: QuotaCheck[] = [];
    const add = async (
      scope: 'user' | 'agent',
      period: QuotaPeriod,
      limit: ResolvedLimit | { limit: number | null; grantId: null; label: string },
    ) => {
      if (limit.limit === null) return;
      const window = quotaWindow(period, now, tz);
      const used = await this.ledger.tokensSince(scope === 'agent' ? { agentId: agentId! } : { userId }, model.id, window.start);
      checks.push({ period, limit: limit.limit, used, resetsAt: window.end, sourceGrantId: limit.grantId, sourceLabel: limit.label, scope });
    };
    if (model.isDefault) {
      const limits = await this.catalog.defaultLimits();
      await add('user', limits.period, { limit: limits.tokenLimit, grantId: null, label: 'Batas model bawaan' });
    } else {
      for (const [period, limit] of access.models.get(model.id) ?? []) await add('user', period, limit);
    }
    if (agentId && !model.isDefault) {
      const defaultModel = await this.catalog.defaultModel();
      const agentAccess = resolveAgentAccess(await this.grants(), agentId, defaultModel.id);
      for (const [period, limit] of agentAccess?.models.get(model.id) ?? []) await add('agent', period, limit);
    }
    return checks;
  }

  private logExceeded(userId: string, model: CatalogModel, windowKey: string, eventKey: string): void {
    const key = `${userId}:${model.id}:${windowKey}:${new Date().toISOString().slice(0, eventKey === AUDIT_EVENTS.aiRateLimited ? 16 : 10)}`;
    if (this.exceededLogged.has(key)) return;
    this.exceededLogged.add(key);
    if (this.exceededLogged.size > 5000) this.exceededLogged.clear();
    void this.audit
      .record({
        eventKey,
        severity: 'warn',
        summary: `Batas pemakaian ${model.displayName} tercapai`,
        actorUserId: userId,
        entityType: 'ai_model',
        entityId: model.id,
        payload: { window: windowKey },
      })
      .catch(() => undefined);
  }

  private async formatReset(at: Date): Promise<string> {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: await this.timezone(),
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  }

  private notAllowed(model: CatalogModel, agentOnly: boolean): AppError {
    return new AppError(
      ERROR_CODES.aiModelNotAllowed,
      agentOnly
        ? 'Model ini tidak diizinkan untuk agent ini oleh atasan.'
        : 'Anda belum diizinkan memakai model ini. Hubungi atasan atau admin.',
      403,
      { modelId: model.id },
    );
  }

  private unavailable(model: CatalogModel, reason: 'disabled' | 'provider_unconfigured'): AppError {
    return new AppError(
      ERROR_CODES.aiModelUnavailable,
      reason === 'disabled'
        ? `Model ${model.displayName} sedang tidak aktif.`
        : `Penyedia ${model.provider} untuk model ${model.displayName} belum dikonfigurasi.`,
      409,
      { modelId: model.id, reason },
    );
  }

  // ───────────────────────── Daftar untuk pengguna ─────────────────────────

  async userModels(userId: string): Promise<UserModelsResponseDto> {
    const allowed = await this.allowedModelIds(userId);
    const models = (await this.catalog.list()).filter((m) => allowed.has(m.id));
    const defaultLimits = await this.catalog.defaultLimits();
    const result: UserModelDto[] = [];
    for (const model of models) {
      const checks = await this.quotaChecks(userId, model, null);
      const quotas: QuotaWindowDto[] =
        checks === 'superadmin'
          ? []
          : checks.map((c) => ({
              period: c.period,
              limit: c.limit,
              used: c.used,
              remaining: Math.max(0, c.limit - c.used),
              resetsAt: c.resetsAt.toISOString(),
              sourceGrantId: c.sourceGrantId,
              sourceLabel: c.sourceLabel,
            }));
      result.push({
        id: model.id,
        provider: model.provider,
        displayName: model.displayName,
        description: model.description,
        costTier: model.costTier,
        supportsTools: model.supportsTools,
        supportsVision: model.supportsVision,
        longRunAllowed: model.longRunAllowed,
        isDefault: model.isDefault,
        unlimited: quotas.length === 0,
        quotas,
        requestsPerMinute: model.isDefault ? defaultLimits.requestsPerMinute : null,
        exhausted: quotas.some((q) => q.remaining <= 0),
      });
    }
    const preferred = (await this.dataSource.query(`SELECT preferred_model_id FROM users WHERE id = $1`, [userId])) as {
      preferred_model_id: string | null;
    }[];
    const preferredModelId = preferred[0]?.preferred_model_id ?? null;
    return { models: result, preferredModelId: preferredModelId && allowed.has(preferredModelId) ? preferredModelId : null };
  }

  async setPreferred(userId: string, modelId: string | null): Promise<void> {
    if (modelId && !(await this.allowedModelIds(userId)).has(modelId)) {
      throw new AppError(ERROR_CODES.aiModelNotAllowed, 'Anda belum diizinkan memakai model ini.', 403, { modelId });
    }
    await this.dataSource.query(`UPDATE users SET preferred_model_id = $2 WHERE id = $1`, [userId, modelId]);
  }

  /** Model pilihan pengguna harus aktif dan diizinkan; dilempar sebelum giliran disimpan. */
  async assertSelectable(userId: string, modelId: string): Promise<void> {
    const model = await this.catalog.get(modelId);
    if (!this.catalog.usable(model)) {
      throw this.unavailable(model, model.status !== 'enabled' ? 'disabled' : 'provider_unconfigured');
    }
    if (!(await this.allowedModelIds(userId)).has(modelId)) throw this.notAllowed(model, false);
  }

  /** Simpan model pilihan pada percakapan (dari composer); null = ikuti urutan bawaan. */
  async setConversationModel(userId: string, conversationId: string, modelId: string | null): Promise<void> {
    if (modelId) await this.assertSelectable(userId, modelId);
    await this.dataSource.query(`UPDATE conversations SET model_id = $3 WHERE id = $1 AND user_id = $2`, [
      conversationId,
      userId,
      modelId,
    ]);
  }

  /** Model agent wajib aktif; untuk agent pribadi juga wajib diizinkan bagi pemiliknya. */
  async assertAgentModel(modelId: string | null, ownerUserId: string | null, agentId?: string): Promise<void> {
    if (!modelId) return;
    const model = await this.catalog.get(modelId);
    if (model.status !== 'enabled') throw this.unavailable(model, 'disabled');
    if (!model.supportsTools) {
      throw new AppError(
        ERROR_CODES.aiModelCapabilityMissing,
        'Agent memerlukan model yang mendukung tools. Pilih model lain.',
        422,
        { modelId, missing: ['tools'] },
      );
    }
    if (!ownerUserId) return;
    if (!(await this.allowedModelIds(ownerUserId)).has(modelId)) throw this.notAllowed(model, false);
    if (agentId) {
      const agentAllowed = await this.agentAllowed(agentId);
      if (agentAllowed && !agentAllowed.has(modelId)) {
        throw new AppError(ERROR_CODES.aiModelNotAllowed, 'Model ini tidak diizinkan untuk agent ini oleh atasan.', 422, {
          modelId,
        });
      }
    }
  }

  /** "Pemakaian AI saya": pemakaian hari ini dan minggu ini per model beserta batasnya. */
  async usageMe(userId: string) {
    const tz = await this.timezone();
    const now = new Date();
    const day = quotaWindow('day', now, tz);
    const week = quotaWindow('week', now, tz);
    const [{ models }, today, thisWeek, catalog] = await Promise.all([
      this.userModels(userId),
      this.ledger.byModel(userId, day.start),
      this.ledger.byModel(userId, week.start),
      this.catalog.list(),
    ]);
    const ids = new Set([...models.map((m) => m.id), ...thisWeek.keys()]);
    return [...ids].map((id) => {
      const allowed = models.find((m) => m.id === id) ?? null;
      const model = catalog.find((m) => m.id === id);
      return {
        modelId: id,
        displayName: allowed?.displayName ?? model?.displayName ?? '(dihapus)',
        isDefault: allowed?.isDefault ?? false,
        allowed: allowed !== null,
        today: today.get(id)?.tokens ?? 0,
        week: thisWeek.get(id)?.tokens ?? 0,
        estimated: Boolean(thisWeek.get(id)?.estimated),
        quotas: allowed?.quotas ?? [],
        dayResetsAt: day.end.toISOString(),
        weekResetsAt: week.end.toISOString(),
      };
    });
  }

  /** Ringkasan efektif untuk satu orang ("Lihat efektif"). */
  async effective(userId: string): Promise<UserModelDto[]> {
    return (await this.userModels(userId)).models;
  }
}
