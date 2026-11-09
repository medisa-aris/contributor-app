import { Inject, Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';
import {
  ConnectorToolsService,
  type ConnectorAttachment,
} from '../connectors/connector-tools.service';
import { ConnectorsService, type AvailableConnector } from '../connectors/connectors.service';
import { ACCESS_RANK } from '../connectors/connector-access.service';
import type { ToolHandler, ToolLoopEvent, ToolLoopResult, ToolOutcome } from './gateway.service';
import type { ChatMessage, ChatToolCall } from './providers/types';
import { ToolApprovalsService } from './tool-approvals.service';
import { WebSearchService } from './web-search/web-search.service';

/** Satu langkah tool yang ditampilkan di UI. */
export interface ToolTraceStep {
  id: string;
  name: string;
  label: string;
  source: string | null;
  input: Record<string, unknown>;
  status: 'running' | 'ok' | 'error' | 'pending_approval' | 'approved' | 'rejected';
  summary: string;
  preview?: unknown;
  approvalId?: string;
}

/** Jejak tool pada satu pesan asisten; `transcript` hanya disimpan di server. */
export interface ToolTrace {
  steps: ToolTraceStep[];
  transcript: ChatMessage[];
  pending?: { approvalId: string; callId: string } | null;
}

export interface ConversationConnectorRow extends ConnectorAttachment {
  name: string;
  engine: string;
  granted: boolean;
}

function summarize(outcome: ToolOutcome): string {
  if (outcome.status === 'pending_approval') return 'Menunggu persetujuan';
  if (outcome.status === 'error') return outcome.content.slice(0, 300);
  const data = outcome.data as
    { rowCount?: number; affected?: number; truncated?: boolean; summary?: unknown } | undefined;
  if (data && typeof data.summary === 'string') return data.summary;
  if (data && typeof data.rowCount === 'number') {
    return `${data.rowCount} baris${data.truncated ? ' (dipotong)' : ''}`;
  }
  if (data && typeof data.affected === 'number') return `${data.affected} baris terpengaruh`;
  return 'Selesai';
}

/** Ubah event loop menjadi langkah jejak; kembalikan langkah yang berubah. */
export function applyLoopEvent(
  steps: ToolTraceStep[],
  event: ToolLoopEvent,
  handlers: Map<string, ToolHandler>,
): ToolTraceStep | null {
  if (event.type === 'tool_call') {
    const handler = handlers.get(event.call.name);
    const step: ToolTraceStep = {
      id: event.call.id,
      name: event.call.name,
      label: handler?.label ?? event.call.name,
      source: handler?.source ?? null,
      input: event.call.input ?? {},
      status: 'running',
      summary: 'Berjalan…',
    };
    steps.push(step);
    return step;
  }
  if (event.type === 'tool_result') {
    const step = steps.find((s) => s.id === event.call.id);
    if (!step) return null;
    step.status = event.outcome.status;
    step.summary = summarize(event.outcome);
    if (
      event.outcome.status !== 'error' &&
      'data' in event.outcome &&
      event.outcome.data !== undefined
    ) {
      step.preview = event.outcome.data;
      // Penyedia web baru diketahui setelah rantai prioritas selesai.
      const source = (event.outcome.data as { source?: unknown }).source;
      if (typeof source === 'string') step.source = source;
    }
    if (event.outcome.status === 'pending_approval') step.approvalId = event.outcome.approvalId;
    return step;
  }
  return null;
}

/** Gabungkan teks asisten dari semua iterasi loop menjadi jawaban akhir. */
export function loopContent(result: ToolLoopResult): string {
  const parts = result.appended
    .filter((m) => m.role === 'assistant' && m.content.trim())
    .map((m) => m.content.trim());
  if (result.content.trim() && result.stop !== 'pending_approval')
    parts.push(result.content.trim());
  return parts.join('\n\n');
}

@Injectable()
export class ChatToolsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly connectors: ConnectorsService,
    private readonly tools: ConnectorToolsService,
    private readonly approvals: ToolApprovalsService,
    private readonly webSearch: WebSearchService,
  ) {}

  private async assertOwner(userId: string, conversationId: string): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    )) as unknown[];
    if (rows.length === 0)
      throw new AppError(ERROR_CODES.notFound, 'Percakapan tidak ditemukan.', 404);
  }

  async attachments(conversationId: string): Promise<ConnectorAttachment[]> {
    return (await this.dataSource.query(
      `SELECT connector_type AS "connectorType", connector_id AS "connectorId", access
         FROM conversation_connectors WHERE conversation_id = $1`,
      [conversationId],
    )) as ConnectorAttachment[];
  }

  /** Konektor terpasang beserta status grant saat ini (konektor yang dicabut tetap terlihat). */
  async list(auth: AuthContext, conversationId: string): Promise<ConversationConnectorRow[]> {
    await this.assertOwner(auth.user.id, conversationId);
    const [attached, available] = await Promise.all([
      this.attachments(conversationId),
      this.connectors.availableFor(auth.user.id),
    ]);
    return attached.map((item) => {
      const match = available.find(
        (a) => a.connectorType === item.connectorType && a.connectorId === item.connectorId,
      );
      return {
        ...item,
        name: match?.name ?? '(akses dicabut)',
        engine: match?.engine ?? '',
        granted: Boolean(match),
      };
    });
  }

  async set(
    auth: AuthContext,
    conversationId: string,
    items: ConnectorAttachment[],
  ): Promise<ConversationConnectorRow[]> {
    if (!auth.effective.allowed.has(PERMISSIONS.connectorsUse)) {
      throw new AppError(ERROR_CODES.forbidden, `Butuh izin ${PERMISSIONS.connectorsUse}.`, 403);
    }
    await this.assertOwner(auth.user.id, conversationId);
    const available = await this.connectors.availableFor(auth.user.id);
    const normalized = this.validate(items, available);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM conversation_connectors WHERE conversation_id = $1`, [
        conversationId,
      ]);
      for (const item of normalized) {
        await manager.query(
          `INSERT INTO conversation_connectors (conversation_id, connector_type, connector_id, access)
           VALUES ($1, $2, $3, $4)`,
          [conversationId, item.connectorType, item.connectorId, item.access],
        );
      }
    });
    return this.list(auth, conversationId);
  }

  /** Validasi: hanya konektor yang di-grant; akses tidak melebihi grant. */
  validate(items: ConnectorAttachment[], available: AvailableConnector[]): ConnectorAttachment[] {
    const seen = new Set<string>();
    const out: ConnectorAttachment[] = [];
    for (const item of items) {
      const key = `${item.connectorType}:${item.connectorId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const match = available.find(
        (a) => a.connectorType === item.connectorType && a.connectorId === item.connectorId,
      );
      if (!match) {
        throw new AppError(ERROR_CODES.forbidden, 'Konektor tidak tersedia untuk Anda.', 403);
      }
      out.push({
        ...item,
        access: ACCESS_RANK[item.access] <= ACCESS_RANK[match.access] ? item.access : match.access,
      });
    }
    return out;
  }

  /** Handler tool untuk percakapan; kosong bila tidak ada konektor, web, atau izin. */
  async handlersFor(
    auth: AuthContext,
    conversationId: string,
    pendingApprovals: string[],
    signal?: AbortSignal,
  ): Promise<ToolHandler[]> {
    const [connectorHandlers, webHandlers] = await Promise.all([
      this.connectorHandlers(auth, conversationId, pendingApprovals),
      this.webHandlers(auth, conversationId, signal),
    ]);
    return [...connectorHandlers, ...webHandlers];
  }

  /** Tool web bila percakapan mengaktifkannya dan izin pengguna masih berlaku. */
  async webHandlers(
    auth: AuthContext,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<ToolHandler[]> {
    if (!auth.effective.allowed.has(PERMISSIONS.webSearchUse) || !this.webSearch.isAvailable()) {
      return [];
    }
    const rows = (await this.dataSource.query(
      `SELECT web_search FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, auth.user.id],
    )) as { web_search: boolean }[];
    if (!rows[0]?.web_search) return [];
    return this.webSearch.handlers({
      userId: auth.user.id,
      conversationId,
      ...(signal ? { signal } : {}),
    });
  }

  private async connectorHandlers(
    auth: AuthContext,
    conversationId: string,
    pendingApprovals: string[],
  ): Promise<ToolHandler[]> {
    if (!auth.effective.allowed.has(PERMISSIONS.connectorsUse)) return [];
    const attachments = await this.attachments(conversationId);
    if (attachments.length === 0) return [];
    return this.tools.buildHandlers(attachments, {
      userId: auth.user.id,
      conversationId,
      requestApproval: async (request) => {
        const id = await this.approvals.create(auth.user.id, { conversationId }, request);
        pendingApprovals.push(id);
        return id;
      },
    });
  }

  toolRules(handlers: ToolHandler[]): string | undefined {
    const rules = [this.tools.toolRules(handlers), this.webSearch.toolRules(handlers)].filter(
      (rule): rule is string => Boolean(rule),
    );
    return rules.length > 0 ? rules.join('\n\n') : undefined;
  }

  async saveTrace(messageId: string, trace: ToolTrace): Promise<void> {
    await this.dataSource.query(`UPDATE conversation_messages SET tool_trace = $2 WHERE id = $1`, [
      messageId,
      JSON.stringify(trace),
    ]);
  }

  async loadMessage(
    conversationId: string,
    messageId: string,
  ): Promise<{
    id: string;
    content: string;
    tool_trace: ToolTrace | null;
    tokens_in: number | null;
    tokens_out: number | null;
  }> {
    const rows = (await this.dataSource.query(
      `SELECT id::text AS id, content, tool_trace, tokens_in, tokens_out
         FROM conversation_messages WHERE id = $1 AND conversation_id = $2 AND role = 'assistant'`,
      [messageId, conversationId],
    )) as Array<{
      id: string;
      content: string;
      tool_trace: ToolTrace | null;
      tokens_in: number | null;
      tokens_out: number | null;
    }>;
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Pesan tidak ditemukan.', 404);
    return rows[0];
  }

  /** Riwayat teks sebelum pesan tertentu, untuk melanjutkan loop setelah persetujuan. */
  async historyBefore(conversationId: string, messageId: string): Promise<ChatMessage[]> {
    const rows = (await this.dataSource.query(
      `SELECT role, content FROM conversation_messages
        WHERE conversation_id = $1 AND id < $2 AND role IN ('user', 'assistant')
        ORDER BY id DESC LIMIT 30`,
      [conversationId, messageId],
    )) as Array<{ role: 'user' | 'assistant'; content: string }>;
    return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
  }

  async updateMessage(
    messageId: string,
    patch: {
      content: string;
      tokensIn: number | null;
      tokensOut: number | null;
      trace: ToolTrace;
      guardrails?: Record<string, number>;
    },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE conversation_messages
          SET content = $2, tokens_in = $3, tokens_out = $4, tool_trace = $5,
              guardrails = COALESCE($6::jsonb, guardrails)
        WHERE id = $1`,
      [
        messageId,
        patch.content,
        patch.tokensIn,
        patch.tokensOut,
        JSON.stringify(patch.trace),
        patch.guardrails ? JSON.stringify(patch.guardrails) : null,
      ],
    );
  }

  executeApproved(
    auth: AuthContext,
    conversationId: string,
    approval: { id: string; payload: Parameters<ConnectorToolsService['executeApprovedWrite']>[1] },
  ): Promise<ToolOutcome> {
    return this.tools.executeApprovedWrite(
      { userId: auth.user.id, conversationId },
      approval.payload,
      approval.id,
    );
  }
}

export type { ChatToolCall };
