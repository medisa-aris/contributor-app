import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import type { AuthContext } from '../../../common/types/auth-context';
import { DATA_SOURCE } from '../../../database/database.module';
import { EffectivePermissionsService } from '../../rbac/effective-permissions.service';
import { allowedIdentifiers } from '../../rbac/policy-engine';
import { AttachmentsService } from '../attachments.service';
import { ChatToolsService } from '../chat-tools.service';
import { ChatTurnService } from '../chat-turn.service';
import { ConversationsService, type ConversationMessageRow } from '../conversations.service';
import { clampToolResult, type ToolHandler, type ToolLoopResult, type ToolOutcome } from '../gateway.service';
import type { ChatMessage } from '../providers/types';
import { RunsService, type RunRow, type RunStatus } from './runs.service';

const LEASE_SECONDS = 60;
const HEARTBEAT_MS = 20_000;
const CANCEL_POLL_MS = 2_000;
const TICK_MS = 1_000;
const DELTA_FLUSH_MS = 250;
const MAX_ATTEMPTS = 3;
const UNKNOWN_TOOL_STATE =
  'Status tidak diketahui setelah gangguan — periksa sistem tujuan sebelum mengulang operasi ini.';

type StopReason = 'cancelled' | 'deadline' | 'budget' | 'shutdown';

/**
 * Pekerja kerja panjang (§14.5): mengklaim run dari tabel dengan FOR UPDATE SKIP LOCKED, menjaga
 * lease dengan heartbeat, melanjutkan dari checkpoint bila pekerja lain mati, dan tidak pernah
 * menjalankan ulang tool yang sudah selesai.
 */
@Injectable()
export class RunWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RunWorkerService.name);
  readonly workerId = `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
  private readonly active = new Map<string, AbortController>();
  private tickTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private ticking = false;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly runs: RunsService,
    private readonly turns: ChatTurnService,
    private readonly chatTools: ChatToolsService,
    private readonly conversations: ConversationsService,
    private readonly attachments: AttachmentsService,
    private readonly effective: EffectivePermissionsService,
  ) {}

  private concurrency(): number {
    const value = Number(process.env.AI_WORKER_CONCURRENCY ?? 3);
    return Number.isFinite(value) && value > 0 ? value : 3;
  }

  onApplicationBootstrap(): void {
    if (process.env.AI_WORKER_ENABLED === 'false') return;
    this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    for (const controller of this.active.values()) controller.abort('shutdown' satisfies StopReason);
    // Beri waktu run yang dihentikan untuk mengembalikan lease (status queued).
    const until = Date.now() + 5000;
    while (this.active.size > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  }

  /** Satu putaran: pulihkan lease kedaluwarsa, lalu klaim run selama kapasitas tersedia. */
  async tick(): Promise<void> {
    if (this.stopping || this.ticking) return;
    this.ticking = true;
    try {
      await this.recoverExpired();
      while (!this.stopping && this.active.size < this.concurrency()) {
        const run = await this.claim();
        if (!run) break;
        void this.execute(run);
      }
    } catch (error) {
      this.logger.warn(`Putaran pekerja gagal: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async recoverExpired(): Promise<void> {
    const rows = (await this.dataSource.query(
      `UPDATE ai_runs
          SET status = CASE WHEN attempt >= $1 THEN 'failed'::ai_run_status ELSE 'queued'::ai_run_status END,
              error = CASE WHEN attempt >= $1 THEN 'Proses terhenti berulang kali.' ELSE error END,
              finished_at = CASE WHEN attempt >= $1 THEN now() ELSE NULL END,
              lease_owner = NULL, lease_expires_at = NULL
        WHERE status = 'running' AND lease_expires_at < now()
        RETURNING id, status`,
      [MAX_ATTEMPTS],
    )) as { id: string; status: RunStatus }[];
    for (const row of Array.isArray(rows[0]) ? (rows[0] as typeof rows) : rows) {
      await this.runs.event(row.id, 'status', { status: row.status, recovered: true });
    }
  }

  private async claim(): Promise<RunRow | null> {
    const rows = (await this.dataSource.query(
      `UPDATE ai_runs
          SET status = 'running', lease_owner = $1,
              lease_expires_at = now() + ($2 || ' seconds')::interval, heartbeat_at = now(),
              started_at = COALESCE(started_at, now()), attempt = attempt + 1
        WHERE id = (SELECT id FROM ai_runs WHERE status = 'queued' AND kind = 'conversation_turn'
                     ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`,
      [this.workerId, String(LEASE_SECONDS)],
    )) as RunRow[] | [RunRow[], number];
    const list = Array.isArray(rows[0]) ? (rows[0] as RunRow[]) : (rows as RunRow[]);
    return list[0] ?? null;
  }

  /** Konteks otorisasi pemilik run (pekerja berjalan di luar permintaan HTTP). */
  private async authFor(userId: string): Promise<AuthContext> {
    const users = (await this.dataSource.query(
      `SELECT id, email, display_name, is_superadmin, department_id, token_version, status FROM users WHERE id = $1`,
      [userId],
    )) as {
      id: string;
      email: string;
      display_name: string;
      is_superadmin: boolean;
      department_id: string | null;
      token_version: number;
      status: 'active' | 'disabled';
    }[];
    const user = users[0];
    if (!user || user.status !== 'active') {
      throw new AppError(ERROR_CODES.accountDisabled, 'Pemilik proses tidak aktif.', 403);
    }
    const access = await this.effective.resolve(userId);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        isSuperadmin: user.is_superadmin,
        departmentId: user.department_id,
        tokenVersion: user.token_version,
        status: user.status,
      },
      session: { id: `run:${this.workerId}`, csrfSecret: '', ip: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) },
      effective: { allowed: allowedIdentifiers(access.decisions), decisions: access.decisions },
    };
  }

  /** Tool yang sudah sukses tidak dijalankan ulang; yang terpotong gangguan dilaporkan gagal. */
  private idempotent(runId: string, handler: ToolHandler): ToolHandler {
    return {
      ...handler,
      execute: async (input, call) => {
        const previous = (await this.dataSource.query(
          `SELECT status, result FROM ai_run_tool_calls WHERE run_id = $1 AND tool_call_id = $2`,
          [runId, call.id],
        )) as { status: string; result: ToolOutcome | null }[];
        if (previous[0]?.status === 'succeeded' && previous[0].result) return previous[0].result;
        if (previous[0]?.status === 'started') return { status: 'error', content: UNKNOWN_TOOL_STATE };
        await this.dataSource.query(
          `INSERT INTO ai_run_tool_calls (run_id, tool_call_id, name, status) VALUES ($1, $2, $3, 'started')
           ON CONFLICT (run_id, tool_call_id) DO UPDATE SET status = 'started', started_at = now()`,
          [runId, call.id, call.name],
        );
        const outcome = await handler.execute(input, call);
        await this.dataSource.query(
          `UPDATE ai_run_tool_calls SET status = $3, result = $4, finished_at = now()
            WHERE run_id = $1 AND tool_call_id = $2`,
          [
            runId,
            call.id,
            outcome.status === 'ok' ? 'succeeded' : outcome.status === 'error' ? 'failed' : 'pending_approval',
            JSON.stringify(outcome),
          ],
        );
        return outcome;
      },
    };
  }

  private async checkpoint(run: RunRow, seq: number, message: ChatMessage): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ai_run_messages (run_id, seq, message) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [run.id, seq, JSON.stringify(message)],
    );
    await this.dataSource.query(`UPDATE ai_runs SET checkpoint_seq = $2 WHERE id = $1`, [run.id, seq]);
  }

  private async finish(
    run: RunRow,
    status: RunStatus,
    fields: { resultMessageId?: string | null; error?: string | null; errorCode?: string | null } = {},
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE ai_runs
          SET status = $2::ai_run_status,
              finished_at = CASE WHEN $2::ai_run_status = ANY('{completed,failed,cancelled,budget_exhausted,deadline_exceeded}'::ai_run_status[]) THEN now() ELSE NULL END,
              lease_owner = NULL, lease_expires_at = NULL,
              result_message_id = COALESCE($3, result_message_id), error = $4, error_code = $5
        WHERE id = $1 AND (status <> 'cancelled' OR $2::ai_run_status = 'cancelled')`,
      [run.id, status, fields.resultMessageId ?? null, fields.error ?? null, fields.errorCode ?? null],
    );
  }

  async execute(run: RunRow): Promise<void> {
    const controller = new AbortController();
    this.active.set(run.id, controller);
    const abort = (reason: StopReason) => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const remainingMs = new Date(run.deadline_at).getTime() - Date.now();
    const deadlineTimer = setTimeout(() => abort('deadline'), Math.max(0, remainingMs));
    let lastHeartbeat = Date.now();
    const watcher = setInterval(() => {
      void (async () => {
        const extend = Date.now() - lastHeartbeat >= HEARTBEAT_MS;
        const rows = (await this.dataSource.query(
          extend
            ? `UPDATE ai_runs SET lease_expires_at = now() + ($3 || ' seconds')::interval, heartbeat_at = now()
                WHERE id = $1 AND lease_owner = $2 RETURNING status`
            : `SELECT status FROM ai_runs WHERE id = $1 AND (lease_owner = $2 OR status = 'cancelled')`,
          extend ? [run.id, this.workerId, String(LEASE_SECONDS)] : [run.id, this.workerId],
        )) as { status: RunStatus }[] | [{ status: RunStatus }[], number];
        if (extend) lastHeartbeat = Date.now();
        const list = Array.isArray(rows[0]) ? (rows[0] as { status: RunStatus }[]) : (rows as { status: RunStatus }[]);
        if (list[0]?.status === 'cancelled' || list.length === 0) abort('cancelled');
      })().catch(() => undefined);
    }, CANCEL_POLL_MS);

    let deltaBuffer = '';
    let deltaTimer: NodeJS.Timeout | null = null;
    const flush = async () => {
      if (deltaTimer) clearTimeout(deltaTimer);
      deltaTimer = null;
      if (!deltaBuffer) return;
      const text = deltaBuffer;
      deltaBuffer = '';
      await this.runs.event(run.id, 'delta', { text });
    };
    let seq = run.checkpoint_seq;
    let iterations = run.iterations;
    let tokensIn = Number(run.tokens_in);
    let tokensOut = Number(run.tokens_out);
    const budget = run.token_budget === null ? null : Number(run.token_budget);
    const conversationId = run.conversation_id!;
    let loopResult: ToolLoopResult | null = null;

    try {
      await this.runs.event(run.id, 'status', { status: 'running', attempt: run.attempt, worker: this.workerId });
      const auth = await this.authFor(run.user_id);
      const conversation = (await this.dataSource.query(
        `SELECT mode, counterpart_style FROM conversations WHERE id = $1`,
        [conversationId],
      )) as { mode: 'second_brain' | 'counterpart'; counterpart_style: string | null }[];
      if (!conversation[0]) throw new AppError(ERROR_CODES.notFound, 'Percakapan sudah dihapus.', 404);
      if (run.result_message_id) {
        // Dilanjutkan setelah batas: jawaban sementara diganti hasil akhir yang baru.
        await this.dataSource.query(`DELETE FROM conversation_messages WHERE id = $1`, [run.result_message_id]);
        await this.dataSource.query(`UPDATE ai_runs SET result_message_id = NULL WHERE id = $1`, [run.id]);
      }
      const historyRows = (await this.dataSource.query(
        `SELECT id, role, content, model, tokens_in, tokens_out, created_at FROM conversation_messages
          WHERE conversation_id = $1 AND id <= $2 ORDER BY id`,
        [conversationId, run.options.promptMessageId],
      )) as ConversationMessageRow[];
      const checkpointRows = (await this.dataSource.query(
        `SELECT message FROM ai_run_messages WHERE run_id = $1 ORDER BY seq`,
        [run.id],
      )) as { message: ChatMessage }[];
      const transcript = checkpointRows.map((r) => r.message);

      const pendingApprovals: string[] = [];
      const handlers = (
        await this.chatTools.handlersFor(auth, conversationId, pendingApprovals, controller.signal)
      ).map((h) => this.idempotent(run.id, h));

      // Langkah yang terpotong: asisten meminta tool tetapi hasilnya belum tersimpan.
      const last = transcript.at(-1);
      if (last?.role === 'assistant' && last.toolCalls?.length) {
        const byName = new Map(handlers.map((h) => [h.tool.name, h]));
        for (const call of last.toolCalls) {
          const handler = byName.get(call.name);
          const outcome: ToolOutcome = handler
            ? await handler.execute(call.input ?? {}, call)
            : { status: 'error', content: UNKNOWN_TOOL_STATE };
          const message: ChatMessage = {
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: clampToolResult(outcome.content || '(kosong)'),
            ...(outcome.status === 'ok' ? {} : { isError: true }),
          };
          transcript.push(message);
          seq += 1;
          await this.checkpoint(run, seq, message);
        }
      }

      const context = await this.attachments.chatContext(conversationId);
      const memory = await this.turns.memoryFor(auth, conversationId, run.prompt ?? '');
      const message = await this.turns.toolTurn(
        auth,
        conversationId,
        handlers,
        pendingApprovals,
        {
          mode: conversation[0].mode,
          ...(conversation[0].counterpart_style ? { counterpartStyle: conversation[0].counterpart_style } : {}),
          messages: [...this.conversations.toChatMessages(historyRows), ...transcript],
          ...(context.text ? { extraContext: context.text } : {}),
          ...(context.images.length > 0 ? { images: context.images } : {}),
          signal: controller.signal,
          memory,
        },
        (event, payload) => {
          if (event === 'delta') {
            deltaBuffer += (payload as { text: string }).text;
            deltaTimer ??= setTimeout(() => void flush(), DELTA_FLUSH_MS);
            return;
          }
          void flush().then(() => this.runs.event(run.id, event, payload as Record<string, unknown>));
        },
        {
          extras: {
            longRun: true,
            maxIterations: Math.max(1, run.max_iterations - run.iterations),
            ...(run.model_id ? { modelId: run.model_id } : {}),
            onCompaction: (info) => void this.runs.event(run.id, 'compaction', info),
          },
          onResult: (result) => {
            loopResult = result;
          },
          onLoopEvent: async (event) => {
            if (event.type === 'assistant') {
              iterations += 1;
              seq += 1;
              await this.checkpoint(run, seq, { role: 'assistant', content: event.content, toolCalls: event.toolCalls });
              await this.dataSource.query(`UPDATE ai_runs SET iterations = $2 WHERE id = $1`, [run.id, iterations]);
            } else if (event.type === 'tool_result' && event.outcome.status !== 'pending_approval') {
              seq += 1;
              await this.checkpoint(run, seq, {
                role: 'tool',
                toolCallId: event.call.id,
                toolName: event.call.name,
                content: clampToolResult(event.outcome.content || '(kosong)'),
                ...(event.outcome.status === 'error' ? { isError: true } : {}),
              });
            } else if (event.type === 'usage') {
              tokensIn += event.tokensIn;
              tokensOut += event.tokensOut;
              await this.dataSource.query(`UPDATE ai_runs SET tokens_in = $2, tokens_out = $3 WHERE id = $1`, [
                run.id,
                tokensIn,
                tokensOut,
              ]);
              await this.runs.event(run.id, 'usage', { tokensIn, tokensOut, iterations });
              if (budget !== null && tokensIn + tokensOut >= budget) abort('budget');
            }
          },
        },
      );
      await flush();
      await this.dataSource.query(`UPDATE conversation_messages SET run_id = $2 WHERE id = $1`, [message.id, run.id]);
      const result = loopResult as ToolLoopResult | null;
      const status: RunStatus =
        result?.stop === 'max_iterations' ? 'budget_exhausted' : result?.stop === 'pending_approval' ? 'waiting_approval' : 'completed';
      await this.finish(run, status, {
        resultMessageId: String(message.id),
        ...(status === 'budget_exhausted' ? { error: 'Batas langkah tercapai.', errorCode: 'RUN_MAX_ITERATIONS' } : {}),
      });
      await this.runs.event(run.id, 'done', { status, message });
      this.turns.afterTurn(auth, conversationId);
    } catch (error) {
      await flush().catch(() => undefined);
      const reason = controller.signal.aborted ? (controller.signal.reason as StopReason) : null;
      if (reason === 'shutdown') {
        await this.dataSource.query(
          `UPDATE ai_runs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, attempt = GREATEST(attempt - 1, 0)
            WHERE id = $1 AND status = 'running'`,
          [run.id],
        );
        await this.runs.event(run.id, 'status', { status: 'queued', requeued: true });
        return;
      }
      const code = (error as { code?: string }).code ?? null;
      const status: RunStatus =
        reason === 'cancelled'
          ? 'cancelled'
          : reason === 'deadline'
            ? 'deadline_exceeded'
            : reason === 'budget' || code === ERROR_CODES.aiQuotaExceeded
              ? 'budget_exhausted'
              : 'failed';
      const text =
        status === 'cancelled'
          ? 'Proses dihentikan.'
          : status === 'deadline_exceeded'
            ? 'Waktu kerja habis.'
            : reason === 'budget'
              ? 'Anggaran token proses ini habis.'
              : error instanceof Error
                ? error.message
                : 'Kesalahan tidak dikenal.';
      // Simpan pekerjaan sejauh ini agar tidak hilang dari percakapan.
      let resultMessageId: string | null = null;
      const checkpoint = (await this.dataSource.query(
        `SELECT message FROM ai_run_messages WHERE run_id = $1 ORDER BY seq DESC`,
        [run.id],
      )) as { message: ChatMessage }[];
      const lastText = checkpoint.find((r) => r.message.role === 'assistant' && r.message.content.trim())?.message.content;
      if (lastText || status !== 'failed') {
        const saved = await this.conversations.completeTurn(conversationId, {
          content: `${lastText ? `${lastText}\n\n` : ''}_${text}_`,
          model: null,
          modelId: run.model_id,
          tokensIn,
          tokensOut,
        });
        resultMessageId = String(saved.id);
        await this.dataSource.query(`UPDATE conversation_messages SET run_id = $2 WHERE id = $1`, [saved.id, run.id]);
      }
      await this.finish(run, status, { resultMessageId, error: text, errorCode: code ?? (reason ? `RUN_${reason.toUpperCase()}` : null) });
      await this.runs.event(run.id, status === 'failed' ? 'error' : 'done', {
        status,
        error: text,
        code,
      });
    } finally {
      clearTimeout(deadlineTimer);
      clearInterval(watcher);
      if (deltaTimer) clearTimeout(deltaTimer);
      this.active.delete(run.id);
    }
  }
}
