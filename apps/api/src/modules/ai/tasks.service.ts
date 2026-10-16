import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUDIT_EVENTS, type AiTaskStatus } from '@contributor/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from './gateway.service';

export interface TaskRow {
  id: string;
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
}

export interface TaskEventRow {
  id: string;
  event_type: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

const OPEN_STATUSES: readonly AiTaskStatus[] = ['created', 'validating', 'awaiting_approval', 'running'];
const RUNNABLE_STATUSES: readonly AiTaskStatus[] = ['created', 'failed', 'cancelled'];

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly gateway: AiGatewayService,
    private readonly audit: AuditService,
  ) {}

  async create(auth: AuthContext, input: { title: string; instruction: string }): Promise<TaskRow> {
    const rows = (await this.dataSource.query(
      `INSERT INTO ai_tasks (user_id, title, instruction) VALUES ($1, $2, $3) RETURNING *`,
      [auth.user.id, input.title, input.instruction],
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
    const params: unknown[] = [auth.user.id];
    let where = 'user_id = $1';
    if (options.status) {
      params.push(options.status);
      where += ` AND status = $${params.length}`;
    }
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM ai_tasks WHERE ${where}`,
      params,
    )) as { total: number }[];
    params.push(options.take, options.skip);
    const items = (await this.dataSource.query(
      `SELECT * FROM ai_tasks WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )) as TaskRow[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  async detail(auth: AuthContext, taskId: string): Promise<TaskRow & { events: TaskEventRow[] }> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM ai_tasks WHERE id = $1 AND user_id = $2`,
      [taskId, auth.user.id],
    )) as TaskRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Tugas tidak ditemukan.', 404);
    }
    const events = (await this.dataSource.query(
      `SELECT id, event_type, message, payload, created_at
         FROM ai_task_events WHERE task_id = $1 ORDER BY id`,
      [taskId],
    )) as TaskEventRow[];
    return { ...rows[0]!, events };
  }

  /**
   * Jalankan tugas: created → validating → running → completed/failed.
   * Klaim status bersifat atomik agar dua permintaan run bersamaan tidak dobel.
   */
  async run(auth: AuthContext, taskId: string): Promise<TaskRow> {
    const task = await this.mustOwn(auth, taskId);
    const claimed = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'validating', updated_at = now()
          WHERE id = $1 AND status = ANY($2) RETURNING id`,
        [taskId, RUNNABLE_STATUSES],
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
      const result = await this.gateway.chat({
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
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
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
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
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

  private async mustOwn(auth: AuthContext, taskId: string): Promise<TaskRow> {
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
