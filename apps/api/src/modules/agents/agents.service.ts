import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS, PERMISSIONS } from '@contributor/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import { TasksService, type TaskEventRow, type TaskRow } from '../ai/tasks.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import type {
  CreateAgentDto,
  DecideApprovalDto,
  ExecuteAgentDto,
  UpdateAgentDto,
} from './dto/agents.dto';

export interface AgentRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  instruction: string;
  tool_allowlist: string[];
  require_approval: boolean;
  status: 'active' | 'inactive';
  task_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRow {
  id: string;
  task_id: string;
  agent_id: string | null;
  agent_name: string | null;
  requester_id: string;
  requester_email: string | null;
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

const AGENT_SELECT = `
  SELECT a.id, a.code, a.name, a.description, a.instruction, a.tool_allowlist, a.require_approval,
         a.status, a.created_at, a.updated_at,
         (SELECT count(*)::int FROM ai_tasks t WHERE t.agent_id = a.id) AS task_count
    FROM agents a`;

const APPROVAL_SELECT = `
  SELECT ap.id, ap.task_id, ap.agent_id, ag.name AS agent_name, ap.requester_id,
         u.email AS requester_email, ap.summary, ap.status,
         ap.decided_by, du.email AS decided_by_email, ap.decided_at, ap.decision_note, ap.created_at
    FROM approvals ap
    LEFT JOIN agents ag ON ag.id = ap.agent_id
    LEFT JOIN users u ON u.id = ap.requester_id
    LEFT JOIN users du ON du.id = ap.decided_by`;

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
    private readonly effective: EffectivePermissionsService,
  ) {}

  async list(options: { skip: number; take: number }): Promise<{ items: AgentRow[]; total: number }> {
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM agents`,
    )) as { total: number }[];
    const items = (await this.dataSource.query(
      `${AGENT_SELECT} ORDER BY a.name LIMIT $1 OFFSET $2`,
      [options.take, options.skip],
    )) as AgentRow[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  async detail(agentId: string): Promise<AgentRow> {
    const rows = (await this.dataSource.query(`${AGENT_SELECT} WHERE a.id = $1`, [agentId])) as AgentRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Agen tidak ditemukan.', 404);
    }
    return rows[0]!;
  }

  async create(auth: AuthContext, dto: CreateAgentDto): Promise<AgentRow> {
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO agents (code, name, description, instruction, tool_allowlist, require_approval)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          dto.code,
          dto.name,
          dto.description ?? null,
          dto.instruction,
          JSON.stringify(dto.toolAllowlist),
          dto.requireApproval,
        ],
      )) as { id: string }[];
      await this.audit.record({
        eventKey: AUDIT_EVENTS.agentCreated,
        severity: 'info',
        summary: `Membuat agen "${dto.name}" (${dto.code})`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'agent',
        entityId: rows[0]!.id,
        payload: { code: dto.code, requireApproval: dto.requireApproval },
      });
      return this.detail(rows[0]!.id);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Kode agen sudah dipakai.', 409);
      }
      throw error;
    }
  }

  async update(auth: AuthContext, agentId: string, dto: UpdateAgentDto): Promise<AgentRow> {
    await this.detail(agentId);
    const sets: string[] = [];
    const params: unknown[] = [agentId];
    const push = (clause: string, value: unknown) => {
      params.push(value);
      sets.push(`${clause} = $${params.length}`);
    };
    if (dto.name !== undefined) push('name', dto.name);
    if (dto.description !== undefined) push('description', dto.description);
    if (dto.instruction !== undefined) push('instruction', dto.instruction);
    if (dto.toolAllowlist !== undefined) push('tool_allowlist', JSON.stringify(dto.toolAllowlist));
    if (dto.requireApproval !== undefined) push('require_approval', dto.requireApproval);
    if (dto.status !== undefined) push('status', dto.status);
    if (sets.length > 0) {
      await this.dataSource.query(
        `UPDATE agents SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params,
      );
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.agentUpdated,
      severity: 'info',
      summary: `Mengubah agen ${agentId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'agent',
      entityId: agentId,
      payload: { fields: Object.keys(dto) },
    });
    return this.detail(agentId);
  }

  async remove(auth: AuthContext, agentId: string): Promise<void> {
    const agent = await this.detail(agentId);
    await this.dataSource.query(`DELETE FROM agents WHERE id = $1`, [agentId]);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.agentDeleted,
      severity: 'warn',
      summary: `Menghapus agen "${agent.name}" (${agent.code})`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'agent',
      entityId: agentId,
      payload: {},
    });
  }

  /**
   * Eksekusi agen: bila agen menuntut persetujuan, tugas berhenti di awaiting_approval
   * dan masuk kotak persetujuan; bila tidak, tugas langsung dijalankan.
   */
  async execute(
    auth: AuthContext,
    agentId: string,
    dto: ExecuteAgentDto,
  ): Promise<{ task: TaskRow; approvalId: string | null }> {
    const agent = await this.detail(agentId);
    if (agent.status !== 'active') {
      throw new AppError(ERROR_CODES.conflict, `Agen "${agent.name}" sedang nonaktif.`, 409);
    }
    const fullInstruction = `${agent.instruction}\n\nPermintaan operasional: ${dto.instruction}`;
    const title =
      dto.title ??
      (dto.instruction.replace(/\s+/g, ' ').trim().length > 60
        ? `${dto.instruction.replace(/\s+/g, ' ').trim().slice(0, 57)}…`
        : dto.instruction.replace(/\s+/g, ' ').trim());

    const taskRows = (await this.dataSource.query(
      `INSERT INTO ai_tasks (user_id, agent_id, title, instruction, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [auth.user.id, agentId, title, fullInstruction, agent.require_approval ? 'awaiting_approval' : 'created'],
    )) as TaskRow[];
    const task = taskRows[0]!;

    if (agent.require_approval) {
      const approvalRows = (await this.dataSource.query(
        `INSERT INTO approvals (task_id, agent_id, requester_id, summary)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [task.id, agentId, auth.user.id, dto.instruction],
      )) as { id: string }[];
      await this.recordTaskEvent(task.id, 'awaiting_approval', `Menunggu persetujuan untuk agen "${agent.name}".`);
      await this.audit.record({
        eventKey: AUDIT_EVENTS.approvalRequested,
        severity: 'warn',
        summary: `Persetujuan diminta untuk tugas agen "${agent.name}"`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'approval',
        entityId: approvalRows[0]!.id,
        payload: { taskId: task.id, agentId },
      });
      return { task, approvalId: approvalRows[0]!.id };
    }

    await this.recordTaskEvent(task.id, 'created', `Tugas agen "${agent.name}" dibuat.`);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.agentTaskExecuted,
      severity: 'info',
      summary: `Menjalankan agen "${agent.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'agent',
      entityId: agentId,
      payload: { taskId: task.id },
    });
    const ran = await this.tasks.runAs(auth, task.id);
    return { task: ran, approvalId: null };
  }

  /** Kotak masuk persetujuan: pending dulu, lalu keputusan terbaru. */
  async approvalsInbox(options: {
    status?: string;
    skip: number;
    take: number;
  }): Promise<{ items: ApprovalRow[]; total: number }> {
    const params: unknown[] = [];
    let where = '';
    if (options.status) {
      params.push(options.status);
      where = `WHERE ap.status = $1`;
    }
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM approvals ap ${where}`,
      params,
    )) as { total: number }[];
    params.push(options.take, options.skip);
    const items = (await this.dataSource.query(
      `${APPROVAL_SELECT} ${where}
        ORDER BY CASE WHEN ap.status = 'pending' THEN 0 ELSE 1 END, ap.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )) as ApprovalRow[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  /** Putusan persetujuan: klaim atomik, validasi ulang izin peminta, lalu jalankan/tolak tugas. */
  async decide(
    auth: AuthContext,
    approvalId: string,
    dto: DecideApprovalDto,
  ): Promise<{ approval: ApprovalRow; task: TaskRow | null }> {
    const claimed = updatedRows<ApprovalRow>(
      await this.dataSource.query(
        `UPDATE approvals SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
          WHERE id = $1 AND status = 'pending' RETURNING *`,
        [approvalId, dto.decision, auth.user.id, dto.note ?? null],
      ),
    );
    if (claimed.length === 0) {
      throw new AppError(ERROR_CODES.conflict, 'Persetujuan sudah diputuskan atau tidak ditemukan.', 409);
    }
    const approval = claimed[0]!;

    // Validasi ulang: peminta tugas masih berhak mengeksekusi agen.
    const requesterAccess = await this.effective.resolve(approval.requester_id);
    const executeDecision = await this.effective.can(approval.requester_id, PERMISSIONS.agentsExecute);
    const canExecute = requesterAccess.isSuperadmin || executeDecision.allowed;
    if (!canExecute) {
      await this.dataSource.query(
        `UPDATE approvals SET status = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL
          WHERE id = $1`,
        [approvalId],
      );
      throw new AppError(
        ERROR_CODES.forbidden,
        'Peminta tugas sudah tidak memiliki izin menjalankan agen; putusan dibatalkan.',
        403,
      );
    }

    if (dto.decision === 'approved') {
      await this.recordTaskEvent(approval.task_id, 'approved', 'Persetujuan diberikan; tugas dijalankan.');
      await this.audit.record({
        eventKey: AUDIT_EVENTS.approvalApproved,
        severity: 'info',
        summary: `Menyetujui tugas ${approval.task_id}`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'approval',
        entityId: approvalId,
        payload: { taskId: approval.task_id, note: dto.note ?? null },
      });
      const task = await this.tasks.runAs(auth, approval.task_id, ['awaiting_approval']);
      return { approval: (await this.approvalDetail(approvalId))!, task };
    }

    await this.dataSource.query(
      `UPDATE ai_tasks SET status = 'cancelled', finished_at = now(), updated_at = now(),
              error_message = 'Ditolak pada persetujuan manusia.'
        WHERE id = $1 AND status = 'awaiting_approval'`,
      [approval.task_id],
    );
    await this.recordTaskEvent(approval.task_id, 'rejected', dto.note ?? 'Persetujuan ditolak.');
    await this.audit.record({
      eventKey: AUDIT_EVENTS.approvalRejected,
      severity: 'warn',
      summary: `Menolak tugas ${approval.task_id}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'approval',
      entityId: approvalId,
      payload: { taskId: approval.task_id, note: dto.note ?? null },
    });
    return { approval: (await this.approvalDetail(approvalId))!, task: null };
  }

  private async approvalDetail(approvalId: string): Promise<ApprovalRow | null> {
    const rows = (await this.dataSource.query(`${APPROVAL_SELECT} WHERE ap.id = $1`, [
      approvalId,
    ])) as ApprovalRow[];
    return rows[0] ?? null;
  }

  private async recordTaskEvent(
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

  /** Daftar tugas agen lintas pengguna (bagi yang berwenang melihat). */
  async listTasks(options: {
    status?: string;
    agentId?: string;
    skip: number;
    take: number;
  }): Promise<{ items: (TaskRow & { agent_name: string | null; requester_email: string | null })[]; total: number }> {
    const params: unknown[] = [];
    const conds: string[] = [];
    if (options.status) {
      params.push(options.status);
      conds.push(`t.status = $${params.length}`);
    }
    if (options.agentId) {
      params.push(options.agentId);
      conds.push(`t.agent_id = $${params.length}`);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM ai_tasks t ${where}`,
      params,
    )) as { total: number }[];
    params.push(options.take, options.skip);
    const items = (await this.dataSource.query(
      `SELECT t.*, a.name AS agent_name, u.email AS requester_email
         FROM ai_tasks t
         LEFT JOIN agents a ON a.id = t.agent_id
         LEFT JOIN users u ON u.id = t.user_id
         ${where}
        ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )) as (TaskRow & { agent_name: string | null; requester_email: string | null })[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  async taskDetail(taskId: string): Promise<TaskRow & { events: TaskEventRow[]; approval: ApprovalRow | null }> {
    const rows = (await this.dataSource.query(`SELECT * FROM ai_tasks WHERE id = $1`, [taskId])) as TaskRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Tugas tidak ditemukan.', 404);
    }
    const events = (await this.dataSource.query(
      `SELECT id, event_type, message, payload, created_at FROM ai_task_events WHERE task_id = $1 ORDER BY id`,
      [taskId],
    )) as TaskEventRow[];
    const approvalRows = (await this.dataSource.query(`${APPROVAL_SELECT} WHERE ap.task_id = $1 ORDER BY ap.created_at DESC LIMIT 1`, [
      taskId,
    ])) as ApprovalRow[];
    return { ...rows[0]!, events, approval: approvalRows[0] ?? null };
  }
}
