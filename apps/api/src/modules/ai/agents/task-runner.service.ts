import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AUDIT_EVENTS, PERMISSIONS } from '@bara/shared';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import type { AuthContext } from '../../../common/types/auth-context';
import { DATA_SOURCE } from '../../../database/database.module';
import { updatedRows } from '../../../database/query-result';
import { AuditService } from '../../audit/audit.service';
import { MemoryExtractionService } from '../../memory/memory-extraction.service';
import { MemoryService } from '../../memory/memory.service';
import { EffectivePermissionsService } from '../../rbac/effective-permissions.service';
import {
  ConnectorToolsService,
  type ConnectorAttachment,
  type ToolContext,
} from '../../connectors/connector-tools.service';
import { applyLoopEvent, loopContent, type ToolTraceStep } from '../chat-tools.service';
import {
  AiGatewayService,
  clampToolResult,
  type ToolHandler,
  type ToolLoopEvent,
  type ToolLoopResult,
  type ToolOutcome,
} from '../gateway.service';
import { AI_LIMITS } from '../limits';
import type { ChatMessage } from '../providers/types';
import { ToolApprovalsService } from '../tool-approvals.service';
import type { TaskRow } from '../tasks.service';
import { WebSearchService } from '../web-search/web-search.service';
import { buildAgentPrompt, type AgentProfile, type SkillContent } from './agent-prompt';
import type { AgentTaskDto } from './dto/agents.dto';

/** Penanda khusus: loop berhenti karena agent meminta klarifikasi pengguna. */
export const NEEDS_INPUT = 'needs_input';
const CLARIFY_TOOL = 'minta_klarifikasi';
const DELEGATE_TOOL = 'delegasikan';
const CONCURRENCY = 3;
/** Seberapa sering lease kedaluwarsa diperiksa dan tugas 'created' tanpa pemilik diambil. */
const RECOVERY_MS = 30_000;
const MAX_TASK_ATTEMPTS = 3;
const MAX_DELEGATIONS = 6;
const DISCUSSION_MAX_TURN_CHARS = 4000;

interface AgentRecord extends AgentProfile {
  owner_user_id: string;
  status: 'active' | 'inactive';
  avatar_color: string | null;
}

interface GroupRecord {
  id: string;
  name: string;
  mode: 'delegate' | 'discussion';
  leader_agent_id: string;
  max_rounds: number;
  members: { id: string; name: string; position: number }[];
}

interface RunnerTask extends TaskRow {
  user_id: string;
  agent_id: string | null;
  group_id: string | null;
  parent_task_id: string | null;
}

/**
 * Runner tugas agent pribadi dan grup agent (antrean in-process).
 * - Satu agent: loop tool dengan konektor agent; dapat berhenti untuk persetujuan tulis
 *   atau klarifikasi, lalu dilanjutkan dari state `ai_task_messages`.
 * - Grup delegasi: Leader memanggil tool `delegasikan` → sub-tugas anggota (child task).
 * - Grup diskusi: anggota bergiliran beberapa ronde, Leader menyusun kesimpulan.
 */
@Injectable()
export class TaskRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TaskRunnerService.name);
  private readonly queue: string[] = [];
  private readonly active = new Map<string, AbortController>();
  private destroyed = false;
  /** Identitas pemegang lease tugas (lihat ai_runs kind='task'). */
  private readonly workerId = `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly gateway: AiGatewayService,
    private readonly connectorTools: ConnectorToolsService,
    private readonly approvals: ToolApprovalsService,
    private readonly audit: AuditService,
    private readonly webSearch: WebSearchService,
    private readonly effective: EffectivePermissionsService,
    private readonly memory: MemoryService,
    private readonly memoryNotes: MemoryExtractionService,
  ) {}

  /** Izin memori pemilik tugas; runner berjalan di luar konteks permintaan HTTP. */
  private async memoryPermissions(userId: string): Promise<Set<string>> {
    const allowed = new Set<string>();
    for (const permission of [PERMISSIONS.memorySelfManage, PERMISSIONS.memoryDoorsOpen]) {
      if ((await this.effective.can(userId, permission)).allowed) allowed.add(permission);
    }
    return allowed;
  }

  async onApplicationBootstrap(): Promise<void> {
    // Tugas lama tanpa lease (sebelum kerja panjang) yang tertinggal "running" saat server mati
    // dilanjutkan dari state ai_task_messages, bukan digagalkan.
    await this.dataSource.query(
      `UPDATE ai_tasks SET status = 'created', updated_at = now()
        WHERE status IN ('running', 'validating') AND current_run_id IS NULL
          AND (agent_id IS NOT NULL OR group_id IS NOT NULL)
          AND updated_at < now() - interval '2 minutes'
          AND EXISTS (SELECT 1 FROM ai_task_messages m WHERE m.task_id = ai_tasks.id)`,
    );
    await this.recover();
    if (process.env.AI_WORKER_ENABLED !== 'false') {
      this.recoveryTimer = setInterval(() => void this.recover().catch(() => undefined), RECOVERY_MS);
    }
  }

  /**
   * Lease tugas kedaluwarsa (instance mati) → kembali ke antrean dan dilanjutkan dari checkpoint;
   * setelah MAX_TASK_ATTEMPTS percobaan → gagal. Tugas 'created' yang belum diambil siapa pun ikut diantrekan.
   */
  async recover(): Promise<void> {
    const failed = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE ai_tasks t SET status = 'failed', finished_at = now(), updated_at = now(),
                error_message = 'Tugas terhenti berulang kali karena gangguan server.'
           FROM ai_runs r
          WHERE r.id = t.current_run_id AND t.status = 'running'
            AND r.lease_expires_at < now() AND r.attempt >= $1
          RETURNING t.id`,
        [MAX_TASK_ATTEMPTS],
      ),
    );
    for (const row of failed) await this.event(row.id, 'failed', 'Tugas terhenti berulang kali karena gangguan server.');
    const requeued = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE ai_tasks t SET status = 'created', updated_at = now()
           FROM ai_runs r
          WHERE r.id = t.current_run_id AND t.status = 'running'
            AND r.lease_expires_at < now() AND r.attempt < $1
          RETURNING t.id`,
        [MAX_TASK_ATTEMPTS],
      ),
    );
    for (const row of requeued) await this.event(row.id, 'resumed', 'Dilanjutkan setelah gangguan server.');
    const queued = (await this.dataSource.query(
      `SELECT t.id FROM ai_tasks t
        WHERE t.status = 'created' AND t.parent_task_id IS NULL
          AND EXISTS (SELECT 1 FROM ai_task_messages m WHERE m.task_id = t.id)
        ORDER BY t.created_at`,
    )) as { id: string }[];
    for (const row of queued) this.enqueue(row.id);
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    for (const controller of this.active.values()) controller.abort();
  }

  // ───────────────────────── API publik ─────────────────────────

  async create(auth: AuthContext, dto: AgentTaskDto): Promise<RunnerTask> {
    if (Boolean(dto.agentId) === Boolean(dto.groupId)) {
      throw new AppError(ERROR_CODES.validation, 'Pilih salah satu: agent atau grup.', 400);
    }
    let leaderId: string;
    let label: string;
    if (dto.agentId) {
      const agent = await this.loadAgent(dto.agentId, auth.user.id);
      if (agent.status !== 'active')
        throw new AppError(ERROR_CODES.conflict, `Agent "${agent.name}" nonaktif.`, 409);
      leaderId = agent.id;
      label = agent.name;
    } else {
      const group = await this.loadGroup(dto.groupId!, auth.user.id);
      leaderId = group.leader_agent_id;
      label = group.name;
    }
    this.webSearch.assertAllowed(auth, dto.webSearch);
    const memoryDoors = await this.memory.assertOpenable(auth, dto.memorySubjectIds ?? []);
    const instruction = dto.instruction.trim();
    const title = dto.title?.trim() || makeTitle(instruction);
    const rows = (await this.dataSource.query(
      `INSERT INTO ai_tasks (user_id, agent_id, group_id, title, instruction, status, web_search)
       VALUES ($1, $2, $3, $4, $5, 'created', $6) RETURNING *`,
      [
        auth.user.id,
        dto.agentId ?? null,
        dto.groupId ?? null,
        title,
        instruction,
        dto.webSearch === true,
      ],
    )) as RunnerTask[];
    const task = rows[0]!;
    if (memoryDoors.length > 0) {
      await this.memory.setContextDoors(auth, { kind: 'task', id: task.id }, memoryDoors);
    }
    await this.appendMessage(task.id, leaderId, { role: 'user', content: instruction });
    await this.event(
      task.id,
      'created',
      `Tugas untuk ${dto.groupId ? 'grup' : 'agent'} "${label}" masuk antrean.`,
    );
    await this.audit.record({
      eventKey: AUDIT_EVENTS.aiTaskCreated,
      severity: 'info',
      summary: `Membuat tugas "${title}" untuk ${label}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'ai_task',
      entityId: task.id,
      payload: { agentId: dto.agentId ?? null, groupId: dto.groupId ?? null },
    });
    this.enqueue(task.id);
    return task;
  }

  /** Jalankan ulang tugas agent/grup yang gagal atau dibatalkan dari state terakhir. */
  async retry(auth: AuthContext, taskId: string): Promise<RunnerTask> {
    const task = await this.ownTask(auth.user.id, taskId);
    const claimed = updatedRows<RunnerTask>(
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'created', error_message = NULL, finished_at = NULL, updated_at = now()
          WHERE id = $1 AND status IN ('failed', 'cancelled') RETURNING *`,
        [taskId],
      ),
    );
    if (claimed.length === 0) {
      throw new AppError(
        ERROR_CODES.conflict,
        `Tugas berstatus "${task.status}" tidak dapat dijalankan ulang.`,
        409,
      );
    }
    await this.event(taskId, 'created', 'Tugas dijalankan ulang.');
    this.enqueue(taskId);
    return claimed[0]!;
  }

  /** Balas klarifikasi (needs_input) atau beri instruksi lanjutan pada tugas yang selesai. */
  async reply(auth: AuthContext, taskId: string, message: string): Promise<RunnerTask> {
    const task = await this.ownTask(auth.user.id, taskId);
    if (!task.agent_id && !task.group_id) {
      throw new AppError(ERROR_CODES.conflict, 'Tugas tanpa agent tidak mendukung balasan.', 409);
    }
    const asGroup = Boolean(task.group_id && !task.parent_task_id);
    if (asGroup && (await this.loadGroup(task.group_id!, auth.user.id)).mode === 'discussion') {
      throw new AppError(
        ERROR_CODES.conflict,
        'Diskusi grup tidak dapat dilanjutkan; buat tugas baru.',
        409,
      );
    }
    const leaderId = asGroup
      ? (await this.loadGroup(task.group_id!, auth.user.id)).leader_agent_id
      : task.agent_id!;
    const text = message.trim();
    if (task.status === 'needs_input') {
      const rows = (await this.dataSource.query(
        `SELECT payload FROM ai_task_events WHERE task_id = $1 AND event_type = 'needs_input' ORDER BY id DESC LIMIT 1`,
        [taskId],
      )) as { payload: { callId?: string } }[];
      const callId = rows[0]?.payload.callId;
      if (!callId)
        throw new AppError(ERROR_CODES.conflict, 'Pertanyaan klarifikasi tidak ditemukan.', 409);
      await this.appendMessage(taskId, leaderId, {
        role: 'tool',
        toolCallId: callId,
        toolName: CLARIFY_TOOL,
        content: `Jawaban pengguna: ${text}`,
      });
    } else if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      await this.appendMessage(taskId, leaderId, { role: 'user', content: text });
    } else {
      throw new AppError(
        ERROR_CODES.conflict,
        `Tugas berstatus "${task.status}" belum dapat dibalas.`,
        409,
      );
    }
    await this.event(taskId, 'user_message', text.slice(0, 2000), { content: text });
    const claimed = updatedRows<RunnerTask>(
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'created', error_message = NULL, finished_at = NULL, updated_at = now()
          WHERE id = $1 AND status IN ('needs_input', 'completed', 'failed', 'cancelled') RETURNING *`,
        [taskId],
      ),
    );
    if (claimed.length === 0)
      throw new AppError(ERROR_CODES.conflict, 'Status tugas berubah; coba lagi.', 409);
    this.enqueue(taskId);
    return claimed[0]!;
  }

  /** Putuskan persetujuan tool pada tugas, lalu lanjutkan tugas. */
  async decide(
    auth: AuthContext,
    taskId: string,
    approvalId: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ): Promise<RunnerTask> {
    await this.ownTask(auth.user.id, taskId);
    const existing = await this.approvals.detail(auth.user.id, approvalId);
    if (existing.task_id !== taskId)
      throw new AppError(ERROR_CODES.notFound, 'Persetujuan tidak ditemukan.', 404);
    const approval = await this.approvals.claim(auth, approvalId, decision, note);
    const task = await this.ownTask(auth.user.id, taskId);
    const agentId = approval.agent_id ?? task.agent_id;
    const outcome: ToolOutcome =
      decision === 'approved' && approval.payload
        ? await this.connectorTools.executeApprovedWrite(
            { userId: auth.user.id, agentId, taskId },
            approval.payload,
            approvalId,
          )
        : {
            status: 'error',
            content: `Pengguna menolak operasi ini${note ? `: ${note}` : ''}. Jangan mengulanginya tanpa diminta.`,
          };
    await this.appendMessage(taskId, agentId, {
      role: 'tool',
      toolCallId: approval.tool_call_id ?? approvalId,
      content: clampToolResult(outcome.content || '(kosong)'),
      ...(outcome.status === 'ok' ? {} : { isError: true }),
    });
    await this.event(
      taskId,
      decision === 'approved' ? 'approved' : 'rejected',
      decision === 'approved'
        ? outcome.status === 'ok'
          ? 'Operasi disetujui dan dijalankan.'
          : `Operasi disetujui tetapi gagal: ${outcome.content.slice(0, 200)}`
        : `Operasi ditolak${note ? `: ${note}` : ''}.`,
      { approvalId, status: outcome.status },
    );
    const claimed = updatedRows<RunnerTask>(
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'created', updated_at = now() WHERE id = $1 AND status = 'awaiting_approval' RETURNING *`,
        [taskId],
      ),
    );
    if (claimed.length > 0) this.enqueue(taskId);
    return claimed[0] ?? task;
  }

  /** Batalkan: hentikan loop yang berjalan (bila ada). Status diubah oleh TasksService.cancel. */
  abort(taskId: string): void {
    this.active.get(taskId)?.abort();
    const index = this.queue.indexOf(taskId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  isRunnerTask(task: { agent_id?: string | null; group_id?: string | null }): boolean {
    return Boolean(task.agent_id || task.group_id);
  }

  // ───────────────────────── Antrean ─────────────────────────

  enqueue(taskId: string): void {
    if (this.destroyed || this.queue.includes(taskId) || this.active.has(taskId)) return;
    this.queue.push(taskId);
    setImmediate(() => this.pump());
  }

  private pump(): void {
    while (!this.destroyed && this.active.size < CONCURRENCY && this.queue.length > 0) {
      const taskId = this.queue.shift()!;
      const controller = new AbortController();
      this.active.set(taskId, controller);
      void this.execute(taskId, controller.signal)
        .catch((error: unknown) => this.logger.error(`Runner tugas ${taskId}: ${String(error)}`))
        .finally(() => {
          this.active.delete(taskId);
          this.pump();
        });
    }
  }

  /** Untuk tes: tunggu sampai antrean kosong dan tidak ada tugas berjalan. */
  async idle(timeoutMs = 10_000): Promise<void> {
    const started = Date.now();
    while (this.queue.length > 0 || this.active.size > 0) {
      if (Date.now() - started > timeoutMs) throw new Error('Runner tidak selesai tepat waktu');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private async execute(taskId: string, signal: AbortSignal): Promise<void> {
    const claimed = updatedRows<RunnerTask>(
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
          WHERE id = $1 AND status = 'created' RETURNING *`,
        [taskId],
      ),
    );
    const task = claimed[0];
    if (!task) return;
    const runId = await this.acquireLease(task);
    const heartbeat = setInterval(() => {
      void this.dataSource
        .query(
          `UPDATE ai_runs SET lease_expires_at = now() + interval '60 seconds', heartbeat_at = now()
            WHERE id = $1 AND lease_owner = $2`,
          [runId, this.workerId],
        )
        .catch(() => undefined);
    }, 20_000);
    await this.event(taskId, 'running', 'Agent mulai bekerja.');
    const startedAt = Date.now();
    try {
      // Sub-tugas delegasi (punya parent) dijalankan sebagai tugas agent biasa.
      if (task.group_id && !task.parent_task_id) {
        const group = await this.loadGroup(task.group_id, task.user_id);
        if (group.mode === 'discussion') await this.runDiscussion(task, group, signal, startedAt);
        else await this.runAgentTask(task, group.leader_agent_id, signal, startedAt, group);
      } else {
        await this.runAgentTask(task, task.agent_id!, signal, startedAt);
      }
    } catch (error) {
      if (signal.aborted) {
        await this.event(taskId, 'cancelled', 'Agent dihentikan.');
        return;
      }
      const message = error instanceof Error ? error.message : 'Kesalahan tidak dikenal.';
      this.logger.warn(`Tugas ${taskId} gagal: ${message}`);
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'failed', error_message = $2, duration_ms = $3, finished_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'running'`,
        [taskId, message.slice(0, 500), Date.now() - startedAt],
      );
      await this.event(taskId, 'failed', message.slice(0, 300));
      await this.audit.record({
        eventKey: AUDIT_EVENTS.aiTaskFailed,
        severity: 'warn',
        summary: `Tugas "${task.title}" gagal: ${message.slice(0, 120)}`,
        actorUserId: task.user_id,
        entityType: 'ai_task',
        entityId: taskId,
        payload: {},
      });
    } finally {
      clearInterval(heartbeat);
      await this.releaseLease(runId, taskId, signal.aborted && this.destroyed);
    }
  }

  /** Satu baris ai_runs per tugas: lease + jumlah percobaan untuk pemulihan antar-instance. */
  private async acquireLease(task: RunnerTask): Promise<string> {
    const rows = (await this.dataSource.query(
      `WITH existing AS (SELECT current_run_id AS id FROM ai_tasks WHERE id = $1)
       INSERT INTO ai_runs (id, kind, user_id, task_id, agent_id, status, max_iterations, deadline_at,
                            lease_owner, lease_expires_at, heartbeat_at, started_at, attempt)
       VALUES (COALESCE((SELECT id FROM existing), gen_random_uuid()), 'task', $2, $1, $3, 'running', $5,
               now() + interval '1 day', $4, now() + interval '60 seconds', now(), now(), 1)
       ON CONFLICT (id) DO UPDATE
         SET status = 'running', lease_owner = $4, lease_expires_at = now() + interval '60 seconds',
             heartbeat_at = now(), attempt = ai_runs.attempt + 1, finished_at = NULL
       RETURNING id`,
      [task.id, task.user_id, task.agent_id, this.workerId, AI_LIMITS.maxToolIterations],
    )) as { id: string }[];
    const runId = rows[0]!.id;
    await this.dataSource.query(`UPDATE ai_tasks SET current_run_id = $2 WHERE id = $1`, [task.id, runId]);
    return runId;
  }

  /** Lepas lease; saat shutdown tugas dikembalikan ke antrean agar instance lain melanjutkan. */
  private async releaseLease(runId: string, taskId: string, shuttingDown: boolean): Promise<void> {
    if (shuttingDown) {
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'created', updated_at = now() WHERE id = $1 AND status = 'running'`,
        [taskId],
      );
      await this.dataSource.query(
        `UPDATE ai_runs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
                attempt = GREATEST(attempt - 1, 0) WHERE id = $1`,
        [runId],
      );
      return;
    }
    await this.dataSource.query(
      `UPDATE ai_runs r
          SET lease_owner = NULL, lease_expires_at = NULL,
              status = CASE t.status
                WHEN 'completed' THEN 'completed'::ai_run_status
                WHEN 'failed' THEN 'failed'::ai_run_status
                WHEN 'cancelled' THEN 'cancelled'::ai_run_status
                WHEN 'needs_input' THEN 'waiting_input'::ai_run_status
                WHEN 'awaiting_approval' THEN 'waiting_approval'::ai_run_status
                ELSE 'queued'::ai_run_status END,
              finished_at = CASE WHEN t.status IN ('completed', 'failed', 'cancelled') THEN now() ELSE NULL END,
              iterations = 0
         FROM ai_tasks t
        WHERE r.id = $1 AND t.id = $2`,
      [runId, taskId],
    );
  }

  // ───────────────────────── Satu agent / Leader delegasi ─────────────────────────

  private async runAgentTask(
    task: RunnerTask,
    agentId: string,
    signal: AbortSignal,
    startedAt: number,
    group?: GroupRecord,
  ): Promise<void> {
    const agent = await this.loadAgent(agentId, task.user_id);
    const messages = await this.repairInterrupted(task.id, agent.id, await this.loadMessages(task.id));
    const delegation = group ? this.delegationHandler(task, group, signal) : null;
    const checkpoint = { count: 0 };
    const result = await this.runLoop(task, agent, messages, signal, {
      extraHandlers: delegation ? [delegation] : [],
      groupNote: group ? this.leaderNote(group) : undefined,
      allowApproval: true,
      allowClarify: true,
      checkpoint,
    });
    // Langkah sudah disimpan satu per satu; sisanya hanya pesan "tidak dijalankan" setelah persetujuan.
    await this.persistAppended(task.id, agent.id, result.appended.slice(checkpoint.count));
    await this.finish(task, result, startedAt);
  }

  /** Simpan hasil satu putaran loop dan pindahkan status tugas. */
  private async finish(task: RunnerTask, result: ToolLoopResult, startedAt: number): Promise<void> {
    const durationMs = Date.now() - startedAt;
    if (result.stop === 'pending_approval' && result.pending) {
      if (result.pending.approvalId === NEEDS_INPUT) {
        const question = String(
          result.pending.call.input?.pertanyaan ?? result.pending.call.input?.question ?? '',
        );
        await this.dataSource.query(
          `UPDATE ai_tasks SET status = 'needs_input', tokens_in = COALESCE(tokens_in, 0) + $2,
                  tokens_out = COALESCE(tokens_out, 0) + $3, model = $4, updated_at = now()
            WHERE id = $1 AND status = 'running'`,
          [task.id, result.tokensIn, result.tokensOut, result.model],
        );
        await this.event(
          task.id,
          'needs_input',
          question || 'Agent membutuhkan informasi tambahan.',
          {
            callId: result.pending.call.id,
            question,
          },
        );
        return;
      }
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'awaiting_approval', tokens_in = COALESCE(tokens_in, 0) + $2,
                tokens_out = COALESCE(tokens_out, 0) + $3, model = $4, updated_at = now()
          WHERE id = $1 AND status = 'running'`,
        [task.id, result.tokensIn, result.tokensOut, result.model],
      );
      const data = (result.pending.data ?? {}) as { connector?: string; statement?: string };
      await this.event(
        task.id,
        'approval_required',
        'Agent meminta persetujuan untuk operasi tulis.',
        {
          approvalId: result.pending.approvalId,
          callId: result.pending.call.id,
          tool: result.pending.call.name,
          connector: data.connector ?? null,
          statement: data.statement ?? null,
          purpose:
            typeof result.pending.call.input?.purpose === 'string'
              ? result.pending.call.input.purpose
              : null,
        },
      );
      return;
    }
    const content =
      loopContent(result) ||
      (result.stop === 'max_iterations' ? result.content : 'Agent tidak mengembalikan jawaban.');
    const updated = updatedRows<RunnerTask>(
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'completed', result = $2, model = $3,
                tokens_in = COALESCE(tokens_in, 0) + $4, tokens_out = COALESCE(tokens_out, 0) + $5,
                duration_ms = COALESCE(duration_ms, 0) + $6, finished_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'running' RETURNING *`,
        [task.id, content, result.model, result.tokensIn, result.tokensOut, Date.now() - startedAt],
      ),
    );
    if (updated.length === 0) return; // dibatalkan di tengah jalan
    await this.event(task.id, 'completed', 'Tugas selesai.', {
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      durationMs,
      iterations: result.iterations,
    });
    await this.audit.record({
      eventKey: AUDIT_EVENTS.aiTaskCompleted,
      severity: 'info',
      summary: `Menyelesaikan tugas "${task.title}"`,
      actorUserId: task.user_id,
      entityType: 'ai_task',
      entityId: task.id,
      payload: { durationMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut },
    });
    if (!task.parent_task_id) {
      const permissions = await this.memoryPermissions(task.user_id);
      if (permissions.has(PERMISSIONS.memorySelfManage)) this.memoryNotes.scheduleTask(task.id);
    }
  }

  /** Loop tool untuk satu agent; event dicatat ke tugas `eventTaskId`. */
  private async runLoop(
    task: RunnerTask,
    agent: AgentRecord,
    messages: ChatMessage[],
    signal: AbortSignal,
    options: {
      extraHandlers?: ToolHandler[];
      groupNote?: string;
      allowApproval: boolean;
      allowClarify: boolean;
      eventTaskId?: string;
      maxIterations?: number;
      /** Simpan setiap langkah ke ai_task_messages saat terjadi (dapat dilanjutkan setelah crash). */
      checkpoint?: { count: number };
    },
  ): Promise<ToolLoopResult> {
    const eventTaskId = options.eventTaskId ?? task.id;
    const ctx: ToolContext = {
      userId: task.user_id,
      agentId: agent.id,
      taskId: task.id,
      ...(options.allowApproval
        ? {
            requestApproval: (request) =>
              this.approvals.create(task.user_id, { taskId: task.id, agentId: agent.id }, request),
          }
        : {}),
    };
    const connectorHandlers = await this.connectorTools.buildHandlers(
      await this.agentConnectors(agent.id),
      ctx,
    );
    const webHandlers = await this.webSearch.taskHandlers(task.web_search, {
      userId: task.user_id,
      taskId: task.id,
      signal,
    });
    const handlers: ToolHandler[] = [
      ...connectorHandlers,
      ...webHandlers,
      ...(options.extraHandlers ?? []),
      ...(options.allowClarify ? [this.clarifyHandler()] : []),
    ];
    const systemPrompt = buildAgentPrompt(agent, await this.agentSkills(agent.id), {
      ownerName: await this.ownerName(task.user_id),
      today: new Date().toLocaleDateString('id-ID', {
        dateStyle: 'full',
        timeZone: 'Asia/Jakarta',
      }),
      ...(options.groupNote ? { groupNote: options.groupNote } : {}),
    });
    // Sub-tugas delegasi memakai pintu memori yang dibuka pada tugas induknya.
    const memory = await this.memory.retrieve(
      task.user_id,
      await this.memoryPermissions(task.user_id),
      { kind: 'task', id: task.parent_task_id ?? task.id },
      task.instruction,
      { agentId: agent.id },
    );
    const handlerMap = new Map(handlers.map((h) => [h.tool.name, h]));
    const steps: ToolTraceStep[] = [];
    return this.gateway.drainToolLoop(
      {
        guard: { userId: task.user_id, taskId: task.id },
        agentId: agent.id,
        mode: 'subordinate',
        systemPrompt,
        memoryContext: memory.block || undefined,
        toolRules:
          [
            this.connectorTools.toolRules(connectorHandlers),
            this.webSearch.toolRules(webHandlers),
          ]
            .filter(Boolean)
            .join('\n\n') || undefined,
        messages,
        handlers,
        signal,
        ...(options.maxIterations ? { maxIterations: options.maxIterations } : {}),
      },
      async (event: ToolLoopEvent) => {
        if (options.checkpoint) {
          if (event.type === 'assistant') {
            await this.appendMessage(task.id, agent.id, { role: 'assistant', content: event.content, toolCalls: event.toolCalls });
            options.checkpoint.count += 1;
          } else if (event.type === 'tool_result' && event.outcome.status !== 'pending_approval') {
            await this.appendMessage(task.id, agent.id, {
              role: 'tool',
              toolCallId: event.call.id,
              toolName: event.call.name,
              content: clampToolResult(event.outcome.content || '(kosong)'),
              ...(event.outcome.status === 'error' ? { isError: true } : {}),
            });
            options.checkpoint.count += 1;
          }
        }
        if (event.type === 'assistant') {
          if (event.content.trim()) {
            await this.event(eventTaskId, 'message', event.content.slice(0, 4000), {
              agentId: agent.id,
              agentName: agent.name,
              content: event.content,
            });
          }
          return;
        }
        if (event.type === 'delta' || event.type === 'usage') return;
        if (
          event.type === 'tool_call' &&
          (event.call.name === CLARIFY_TOOL || event.call.name === DELEGATE_TOOL)
        ) {
          return; // dicatat oleh handler masing-masing
        }
        const step = applyLoopEvent(steps, event, handlerMap);
        if (!step) return;
        if (event.type === 'tool_call') {
          await this.event(
            eventTaskId,
            'tool_call',
            `${step.label}${step.source ? ` · ${step.source}` : ''}`,
            {
              ...step,
              agentId: agent.id,
              agentName: agent.name,
            },
          );
        } else if (event.call.name !== CLARIFY_TOOL && event.call.name !== DELEGATE_TOOL) {
          await this.event(eventTaskId, 'tool_result', `${step.label}: ${step.summary}`, {
            ...step,
            agentId: agent.id,
            agentName: agent.name,
          });
        }
      },
    );
  }

  private clarifyHandler(): ToolHandler {
    return {
      label: 'Minta klarifikasi',
      tool: {
        name: CLARIFY_TOOL,
        description:
          'Ajukan pertanyaan klarifikasi kepada pengguna bila instruksi ambigu atau data penting kurang. Tugas akan berhenti sampai pengguna menjawab.',
        inputSchema: {
          type: 'object',
          properties: {
            pertanyaan: { type: 'string', description: 'Pertanyaan singkat dan spesifik.' },
          },
          required: ['pertanyaan'],
        },
      },
      execute: (input) =>
        Promise.resolve({
          status: 'pending_approval',
          approvalId: NEEDS_INPUT,
          content: String(input.pertanyaan ?? ''),
        }),
    };
  }

  // ───────────────────────── Grup: delegasi ─────────────────────────

  private leaderNote(group: GroupRecord): string {
    const members = group.members.filter((m) => m.id !== group.leader_agent_id);
    return [
      `Anda adalah Leader grup "${group.name}". Anggota tim:`,
      ...members.map((m) => `- ${m.name}`),
      `Pecah tugas menjadi bagian yang sesuai keahlian anggota, panggil tool ${DELEGATE_TOOL} untuk tiap bagian (boleh beberapa kali), tinjau hasilnya, lalu susun hasil akhir yang utuh. Kerjakan sendiri bagian yang tidak cocok untuk anggota.`,
    ].join('\n');
  }

  private delegationHandler(
    task: RunnerTask,
    group: GroupRecord,
    signal: AbortSignal,
  ): ToolHandler {
    const members = group.members.filter((m) => m.id !== group.leader_agent_id);
    let used = 0;
    return {
      label: 'Delegasikan',
      tool: {
        name: DELEGATE_TOOL,
        description: `Delegasikan sub-tugas ke anggota grup. Anggota: ${members.map((m) => m.name).join(', ')}. Hasil kerja anggota dikembalikan kepada Anda.`,
        inputSchema: {
          type: 'object',
          properties: {
            anggota: {
              type: 'string',
              enum: members.map((m) => m.name),
              description: 'Nama anggota.',
            },
            instruksi: {
              type: 'string',
              description: 'Instruksi lengkap dan mandiri untuk anggota.',
            },
          },
          required: ['anggota', 'instruksi'],
        },
      },
      execute: async (input) => {
        used += 1;
        if (used > MAX_DELEGATIONS) {
          return {
            status: 'error',
            content: `Batas ${MAX_DELEGATIONS} delegasi per putaran tercapai.`,
          };
        }
        const name = String(input.anggota ?? '').trim();
        const member = members.find((m) => m.name.toLowerCase() === name.toLowerCase());
        if (!member) return { status: 'error', content: `Anggota "${name}" tidak ada di grup.` };
        const instruction = String(input.instruksi ?? '').trim();
        if (!instruction) return { status: 'error', content: 'Instruksi delegasi kosong.' };
        return this.runDelegation(task, member.id, instruction, signal);
      },
    };
  }

  /** Jalankan sub-tugas anggota sebagai child task (dapat ditelusuri dan dilanjutkan sendiri). */
  private async runDelegation(
    parent: RunnerTask,
    agentId: string,
    instruction: string,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const agent = await this.loadAgent(agentId, parent.user_id);
    const rows = (await this.dataSource.query(
      `INSERT INTO ai_tasks (user_id, agent_id, group_id, parent_task_id, title, instruction, status, started_at, web_search)
       VALUES ($1, $2, $3, $4, $5, $6, 'running', now(), $7) RETURNING *`,
      [
        parent.user_id,
        agentId,
        parent.group_id,
        parent.id,
        makeTitle(`${agent.name}: ${instruction}`),
        instruction,
        parent.web_search === true,
      ],
    )) as RunnerTask[];
    const child = rows[0]!;
    await this.appendMessage(child.id, agentId, { role: 'user', content: instruction });
    await this.event(
      parent.id,
      'delegated',
      `Leader → ${agent.name}: ${instruction.slice(0, 300)}`,
      {
        agentId,
        agentName: agent.name,
        childTaskId: child.id,
        instruction,
      },
    );
    const startedAt = Date.now();
    try {
      const result = await this.runLoop(
        child,
        agent,
        [{ role: 'user', content: instruction }],
        signal,
        {
          allowApproval: true,
          allowClarify: false,
          eventTaskId: parent.id,
          maxIterations: 8,
        },
      );
      await this.persistAppended(child.id, agentId, result.appended);
      await this.finish(child, result, startedAt);
      if (result.stop === 'pending_approval') {
        await this.event(
          parent.id,
          'delegate_result',
          `${agent.name} menunggu persetujuan operasi tulis.`,
          {
            agentId,
            agentName: agent.name,
            childTaskId: child.id,
            status: 'awaiting_approval',
          },
        );
        return {
          status: 'ok',
          content: `${agent.name} menyiapkan operasi tulis yang menunggu persetujuan pengguna di sub-tugas "${child.title}". Lanjutkan tanpa hasil itu dan sebutkan bahwa persetujuan masih ditunggu.`,
        };
      }
      const content = loopContent(result) || result.content;
      await this.event(parent.id, 'delegate_result', content.slice(0, 4000), {
        agentId,
        agentName: agent.name,
        childTaskId: child.id,
        content,
        status: 'completed',
      });
      return { status: 'ok', content: `Hasil dari ${agent.name}:\n${content}` };
    } catch (error) {
      if (signal.aborted) throw error;
      const message = error instanceof Error ? error.message : 'Sub-tugas gagal.';
      await this.dataSource.query(
        `UPDATE ai_tasks SET status = 'failed', error_message = $2, finished_at = now(), updated_at = now() WHERE id = $1`,
        [child.id, message.slice(0, 500)],
      );
      await this.event(
        parent.id,
        'delegate_result',
        `${agent.name} gagal: ${message.slice(0, 300)}`,
        {
          agentId,
          agentName: agent.name,
          childTaskId: child.id,
          status: 'failed',
        },
      );
      return { status: 'error', content: `${agent.name} gagal mengerjakan: ${message}` };
    }
  }

  // ───────────────────────── Grup: diskusi bergiliran ─────────────────────────

  private async runDiscussion(
    task: RunnerTask,
    group: GroupRecord,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<void> {
    const members = [...group.members].sort((a, b) => a.position - b.position);
    const transcript: { name: string; text: string }[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let model = this.gateway.activeModel();
    const discussants = members.filter((m) => m.id !== group.leader_agent_id);
    const speakers = [members.find((m) => m.id === group.leader_agent_id)!, ...discussants];

    for (let round = 1; round <= group.max_rounds; round += 1) {
      await this.event(task.id, 'round', `Ronde ${round}`, { round });
      let agreements = 0;
      for (const member of speakers) {
        signal.throwIfAborted();
        const agent = await this.loadAgent(member.id, task.user_id);
        const prompt = [
          `Topik/tugas diskusi grup "${group.name}":\n${task.instruction}`,
          transcript.length
            ? `Transkrip diskusi sejauh ini:\n${transcript.map((t) => `**${t.name}:** ${t.text}`).join('\n\n')}`
            : 'Anda membuka diskusi.',
          `Ronde ${round} dari ${group.max_rounds}. Giliran Anda (${agent.name}). Berikan kontribusi singkat (maks. 200 kata) dari sudut keahlian Anda: tanggapi poin anggota lain, tambahkan data bila perlu (gunakan tool), dan sebutkan bila tidak setuju. Bila Anda sudah sepakat dan tidak punya tambahan, mulai jawaban dengan kata SETUJU.`,
        ].join('\n\n');
        const result = await this.runLoop(
          task,
          agent,
          [{ role: 'user', content: prompt }],
          signal,
          {
            allowApproval: false,
            allowClarify: false,
            maxIterations: 4,
            groupNote: `Anda berdiskusi dalam grup "${group.name}" bersama: ${members.map((m) => m.name).join(', ')}.`,
          },
        );
        tokensIn += result.tokensIn;
        tokensOut += result.tokensOut;
        model = result.model || model;
        const text = (loopContent(result) || result.content).slice(0, DISCUSSION_MAX_TURN_CHARS);
        transcript.push({ name: agent.name, text });
        if (/^\s*\**SETUJU\b/i.test(text)) agreements += 1;
        await this.event(task.id, 'discussion', text.slice(0, 4000), {
          agentId: agent.id,
          agentName: agent.name,
          round,
          content: text,
          leader: agent.id === group.leader_agent_id,
        });
      }
      // Konsensus: semua anggota non-Leader menyatakan setuju setelah ronde pertama.
      if (round > 1 && agreements >= discussants.length) {
        await this.event(task.id, 'consensus', 'Anggota mencapai kesepakatan.', { round });
        break;
      }
    }

    signal.throwIfAborted();
    const leader = await this.loadAgent(group.leader_agent_id, task.user_id);
    const summary = await this.runLoop(
      task,
      leader,
      [
        {
          role: 'user',
          content: `Sebagai Leader grup "${group.name}", susun hasil akhir untuk tugas berikut berdasarkan diskusi.\n\nTugas:\n${task.instruction}\n\nTranskrip:\n${transcript
            .map((t) => `**${t.name}:** ${t.text}`)
            .join(
              '\n\n',
            )}\n\nTulis kesimpulan, keputusan/rekomendasi utama, poin yang masih berbeda pendapat, dan langkah tindak lanjut (Markdown).`,
        },
      ],
      signal,
      { allowApproval: false, allowClarify: false, maxIterations: 4 },
    );
    await this.finish(
      task,
      {
        ...summary,
        tokensIn: summary.tokensIn + tokensIn,
        tokensOut: summary.tokensOut + tokensOut,
        model: summary.model || model,
      },
      startedAt,
    );
  }

  // ───────────────────────── Data ─────────────────────────

  private async ownTask(userId: string, taskId: string): Promise<RunnerTask> {
    const rows = (await this.dataSource.query(
      `SELECT * FROM ai_tasks WHERE id = $1 AND user_id = $2`,
      [taskId, userId],
    )) as RunnerTask[];
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Tugas tidak ditemukan.', 404);
    return rows[0];
  }

  private async loadAgent(agentId: string, userId: string): Promise<AgentRecord> {
    const rows = (await this.dataSource.query(
      `SELECT id, name, description, instruction, responsibilities, boundaries, memory, owner_user_id, status, avatar_color
         FROM agents WHERE id = $1 AND owner_user_id = $2`,
      [agentId, userId],
    )) as AgentRecord[];
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Agent tidak ditemukan.', 404);
    return rows[0];
  }

  private async loadGroup(groupId: string, userId: string): Promise<GroupRecord> {
    const rows = (await this.dataSource.query(
      `SELECT g.id, g.name, g.mode, g.leader_agent_id, g.max_rounds,
              COALESCE((SELECT json_agg(json_build_object('id', a.id, 'name', a.name, 'position', m.position)
                                        ORDER BY m.position)
                          FROM agent_group_members m JOIN agents a ON a.id = m.agent_id
                         WHERE m.group_id = g.id), '[]') AS members
         FROM agent_groups g WHERE g.id = $1 AND g.owner_user_id = $2`,
      [groupId, userId],
    )) as GroupRecord[];
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Grup tidak ditemukan.', 404);
    return rows[0];
  }

  private async agentSkills(agentId: string): Promise<SkillContent[]> {
    return (await this.dataSource.query(
      `SELECT s.name, s.description, s.instructions FROM agent_skills ak JOIN skills s ON s.id = ak.skill_id
        WHERE ak.agent_id = $1 ORDER BY s.name`,
      [agentId],
    )) as SkillContent[];
  }

  private async agentConnectors(agentId: string): Promise<ConnectorAttachment[]> {
    return (await this.dataSource.query(
      `SELECT connector_type AS "connectorType", connector_id AS "connectorId", access
         FROM agent_connectors WHERE agent_id = $1`,
      [agentId],
    )) as ConnectorAttachment[];
  }

  private async ownerName(userId: string): Promise<string> {
    const rows = (await this.dataSource.query(`SELECT display_name FROM users WHERE id = $1`, [
      userId,
    ])) as {
      display_name: string;
    }[];
    return rows[0]?.display_name ?? 'pengguna';
  }

  /**
   * Setelah crash, transkrip bisa berakhir dengan permintaan tool tanpa hasil. Tool itu tidak
   * dijalankan ulang (bisa jadi sudah berefek); model diberi tahu statusnya tidak diketahui.
   */
  private async repairInterrupted(taskId: string, agentId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
    const lastAssistant = messages.map((m) => m.role).lastIndexOf('assistant');
    const assistant = lastAssistant >= 0 ? messages[lastAssistant] : undefined;
    if (!assistant?.toolCalls?.length) return messages;
    const answered = new Set(messages.slice(lastAssistant + 1).filter((m) => m.role === 'tool').map((m) => m.toolCallId));
    const repaired = [...messages];
    for (const call of assistant.toolCalls) {
      if (answered.has(call.id)) continue;
      const message: ChatMessage = {
        role: 'tool',
        toolCallId: call.id,
        toolName: call.name,
        content: 'Status tidak diketahui setelah gangguan server — periksa sistem tujuan sebelum mengulang operasi ini.',
        isError: true,
      };
      await this.appendMessage(taskId, agentId, message);
      repaired.push(message);
    }
    return repaired;
  }

  private async loadMessages(taskId: string): Promise<ChatMessage[]> {
    const rows = (await this.dataSource.query(
      `SELECT message FROM ai_task_messages WHERE task_id = $1 ORDER BY id`,
      [taskId],
    )) as { message: ChatMessage }[];
    return rows.map((row) => row.message);
  }

  private async appendMessage(
    taskId: string,
    agentId: string | null,
    message: ChatMessage,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ai_task_messages (task_id, agent_id, message) VALUES ($1, $2, $3)`,
      [taskId, agentId, JSON.stringify(message)],
    );
  }

  private async persistAppended(
    taskId: string,
    agentId: string,
    messages: ChatMessage[],
  ): Promise<void> {
    for (const message of messages) await this.appendMessage(taskId, agentId, message);
  }

  private async event(
    taskId: string,
    type: string,
    message: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ai_task_events (task_id, event_type, message, payload) VALUES ($1, $2, $3, $4)`,
      [taskId, type, message, JSON.stringify(payload)],
    );
  }
}

function makeTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}
