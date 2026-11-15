import { Inject, Injectable } from '@nestjs/common';
import { PERMISSIONS, type ConversationMode } from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import type { AuthContext } from '../../../common/types/auth-context';
import { DATA_SOURCE } from '../../../database/database.module';
import { updatedRows } from '../../../database/query-result';
import { ConversationsService } from '../conversations.service';
import { ModelAccessService } from '../models/model-access.service';
import { ModelCatalogService } from '../models/model-catalog.service';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted'
  | 'deadline_exceeded';

export const ACTIVE_RUN_STATUSES: RunStatus[] = ['queued', 'running', 'waiting_input', 'waiting_approval'];
export const FINAL_RUN_STATUSES: RunStatus[] = ['completed', 'failed', 'cancelled', 'budget_exhausted', 'deadline_exceeded'];

export interface RunOptions {
  mode: ConversationMode;
  counterpartStyle?: string;
  webSearch?: boolean;
  /** Pesan pengguna yang memulai run; riwayat run = pesan sampai id ini + checkpoint. */
  promptMessageId: string;
}

export interface RunRow {
  id: string;
  kind: 'conversation_turn' | 'task';
  user_id: string;
  conversation_id: string | null;
  task_id: string | null;
  model_id: string | null;
  status: RunStatus;
  prompt: string | null;
  options: RunOptions;
  effort: string | null;
  iterations: number;
  max_iterations: number;
  token_budget: string | null;
  tokens_in: string;
  tokens_out: string;
  deadline_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  attempt: number;
  checkpoint_seq: number;
  result_message_id: string | null;
  error: string | null;
  error_code: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface LongRunSettings {
  maxMinutes: number;
  maxIterations: number;
  maxConcurrentPerUser: number;
  autoPromote: boolean;
  defaultTokenBudget: number | null;
}

export function runDto(row: RunRow) {
  return {
    id: row.id,
    kind: row.kind,
    conversationId: row.conversation_id,
    taskId: row.task_id,
    modelId: row.model_id,
    status: row.status,
    effort: row.effort,
    iterations: row.iterations,
    maxIterations: row.max_iterations,
    tokenBudget: row.token_budget === null ? null : Number(row.token_budget),
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
    deadlineAt: new Date(row.deadline_at).toISOString(),
    attempt: row.attempt,
    resultMessageId: row.result_message_id,
    error: row.error,
    errorCode: row.error_code,
    prompt: row.prompt,
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
  };
}

/** Kerja panjang (docs/LLM-MultiModel-requirement.md §14): pembuatan, status, event, kendali. */
@Injectable()
export class RunsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly conversations: ConversationsService,
    private readonly modelAccess: ModelAccessService,
    private readonly catalog: ModelCatalogService,
  ) {}

  async settings(): Promise<LongRunSettings> {
    const rows = (await this.dataSource.query(`SELECT key, value FROM app_config WHERE key LIKE 'ai.long_run.%'`)) as {
      key: string;
      value: unknown;
    }[];
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const int = (key: string, fallback: number) => {
      const value = map.get(key);
      return typeof value === 'number' && value > 0 ? Math.floor(value) : fallback;
    };
    const budget = map.get('ai.long_run.default_token_budget');
    return {
      maxMinutes: int('ai.long_run.max_minutes', 60),
      maxIterations: int('ai.long_run.max_iterations', 60),
      maxConcurrentPerUser: int('ai.long_run.max_concurrent_per_user', 2),
      autoPromote: map.get('ai.long_run.auto_promote') !== false,
      defaultTokenBudget: typeof budget === 'number' && budget > 0 ? budget : null,
    };
  }

  async saveSettings(userId: string, settings: LongRunSettings): Promise<LongRunSettings> {
    const values: [string, unknown][] = [
      ['ai.long_run.max_minutes', settings.maxMinutes],
      ['ai.long_run.max_iterations', settings.maxIterations],
      ['ai.long_run.max_concurrent_per_user', settings.maxConcurrentPerUser],
      ['ai.long_run.auto_promote', settings.autoPromote],
      ['ai.long_run.default_token_budget', settings.defaultTokenBudget],
    ];
    for (const [key, value] of values) {
      await this.dataSource.query(
        `INSERT INTO app_config (key, value, is_public, updated_by) VALUES ($1, $2::jsonb, false, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [key, JSON.stringify(value), userId],
      );
    }
    return this.settings();
  }

  /** Model untuk kerja panjang: model pilihan (atau urutan bawaan) yang ditandai boleh kerja panjang. */
  private async longRunModel(userId: string, conversationId: string | null, modelId?: string): Promise<string> {
    if (modelId) await this.modelAccess.assertSelectable(userId, modelId);
    const allowed = await this.modelAccess.allowedModelIds(userId);
    const candidates: (string | null | undefined)[] = [modelId];
    if (conversationId) {
      const rows = (await this.dataSource.query(`SELECT model_id FROM conversations WHERE id = $1`, [conversationId])) as {
        model_id: string | null;
      }[];
      candidates.push(rows[0]?.model_id);
    }
    candidates.push((await this.catalog.defaultModel()).id);
    for (const id of candidates) {
      if (!id || !allowed.has(id)) continue;
      const model = await this.catalog.get(id);
      if (model.longRunAllowed && model.supportsTools) return id;
      if (id === modelId) {
        throw new AppError(
          ERROR_CODES.aiModelCapabilityMissing,
          `Model ${model.displayName} belum diizinkan admin untuk kerja panjang.`,
          422,
          { modelId: id, missing: ['long_run'] },
        );
      }
    }
    throw new AppError(
      ERROR_CODES.aiModelUnavailable,
      'Belum ada model yang diizinkan untuk kerja panjang. Minta admin menandai model "Kerja panjang".',
      409,
      { reason: 'no_long_run_model' },
    );
  }

  private async assertAdmission(userId: string, limit: number): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM ai_runs WHERE user_id = $1 AND status = ANY($2::ai_run_status[])`,
      [userId, ACTIVE_RUN_STATUSES],
    )) as { n: number }[];
    if ((rows[0]?.n ?? 0) >= limit) {
      throw new AppError(ERROR_CODES.conflict, `Masih ada ${limit} proses berjalan. Tunggu atau hentikan salah satunya.`, 409);
    }
  }

  async create(
    auth: AuthContext,
    input: {
      mode: ConversationMode;
      prompt: string;
      conversationId?: string;
      counterpartStyle?: string;
      webSearch?: boolean;
      modelId?: string;
      effort?: string;
      tokenBudget?: number;
      maxMinutes?: number;
    },
  ) {
    const settings = await this.settings();
    await this.assertAdmission(auth.user.id, settings.maxConcurrentPerUser);
    const modelId = await this.longRunModel(auth.user.id, input.conversationId ?? null, input.modelId);
    const prepared = await this.conversations.prepareTurn(auth, input);
    await this.modelAccess.setConversationModel(auth.user.id, prepared.id, modelId);
    const promptMessage = [...prepared.history].reverse().find((m) => m.role === 'user')!;
    const minutes = Math.min(input.maxMinutes ?? settings.maxMinutes, settings.maxMinutes);
    const options: RunOptions = {
      mode: input.mode,
      ...(input.counterpartStyle ? { counterpartStyle: input.counterpartStyle } : {}),
      ...(input.webSearch !== undefined ? { webSearch: input.webSearch } : {}),
      promptMessageId: String(promptMessage.id),
    };
    const rows = (await this.dataSource.query(
      `INSERT INTO ai_runs (kind, user_id, conversation_id, model_id, status, prompt, options, effort,
                           max_iterations, token_budget, deadline_at)
       VALUES ('conversation_turn', $1, $2, $3, 'queued', $4, $5, $6, $7, $8, now() + ($9 || ' minutes')::interval)
       RETURNING *`,
      [
        auth.user.id,
        prepared.id,
        modelId,
        input.prompt,
        JSON.stringify(options),
        input.effort ?? null,
        settings.maxIterations,
        input.tokenBudget ?? settings.defaultTokenBudget,
        String(minutes),
      ],
    )) as RunRow[];
    const run = rows[0]!;
    await this.event(run.id, 'status', { status: 'queued' });
    return { run: runDto(run), conversationId: prepared.id };
  }

  async find(id: string): Promise<RunRow | null> {
    const rows = (await this.dataSource.query(`SELECT * FROM ai_runs WHERE id = $1`, [id])) as RunRow[];
    return rows[0] ?? null;
  }

  async owned(auth: AuthContext, id: string): Promise<RunRow> {
    const run = await this.find(id);
    if (!run || run.user_id !== auth.user.id) throw new AppError(ERROR_CODES.notFound, 'Proses tidak ditemukan.', 404);
    return run;
  }

  async list(userId: string | null, activeOnly: boolean) {
    const rows = (await this.dataSource.query(
      `SELECT r.*, c.title AS conversation_title FROM ai_runs r
         LEFT JOIN conversations c ON c.id = r.conversation_id
        WHERE ($1::uuid IS NULL OR r.user_id = $1)
          AND (NOT $2 OR r.status = ANY($3::ai_run_status[]))
        ORDER BY r.created_at DESC LIMIT 50`,
      [userId, activeOnly, ACTIVE_RUN_STATUSES],
    )) as (RunRow & { conversation_title: string | null })[];
    return rows.map((r) => ({ ...runDto(r), conversationTitle: r.conversation_title, leaseOwner: r.lease_owner }));
  }

  async event(runId: string, type: string, payload: Record<string, unknown> = {}): Promise<number> {
    const rows = (await this.dataSource.query(
      `INSERT INTO ai_run_events (run_id, type, payload) VALUES ($1, $2, $3) RETURNING id`,
      [runId, type, JSON.stringify(payload)],
    )) as { id: string }[];
    return Number(rows[0]!.id);
  }

  async eventsAfter(runId: string, afterId: number): Promise<{ id: number; type: string; payload: unknown }[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, type, payload FROM ai_run_events WHERE run_id = $1 AND id > $2 ORDER BY id LIMIT 500`,
      [runId, afterId],
    )) as { id: string; type: string; payload: unknown }[];
    return rows.map((r) => ({ id: Number(r.id), type: r.type, payload: r.payload }));
  }

  async cancel(auth: AuthContext | null, id: string) {
    const run = auth ? await this.owned(auth, id) : await this.find(id);
    if (!run) throw new AppError(ERROR_CODES.notFound, 'Proses tidak ditemukan.', 404);
    const rows = updatedRows<RunRow>(
      await this.dataSource.query(
        `UPDATE ai_runs SET status = 'cancelled', finished_at = now(), lease_owner = NULL, lease_expires_at = NULL
          WHERE id = $1 AND status = ANY($2::ai_run_status[]) RETURNING *`,
        [id, ACTIVE_RUN_STATUSES],
      ),
    );
    if (rows[0]) await this.event(id, 'status', { status: 'cancelled' });
    return runDto(rows[0] ?? run);
  }

  async continueRun(auth: AuthContext, id: string, input: { extraIterations?: number; extraMinutes?: number; modelId?: string }) {
    const run = await this.owned(auth, id);
    if (run.status !== 'budget_exhausted' && run.status !== 'deadline_exceeded') {
      throw new AppError(ERROR_CODES.conflict, 'Hanya proses yang terhenti karena batas yang dapat dilanjutkan.', 409);
    }
    const settings = await this.settings();
    await this.assertAdmission(auth.user.id, settings.maxConcurrentPerUser);
    const modelId = input.modelId
      ? await this.longRunModel(auth.user.id, null, input.modelId)
      : (run.model_id ?? (await this.longRunModel(auth.user.id, run.conversation_id, undefined)));
    if (!auth.effective.allowed.has(run.options.mode === 'counterpart' ? PERMISSIONS.counterpartAnalyze : PERMISSIONS.secondBrainQuery)) {
      throw new AppError(ERROR_CODES.forbidden, 'Izin mode percakapan sudah dicabut.', 403);
    }
    const extraIterations = Math.min(input.extraIterations ?? settings.maxIterations, settings.maxIterations);
    const extraMinutes = Math.min(input.extraMinutes ?? settings.maxMinutes, settings.maxMinutes);
    const rows = updatedRows<RunRow>(
      await this.dataSource.query(
        `UPDATE ai_runs
            SET status = 'queued', model_id = $2, max_iterations = iterations + $3,
                deadline_at = now() + ($4 || ' minutes')::interval, error = NULL, error_code = NULL,
                finished_at = NULL, attempt = 0
          WHERE id = $1 RETURNING *`,
        [id, modelId, extraIterations, String(extraMinutes)],
      ),
    );
    await this.event(id, 'status', { status: 'queued', continued: true });
    return runDto(rows[0]!);
  }
}
