import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS, type ConversationMode } from '@contributor/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import type { ChatMessage } from './providers/types';

export interface ConversationSummary {
  id: string;
  mode: ConversationMode;
  title: string;
  counterpart_style: string | null;
  starred_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface ConversationMessageRow {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessageRow[];
}

function makeTitle(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(
    auth: AuthContext,
    options: { mode?: ConversationMode; search?: string; skip: number; take: number },
  ): Promise<{ items: ConversationSummary[]; total: number }> {
    const params: unknown[] = [auth.user.id];
    let where = 'user_id = $1';
    if (options.mode) {
      params.push(options.mode);
      where += ` AND mode = $${params.length}`;
    }
    if (options.search?.trim()) {
      params.push(`%${options.search.trim()}%`);
      where += ` AND (title ILIKE $${params.length} OR EXISTS (
        SELECT 1 FROM conversation_messages m
         WHERE m.conversation_id = conversations.id AND m.content ILIKE $${params.length}
      ))`;
    }
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM conversations WHERE ${where}`,
      params,
    )) as { total: number }[];
    params.push(options.take, options.skip);
    const items = (await this.dataSource.query(
      `SELECT id, mode, title, counterpart_style, starred_at, updated_at, created_at
         FROM conversations WHERE ${where}
        ORDER BY (starred_at IS NOT NULL) DESC, updated_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )) as ConversationSummary[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  async detail(auth: AuthContext, conversationId: string): Promise<ConversationDetail> {
    const rows = (await this.dataSource.query(
      `SELECT id, mode, title, counterpart_style, starred_at, updated_at, created_at
         FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, auth.user.id],
    )) as ConversationSummary[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Percakapan tidak ditemukan.', 404);
    }
    const messages = (await this.dataSource.query(
      `SELECT id, role, content, model, created_at
         FROM conversation_messages WHERE conversation_id = $1
        ORDER BY id`,
      [conversationId],
    )) as ConversationMessageRow[];
    return { ...rows[0]!, messages };
  }

  /** Siapkan percakapan untuk satu giliran chat: buat bila perlu, lalu simpan pesan pengguna. */
  async prepareTurn(
    auth: AuthContext,
    input: {
      mode: ConversationMode;
      conversationId?: string;
      counterpartStyle?: string;
      prompt: string;
    },
  ): Promise<{ id: string; history: ConversationMessageRow[]; isNew: boolean }> {
    let conversationId = input.conversationId ?? null;
    let isNew = false;

    if (conversationId) {
      const existing = (await this.dataSource.query(
        `SELECT id, mode FROM conversations WHERE id = $1 AND user_id = $2`,
        [conversationId, auth.user.id],
      )) as { id: string; mode: ConversationMode }[];
      if (existing.length === 0) {
        throw new AppError(ERROR_CODES.notFound, 'Percakapan tidak ditemukan.', 404);
      }
      if (existing[0]!.mode !== input.mode) {
        throw new AppError(
          ERROR_CODES.validation,
          'Percakapan ini berada pada mode yang berbeda.',
          400,
        );
      }
    } else {
      const created = (await this.dataSource.query(
        `INSERT INTO conversations (user_id, mode, title, counterpart_style)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [auth.user.id, input.mode, makeTitle(input.prompt), input.counterpartStyle ?? null],
      )) as { id: string }[];
      conversationId = created[0]!.id;
      isNew = true;
      await this.audit.record({
        eventKey: AUDIT_EVENTS.aiConversationCreated,
        severity: 'info',
        summary: `Membuka percakapan ${input.mode} baru`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'conversation',
        entityId: conversationId,
        payload: { mode: input.mode },
      });
    }

    await this.dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [conversationId, input.prompt],
    );
    await this.dataSource.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [
      conversationId,
    ]);

    const history = (await this.dataSource.query(
      `SELECT id, role, content, model, created_at
         FROM conversation_messages WHERE conversation_id = $1
        ORDER BY id`,
      [conversationId],
    )) as ConversationMessageRow[];
    return { id: conversationId, history, isNew };
  }

  /** Simpan jawaban asisten di akhir giliran, lalu kembalikan percakapan lengkap. */
  async completeTurn(
    conversationId: string,
    reply: { content: string; model: string | null; tokensIn: number | null; tokensOut: number | null },
  ): Promise<ConversationMessageRow> {
    const inserted = (await this.dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, role, content, model, tokens_in, tokens_out)
       VALUES ($1, 'assistant', $2, $3, $4, $5) RETURNING id, role, content, model, created_at`,
      [conversationId, reply.content, reply.model, reply.tokensIn, reply.tokensOut],
    )) as ConversationMessageRow[];
    await this.dataSource.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [
      conversationId,
    ]);
    return inserted[0]!;
  }

  /** Bangun riwayat ringkas untuk dikirim ke penyedia AI (hanya user + asisten). */
  toChatMessages(history: ConversationMessageRow[]): ChatMessage[] {
    return history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async remove(auth: AuthContext, conversationId: string): Promise<void> {
    const deleted = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id`,
        [conversationId, auth.user.id],
      ),
    );
    if (deleted.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Percakapan tidak ditemukan.', 404);
    }
  }

  async update(
    auth: AuthContext,
    conversationId: string,
    patch: { title?: string; starred?: boolean },
  ): Promise<ConversationSummary> {
    const sets: string[] = [];
    const params: unknown[] = [conversationId, auth.user.id];
    if (patch.title !== undefined) {
      params.push(patch.title.trim());
      sets.push(`title = $${params.length}`);
    }
    if (patch.starred !== undefined) {
      sets.push(`starred_at = ${patch.starred ? 'now()' : 'NULL'}`);
    }

    const rows = updatedRows<ConversationSummary>(
      await this.dataSource.query(
        sets.length > 0
          ? `UPDATE conversations SET ${sets.join(', ')}
              WHERE id = $1 AND user_id = $2
          RETURNING id, mode, title, counterpart_style, starred_at, updated_at, created_at`
          : `SELECT id, mode, title, counterpart_style, starred_at, updated_at, created_at
               FROM conversations WHERE id = $1 AND user_id = $2`,
        params,
      ),
    );
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Percakapan tidak ditemukan.', 404);
    }
    return rows[0]!;
  }

  /** Siapkan pembuatan ulang jawaban asisten terakhir tanpa menghapus riwayat lebih dulu. */
  async prepareRegenerate(
    auth: AuthContext,
    conversationId: string,
  ): Promise<{
    id: string;
    mode: ConversationMode;
    counterpartStyle: string | null;
    history: ConversationMessageRow[];
    previousAssistantId: string;
  }> {
    const conversations = (await this.dataSource.query(
      `SELECT id, mode, counterpart_style FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, auth.user.id],
    )) as { id: string; mode: ConversationMode; counterpart_style: string | null }[];
    if (conversations.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'Percakapan tidak ditemukan.', 404);
    }

    const messages = (await this.dataSource.query(
      `SELECT id, role, content, model, created_at
         FROM conversation_messages WHERE conversation_id = $1
        ORDER BY id`,
      [conversationId],
    )) as ConversationMessageRow[];
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') {
      throw new AppError(
        ERROR_CODES.validation,
        'Belum ada jawaban asisten yang dapat dibuat ulang.',
        400,
      );
    }

    const conversation = conversations[0]!;
    return {
      id: conversation.id,
      mode: conversation.mode,
      counterpartStyle: conversation.counterpart_style,
      history: messages.slice(0, -1),
      previousAssistantId: last.id,
    };
  }

  /** Ganti jawaban asisten lama dengan jawaban baru dalam satu transaksi. */
  async replaceAssistant(
    conversationId: string,
    previousAssistantId: string,
    reply: { content: string; model: string | null; tokensIn: number | null; tokensOut: number | null },
  ): Promise<ConversationMessageRow> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM conversation_messages WHERE id = $1`, [
        previousAssistantId,
      ]);
      const inserted = updatedRows<ConversationMessageRow>(
        await manager.query(
          `INSERT INTO conversation_messages (conversation_id, role, content, model, tokens_in, tokens_out)
           VALUES ($1, 'assistant', $2, $3, $4, $5) RETURNING id, role, content, model, created_at`,
          [conversationId, reply.content, reply.model, reply.tokensIn, reply.tokensOut],
        ),
      );
      await manager.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [
        conversationId,
      ]);
      return inserted[0]!;
    });
  }
}
