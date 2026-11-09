import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS } from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import type {
  ApprovedWritePayload,
  WriteApprovalRequest,
} from '../connectors/connector-tools.service';

export interface ToolApprovalRow {
  id: string;
  kind: 'tool_call';
  task_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  requester_id: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
  payload: (ApprovedWritePayload & { connectorName: string }) | null;
  tool_call_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  task_title: string | null;
  conversation_title: string | null;
}

const SELECT = `
  SELECT ap.id, ap.kind, ap.task_id, ap.conversation_id, ap.message_id::text AS message_id, ap.agent_id,
         ag.name AS agent_name, ap.requester_id, ap.summary, ap.status, ap.payload, ap.tool_call_id,
         ap.decided_at, ap.decision_note, ap.created_at,
         t.title AS task_title, c.title AS conversation_title
    FROM approvals ap
    LEFT JOIN agents ag ON ag.id = ap.agent_id
    LEFT JOIN ai_tasks t ON t.id = ap.task_id
    LEFT JOIN conversations c ON c.id = ap.conversation_id`;

/**
 * Persetujuan pemanggilan tool tulis (query INSERT/UPDATE/DELETE atau tool MCP yang ditandai).
 * Diputuskan oleh pemilik tugas/percakapan sendiri; grant dicek ulang saat eksekusi.
 */
@Injectable()
export class ToolApprovalsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(
    requesterId: string,
    target: { taskId?: string | null; conversationId?: string | null; agentId?: string | null },
    request: WriteApprovalRequest,
  ): Promise<string> {
    const payload: ApprovedWritePayload & { connectorName: string } = {
      connectorType: request.connectorType,
      connectorId: request.connectorId,
      connectorName: request.connectorName,
      tool: request.tool,
      statement: request.statement,
      input: request.input,
    };
    const rows = (await this.dataSource.query(
      `INSERT INTO approvals (kind, task_id, conversation_id, agent_id, requester_id, summary, payload, tool_call_id)
       VALUES ('tool_call', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        target.taskId ?? null,
        target.conversationId ?? null,
        target.agentId ?? null,
        requesterId,
        request.summary,
        JSON.stringify(payload),
        request.toolCallId,
      ],
    )) as { id: string }[];
    return rows[0]!.id;
  }

  async attachMessage(approvalIds: string[], messageId: string): Promise<void> {
    if (approvalIds.length === 0) return;
    await this.dataSource.query(`UPDATE approvals SET message_id = $2 WHERE id = ANY($1::uuid[])`, [
      approvalIds,
      messageId,
    ]);
  }

  async detail(userId: string, approvalId: string): Promise<ToolApprovalRow> {
    const rows = (await this.dataSource.query(
      `${SELECT} WHERE ap.id = $1 AND ap.requester_id = $2 AND ap.kind = 'tool_call'`,
      [approvalId, userId],
    )) as ToolApprovalRow[];
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Persetujuan tidak ditemukan.', 404);
    return rows[0];
  }

  async listMine(userId: string, status?: string): Promise<ToolApprovalRow[]> {
    const params: unknown[] = [userId];
    let where = `WHERE ap.requester_id = $1 AND ap.kind = 'tool_call'`;
    if (status) {
      params.push(status);
      where += ` AND ap.status = $2`;
    }
    return (await this.dataSource.query(
      `${SELECT} ${where}
        ORDER BY CASE WHEN ap.status = 'pending' THEN 0 ELSE 1 END, ap.created_at DESC LIMIT 100`,
      params,
    )) as ToolApprovalRow[];
  }

  /** Klaim keputusan secara atomik; hanya pemilik dan hanya sekali. */
  async claim(
    auth: AuthContext,
    approvalId: string,
    decision: 'approved' | 'rejected',
    note: string | undefined,
  ): Promise<ToolApprovalRow> {
    const claimed = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE approvals SET status = $3, decided_by = $2, decided_at = now(), decision_note = $4
          WHERE id = $1 AND requester_id = $2 AND kind = 'tool_call' AND status = 'pending'
          RETURNING id`,
        [approvalId, auth.user.id, decision, note ?? null],
      ),
    );
    if (claimed.length === 0) {
      throw new AppError(
        ERROR_CODES.conflict,
        'Persetujuan sudah diputuskan atau tidak ditemukan.',
        409,
      );
    }
    const row = await this.detail(auth.user.id, approvalId);
    await this.audit.record({
      eventKey:
        decision === 'approved'
          ? AUDIT_EVENTS.toolApprovalApproved
          : AUDIT_EVENTS.toolApprovalRejected,
      severity: decision === 'approved' ? 'warn' : 'info',
      summary: `${decision === 'approved' ? 'Menyetujui' : 'Menolak'} ${row.payload?.tool ?? 'tool'} di "${row.payload?.connectorName ?? ''}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'approval',
      entityId: approvalId,
      payload: {
        taskId: row.task_id,
        conversationId: row.conversation_id,
        statement: row.payload?.statement?.slice(0, 2000) ?? null,
        note: note ?? null,
      },
    });
    return row;
  }
}
