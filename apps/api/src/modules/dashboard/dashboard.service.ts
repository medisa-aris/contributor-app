import { Inject, Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  type DashboardHighlightDto,
  type DashboardSummaryDto,
  type NotificationDto,
} from '@bara/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';
import { GuardrailsService } from '../ai/guardrails/guardrails.service';

const NOTIFICATION_LIMIT = 20;
const RECENT_TASK_DAYS = 7;

interface TaskRow {
  id: string;
  title: string;
  status: string;
  at: string;
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly guardrails: GuardrailsService,
  ) {}

  /** Hanya status aktif; kategori dan istilah tetap khusus admin. */
  async guardrailsStatus(): Promise<{ enabled: boolean }> {
    const settings = await this.guardrails.getSettings();
    return { enabled: settings.enabled };
  }

  async summary(auth: AuthContext): Promise<DashboardSummaryDto> {
    const can = (permission: string) => auth.effective.allowed.has(permission);
    const result: DashboardSummaryDto = { highlights: [] };

    if (can(PERMISSIONS.subordinateExecute)) {
      const rows = (await this.dataSource.query(
        `SELECT
           count(*) FILTER (WHERE status IN ('created', 'validating'))::int AS queued,
           count(*) FILTER (WHERE status = 'running')::int AS running,
           count(*) FILTER (WHERE status IN ('awaiting_approval', 'needs_input'))::int AS action,
           count(*) FILTER (WHERE status = 'completed')::int AS done,
           count(*) FILTER (WHERE status IN ('failed', 'cancelled'))::int AS stopped,
           count(*)::int AS total
         FROM ai_tasks WHERE user_id = $1`,
        [auth.user.id],
      )) as DashboardSummaryDto['tasks'][];
      result.tasks = rows[0];

      const latest = (await this.dataSource.query(
        `SELECT DISTINCT ON (status) id, title, status, coalesce(finished_at, updated_at) AS at
           FROM ai_tasks
          WHERE user_id = $1 AND status IN ('completed', 'failed')
          ORDER BY status, coalesce(finished_at, updated_at) DESC`,
        [auth.user.id],
      )) as TaskRow[];
      for (const row of latest) {
        result.highlights.push({
          kind: row.status === 'completed' ? 'taskDone' : 'taskFailed',
          title: row.title,
          at: iso(row.at),
          routePath: '/workspace/subordinate',
        });
      }
    }

    if (can(PERMISSIONS.knowledgeDocumentsRead)) {
      const rows = (await this.dataSource.query(
        `SELECT
           count(*) FILTER (WHERE status = 'indexed')::int AS indexed,
           count(*) FILTER (WHERE status = 'pending')::int AS pending,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           (SELECT count(*)::int FROM knowledge_sources) AS sources
         FROM knowledge_documents`,
      )) as DashboardSummaryDto['documents'][];
      result.documents = rows[0];

      const doc = (await this.dataSource.query(
        `SELECT title, indexed_at AS at FROM knowledge_documents
          WHERE status = 'indexed' AND indexed_at IS NOT NULL
          ORDER BY indexed_at DESC LIMIT 1`,
      )) as { title: string; at: string }[];
      if (doc[0]) {
        result.highlights.push({
          kind: 'document',
          title: doc[0].title,
          at: iso(doc[0].at),
          routePath: '/knowledge/documents',
        });
      }
    }

    if (can(PERMISSIONS.agentsView)) {
      const rows = (await this.dataSource.query(
        `SELECT
           count(*)::int AS active,
           count(*) FILTER (WHERE require_approval)::int AS "requiresApproval",
           coalesce(sum(jsonb_array_length(tool_allowlist)), 0)::int AS tools
         FROM agents WHERE owner_user_id IS NULL AND status = 'active'`,
      )) as DashboardSummaryDto['agents'][];
      result.agents = rows[0];
    }

    if (can(PERMISSIONS.agentsApprove)) {
      const rows = (await this.dataSource.query(
        `SELECT count(*)::int AS pending FROM approvals WHERE kind = 'task' AND status = 'pending'`,
      )) as { pending: number }[];
      result.approvals = { pending: rows[0]?.pending ?? 0 };
    }

    result.highlights.sort((a: DashboardHighlightDto, b: DashboardHighlightDto) => b.at.localeCompare(a.at));
    return result;
  }

  /** Notifikasi turunan dari data yang sudah ada; status "sudah dibaca" disimpan di peramban. */
  async notifications(auth: AuthContext): Promise<NotificationDto[]> {
    const can = (permission: string) => auth.effective.allowed.has(permission);
    const items: NotificationDto[] = [];

    const tasks = (await this.dataSource.query(
      `SELECT id, title, status, coalesce(finished_at, updated_at) AS at
         FROM ai_tasks
        WHERE user_id = $1
          AND (status IN ('awaiting_approval', 'needs_input')
               OR (status IN ('completed', 'failed')
                   AND coalesce(finished_at, updated_at) > now() - make_interval(days => $2)))
        ORDER BY at DESC LIMIT $3`,
      [auth.user.id, RECENT_TASK_DAYS, NOTIFICATION_LIMIT],
    )) as TaskRow[];
    for (const task of tasks) {
      items.push({
        id: `task:${task.id}:${task.status}`,
        kind:
          task.status === 'completed' ? 'taskDone' : task.status === 'failed' ? 'taskFailed' : 'taskAction',
        title: task.title,
        createdAt: iso(task.at),
        routePath: '/workspace/subordinate',
      });
    }

    if (can(PERMISSIONS.agentsApprove)) {
      const approvals = (await this.dataSource.query(
        `SELECT ap.id, coalesce(ap.summary, ag.name, '') AS title, ap.created_at AS at
           FROM approvals ap LEFT JOIN agents ag ON ag.id = ap.agent_id
          WHERE ap.kind = 'task' AND ap.status = 'pending'
          ORDER BY ap.created_at DESC LIMIT $1`,
        [NOTIFICATION_LIMIT],
      )) as { id: string; title: string; at: string }[];
      for (const approval of approvals) {
        items.push({
          id: `approval:${approval.id}`,
          kind: 'approval',
          title: approval.title,
          createdAt: iso(approval.at),
          routePath: '/agents/approvals',
        });
      }
    }

    if (can(PERMISSIONS.knowledgeDocumentsRead)) {
      const docs = (await this.dataSource.query(
        `SELECT id, title, updated_at AS at FROM knowledge_documents
          WHERE status = 'failed' ORDER BY updated_at DESC LIMIT $1`,
        [NOTIFICATION_LIMIT],
      )) as { id: string; title: string; at: string }[];
      for (const doc of docs) {
        items.push({
          id: `document:${doc.id}`,
          kind: 'documentFailed',
          title: doc.title,
          createdAt: iso(doc.at),
          routePath: '/knowledge/documents',
        });
      }
    }

    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, NOTIFICATION_LIMIT);
  }
}
