import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUDIT_EVENTS, type AiTaskStatus } from '@bara/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import { applyLoopEvent, loopContent, type ToolTraceStep } from './chat-tools.service';
import { AiGatewayService, type ToolHandler } from './gateway.service';
import { WebSearchService } from './web-search/web-search.service';

export interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  instruction: string;
  status: AiTaskStatus;
  result: string | null;
  error_message: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  agent_id?: string | null;
  group_id?: string | null;
  parent_task_id?: string | null;
  agent_name?: string | null;
  group_name?: string | null;
  group_mode?: 'delegate' | 'discussion' | null;
  web_search?: boolean;
}

const TASK_SELECT = `
  SELECT t.*, a.name AS agent_name, a.avatar_color AS agent_color, g.name AS group_name, g.mode AS group_mode
    FROM ai_tasks t
    LEFT JOIN agents a ON a.id = t.agent_id
    LEFT JOIN agent_groups g ON g.id = t.group_id`;

export interface TaskEventRow {
  id: string;
  event_type: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

const OPEN_STATUSES: readonly AiTaskStatus[] = [
  'created',
  'validating',
  'awaiting_approval',
  'running',
  'needs_input',
];
const RUNNABLE_STATUSES: readonly AiTaskStatus[] = ['created', 'failed', 'cancelled'];

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly gateway: AiGatewayService,
    private readonly audit: AuditService,
    private readonly webSearch: WebSearchService,
  ) {}

  async create(
    auth: AuthContext,
    input: { title: string; instruction: string; webSearch?: boolean },
  ): Promise<TaskRow> {
    const rows = (await this.dataSource.query(
      `INSERT INTO ai_tasks (user_id, title, instruction, web_search) VALUES ($1, $2, $3, $4) RETURNING *`,
      [auth.user.id, input.title, input.instruction, input.webSearch === true],
    )) as TaskRow[];
    const task = rows[0]!;
    await this.recordEvent(task.id, 'created', 'Tugas dibuat dan menunggu dijalankan.');
    await this.audit.record({
      eventKey: AUDIT_EVENTS.aiTaskCreated,
      severity: 'info',
      summary: `Membuat tugas "${task.title}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'ai_task',
      entityId: task.id,
      payload: { title: task.title },
    });
    return task;
  }

  async list(
    auth: AuthContext,
    options: { status?: AiTaskStatus; skip: number; take: number },
  ): Promise<{ items: TaskRow[]; total: number }> {
    // Sub-tugas delegasi ditampilkan di dalam tugas induknya, bukan di daftar utama.
    const params: unknown[] = [auth.user.id];
    let where = 't.user_id = $1 AND t.parent_task_id IS NULL';
    if (options.status) {
      params.push(options.status);
      where += ` AND t.status = $${params.length}`;
    }
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM ai_tasks t WHERE ${where}`,
      params,
    )) as { total: number }[];
    params.push(options.take, options.skip);
    const items = (await this.dataSource.query(
      `${TASK_SELECT} WHERE ${where} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )) as TaskRow[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  async detail(
    auth: AuthContext,
    taskId: string,
    afterEventId = 0,
  ): Promise<TaskRow & { events: TaskEventRow[]; children: TaskRow[] }> {
    const rows = (await this.dataSource.query(`${TASK_SELECT} WHERE t.id = $1 AND t.user_id = $2`, [
      taskId,
      auth.user.id,
    ])) as TaskRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Tugas tidak ditemukan.', 404);
    }
    const events = (await this.dataSource.query(
      `SELECT id, event_type, message, payload, created_at
         FROM ai_task_events WHERE task_id = $1 AND id > $2 ORDER BY id`,
      [taskId, afterEventId],
    )) as TaskEventRow[];
    const children = (await this.dataSource.query(
      `${TASK_SELECT} WHERE t.parent_task_id = $1 ORDER BY t.created_at`,
      [taskId],
    )) as TaskRow[];
    return { ...rows[0]!, events, children };
  }

  /**
   * Jalankan tugas: created → validating → running → completed/failed.
   * Klaim status bersifat atomik agar dua permintaan run bersamaan tidak dobel.
   */
  async run(auth: AuthContext, taskId: string): Promise<TaskRow> {
    const task = await this.mustOwn(auth, taskId);
    return this.claimAndExecute(auth, taskId, task);
  }

  /**
   * Jalankan tugas tanpa pemeriksaan kepemilikan — dipakai alur persetujuan agen,
   * di mana approver yang menjalankan berbeda dengan peminta. `fromStatuses`
   * menentukan status sumber yang boleh diklaim (default: runnable biasa).
   */
  async runAs(
    actor: AuthContext,
    taskId: string,
    fromStatuses: readonly AiTaskStatus[] = RUNNABLE_STATUSES,
  ): Promise<TaskRow> {
    const rows = (await this.dataSource.query(`SELECT * FROM ai_tasks WHERE id = $1`, [
      taskId,
    ])) as TaskRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Tugas tidak ditemukan.', 404);
    }
    return this.claimAndExecute(actor, taskId, rows[0]!, fromStatuses);
  }

  private async claimAndExecute(
    actor: AuthContext,
    taskId: string,
    task: TaskRow,
    fromStatuses: readonly AiTaskStatus[] = RUNNABLE_STATUSES,
  ): Promise<TaskRow> {
    const claimed = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'validating', updated_at = now()
          WHERE id = $1 AND status = ANY($2) RETURNING id`,
        [taskId, fromStatuses],
      ),
    );
    if (claimed.length === 0) {
      throw new AppError(
        ERROR_CODES.conflict,
        `Tugas berstatus "${task.status}" tidak dapat dijalankan.`,
        409,
      );
    }

    await this.recordEvent(taskId, 'validating', 'Instruksi divalidasi dan disiapkan.');
    await this.dataSource.query(
      `UPDATE ai_tasks SET status = 'running', started_at = now(), updated_at = now() WHERE id = $1`,
      [taskId],
    );
    await this.recordEvent(taskId, 'running', 'Menghubungi penyedia AI…');
    const startedAt = Date.now();

    try {
      const webHandlers = await this.webSearch.taskHandlers(task.web_search, {
        userId: task.user_id,
        taskId,
      });
      const result =
        webHandlers.length > 0
          ? await this.runWithWeb(taskId, task, webHandlers)
          : await this.gateway.chat({
              guard: { userId: task.user_id, taskId },
              mode: 'subordinate',
              messages: [{ role: 'user', content: task.instruction }],
            });
      const durationMs = Date.now() - startedAt;
      const updated = updatedRows<TaskRow>(
        await this.dataSource.query(
          `UPDATE ai_tasks
              SET status = 'completed', result = $2, model = $3, tokens_in = $4, tokens_out = $5,
                  duration_ms = $6, finished_at = now(), updated_at = now()
            WHERE id = $1 RETURNING *`,
          [taskId, result.content, result.model, result.tokensIn, result.tokensOut, durationMs],
        ),
      );
      await this.recordEvent(taskId, 'completed', 'Tugas selesai.', {
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        durationMs,
      });
      await this.audit.record({
        eventKey: AUDIT_EVENTS.aiTaskCompleted,
        severity: 'info',
        summary: `Menyelesaikan tugas "${task.title}"`,
        actorUserId: actor.user.id,
        actorLabel: actor.user.email,
        actorIp: actor.session.ip,
        entityType: 'ai_task',
        entityId: taskId,
        payload: { durationMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut },
      });
      return updated[0]!;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : 'Kesalahan tidak dikenal.';
      this.logger.warn(`Tugas ${taskId} gagal: ${message}`);
      const updated = updatedRows<TaskRow>(
        await this.dataSource.query(
          `UPDATE ai_tasks
              SET status = 'failed', error_message = $2, duration_ms = $3, finished_at = now(), updated_at = now()
            WHERE id = $1 RETURNING *`,
          [taskId, message.slice(0, 500), durationMs],
        ),
      );
      await this.recordEvent(taskId, 'failed', message.slice(0, 300), {
        durationMs,
      });
      await this.audit.record({
        eventKey: AUDIT_EVENTS.aiTaskFailed,
        severity: 'warn',
        summary: `Tugas "${task.title}" gagal: ${message.slice(0, 120)}`,
        actorUserId: actor.user.id,
        actorLabel: actor.user.email,
        actorIp: actor.session.ip,
        entityType: 'ai_task',
        entityId: taskId,
        payload: { durationMs },
      });
      return updated[0]!;
    }
  }

  async cancel(auth: AuthContext, taskId: string): Promise<TaskRow> {
    const task = await this.mustOwn(auth, taskId);
    const claimed = updatedRows<TaskRow>(
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'cancelled', updated_at = now(), finished_at = now()
          WHERE id = $1 AND status = ANY($2) RETURNING *`,
        [taskId, OPEN_STATUSES],
      ),
    );
    if (claimed.length === 0) {
      throw new AppError(
        ERROR_CODES.conflict,
        `Tugas berstatus "${task.status}" sudah tidak dapat dibatalkan.`,
        409,
      );
    }
    await this.recordEvent(taskId, 'cancelled', 'Tugas dibatalkan oleh pengguna.');
    await this.audit.record({
      eventKey: AUDIT_EVENTS.aiTaskCancelled,
      severity: 'info',
      summary: `Membatalkan tugas "${task.title}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'ai_task',
      entityId: taskId,
      payload: {},
    });
    return claimed[0]!;
  }

  /** Tugas umum dengan pencarian web: loop tool, tiap langkah dicatat sebagai event. */
  private async runWithWeb(taskId: string, task: TaskRow, handlers: ToolHandler[]) {
    const handlerMap = new Map(handlers.map((h) => [h.tool.name, h]));
    const steps: ToolTraceStep[] = [];
    const loop = await this.gateway.drainToolLoop(
      {
        guard: { userId: task.user_id, taskId },
        mode: 'subordinate',
        messages: [{ role: 'user', content: task.instruction }],
        handlers,
        toolRules: this.webSearch.toolRules(handlers),
      },
      async (event) => {
        const step = applyLoopEvent(steps, event, handlerMap);
        if (step && event.type === 'tool_result') {
          await this.recordEvent(taskId, 'tool_result', `${step.label}: ${step.summary}`, {
            ...step,
          });
        }
      },
    );
    return {
      content: loopContent(loop) || 'Penyedia AI tidak mengembalikan jawaban.',
      model: loop.model,
      tokensIn: loop.tokensIn,
      tokensOut: loop.tokensOut,
    };
  }

  async mustOwn(auth: AuthContext, taskId: string): Promise<TaskRow> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM ai_tasks WHERE id = $1 AND user_id = $2`,
      [taskId, auth.user.id],
    )) as TaskRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Tugas tidak ditemukan.', 404);
    }
    return rows[0]!;
  }

  private async recordEvent(
    taskId: string,
    eventType: string,
    message: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ai_task_events (task_id, event_type, message, payload) VALUES ($1, $2, $3, $4)`,
      [taskId, eventType, message, JSON.stringify(payload)],
    );
  }
}
