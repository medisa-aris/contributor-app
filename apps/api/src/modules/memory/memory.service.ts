import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_EVENTS,
  DEFAULT_EXPOSED_MEMORY_TYPES,
  MEMORY_ENTRY_TYPES,
  MEMORY_LIMITS,
  PERMISSIONS,
  type MemoryAccessLogDto,
  type MemoryBookSummaryDto,
  type MemoryContextDoorDto,
  type MemoryDoorDto,
  type MemoryEntryDto,
  type MemoryEntryStatus,
  type MemoryEntryType,
  type MemoryRefDto,
  type MemoryReviewDecision,
  type MemorySensitivity,
  type MemoryStatusDto,
} from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { MemoryEmbeddingService, toVectorLiteral } from './memory-embedding.service';
import { buildMemoryBlock, rankCandidates, type RankCandidate } from './memory-ranking';
import { redactForMemory } from './memory-redactor';
import {
  MemoryScopeService,
  parsePgArray,
  type MemoryContextRef,
  type ScopeSubject,
} from './memory-scope.service';
import { MemorySettingsService } from './memory-settings.service';

const CANDIDATES_PER_SEARCH = 40;
const STANDING_ENTRIES = 5;

/** Kata umum yang tidak membantu pencarian teks penuh. */
const STOPWORDS = new Set(
  (
    'yang dan di ke dari apa siapa bagaimana kapan mengapa kenapa untuk dengan ini itu adalah saya kamu anda ' +
    'kami kita dia mereka ada tidak bisa akan sudah belum juga atau pada dalam oleh agar karena jadi saja ' +
    'tolong mohon buat buatkan berikan the and or of to in is are what who how please'
  ).split(' '),
);

/** Kata bermakna (huruf kecil, tanpa kata umum) dari sebuah teks. */
export function memoryKeywords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !STOPWORDS.has(w));
}

/** Kata kunci aman untuk to_tsquery: hanya huruf/angka, digabung OR, awalan untuk imbuhan. */
export function toTsQuery(text: string): string | null {
  const words = [...new Set(memoryKeywords(text))].slice(0, 24);
  if (words.length === 0) return null;
  return words.map((w) => (w.length >= 4 ? `${w}:*` : w)).join(' | ');
}

interface EntryRow {
  id: string;
  subject_id: string;
  type: MemoryEntryType;
  content: string;
  importance: number;
  confidence: number;
  sensitivity: MemorySensitivity;
  status: MemoryEntryStatus;
  source_kind: MemoryEntryDto['sourceKind'];
  source_id: string | null;
  edited_by_owner: boolean;
  needs_review: boolean;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function toEntryDto(row: EntryRow): MemoryEntryDto {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    importance: row.importance,
    confidence: Number(row.confidence),
    sensitivity: row.sensitivity,
    status: row.status,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    editedByOwner: row.edited_by_owner,
    needsReview: row.needs_review,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ENTRY_COLUMNS = `id, subject_id, type, content, importance, confidence, sensitivity, status,
  source_kind, source_id, edited_by_owner, needs_review, use_count, last_used_at, created_at, updated_at`;

export interface MemoryRetrieval {
  block: string;
  refs: MemoryRefDto[];
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly scope: MemoryScopeService,
    private readonly embedding: MemoryEmbeddingService,
    private readonly settings: MemorySettingsService,
    private readonly audit: AuditService,
    private readonly effective: EffectivePermissionsService,
  ) {}

  /** Izin memori seorang pengguna di luar konteks permintaan HTTP (runner tugas, worker). */
  async permissionsOf(userId: string): Promise<Set<string>> {
    const allowed = new Set<string>();
    for (const permission of [PERMISSIONS.memorySelfManage, PERMISSIONS.memoryDoorsOpen]) {
      if ((await this.effective.can(userId, permission)).allowed) allowed.add(permission);
    }
    return allowed;
  }

  /**
   * Simpan catatan memori yang dipakai sebuah tugas untuk sitasi di hasilnya. Tugas agent memanggil
   * model beberapa kali (sub-tugas, diskusi), jadi rujukan digabung per catatan.
   */
  async attachTaskRefs(taskId: string, refs: MemoryRefDto[]): Promise<void> {
    if (refs.length === 0) return;
    try {
      const rows = (await this.dataSource.query(`SELECT memory_refs FROM ai_tasks WHERE id = $1`, [taskId])) as {
        memory_refs: MemoryRefDto[] | null;
      }[];
      const merged = new Map((rows[0]?.memory_refs ?? []).map((ref) => [ref.entryId, ref]));
      for (const ref of refs) if (!merged.has(ref.entryId)) merged.set(ref.entryId, ref);
      await this.dataSource.query(`UPDATE ai_tasks SET memory_refs = $2::jsonb WHERE id = $1`, [
        taskId,
        JSON.stringify([...merged.values()].slice(0, 40)),
      ]);
    } catch (error) {
      this.logger.warn(`Rujukan memori tugas gagal disimpan: ${(error as Error).message}`);
    }
  }

  async status(): Promise<MemoryStatusDto> {
    const settings = await this.settings.get();
    return { enabled: settings.enabled, semantic: settings.enabled && (await this.embedding.vectorAvailable()) };
  }

  // ───────────────────────── Buku memori ─────────────────────────

  /** Subjek buku: pengguna sendiri, atau agent miliknya (dicek kepemilikannya). */
  async bookSubject(auth: AuthContext, agentId?: string): Promise<string> {
    if (!agentId) return this.scope.ensureUserSubject(auth.user.id);
    const owned = (await this.dataSource.query(
      `SELECT id FROM agents WHERE id = $1 AND owner_user_id = $2 AND NOT is_template`,
      [agentId, auth.user.id],
    )) as unknown[];
    if (owned.length === 0) throw new AppError(ERROR_CODES.notFound, 'Agent tidak ditemukan.', 404);
    const subject = await this.scope.ensureAgentSubject(agentId);
    if (!subject) throw new AppError(ERROR_CODES.notFound, 'Agent tidak ditemukan.', 404);
    return subject;
  }

  async listEntries(
    subjectId: string,
    filter: {
      type?: MemoryEntryType;
      status?: MemoryEntryStatus;
      search?: string;
      /** true = hanya kotak tinjauan; false = hanya yang sudah ditinjau. */
      review?: boolean;
      skip: number;
      take: number;
    },
  ): Promise<{ items: MemoryEntryDto[]; total: number }> {
    const params: unknown[] = [subjectId, filter.status ?? 'active'];
    let where = 'subject_id = $1 AND status = $2';
    if (filter.review !== undefined) where += filter.review ? ' AND needs_review' : ' AND NOT needs_review';
    if (filter.type) {
      params.push(filter.type);
      where += ` AND type = $${params.length}`;
    }
    if (filter.search?.trim()) {
      params.push(`%${filter.search.trim()}%`);
      where += ` AND content ILIKE $${params.length}`;
    }
    const total = (
      (await this.dataSource.query(`SELECT count(*)::int AS total FROM memory_entries WHERE ${where}`, params)) as {
        total: number;
      }[]
    )[0]!.total;
    params.push(filter.take, filter.skip);
    const rows = (await this.dataSource.query(
      `SELECT ${ENTRY_COLUMNS} FROM memory_entries WHERE ${where}
        ORDER BY ${filter.review ? 'created_at DESC' : 'importance DESC, updated_at DESC'}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )) as EntryRow[];
    return { items: rows.map(toEntryDto), total };
  }

  async summary(subjectId: string): Promise<MemoryBookSummaryDto> {
    const rows = (await this.dataSource.query(
      `SELECT type, count(*)::int AS n FROM memory_entries
        WHERE subject_id = $1 AND status = 'active' GROUP BY type`,
      [subjectId],
    )) as { type: MemoryEntryType; n: number }[];
    const counts = Object.fromEntries(MEMORY_ENTRY_TYPES.map((t) => [t, 0])) as Record<MemoryEntryType, number>;
    for (const row of rows) counts[row.type] = row.n;
    const extra = (await this.dataSource.query(
      `SELECT s.summary, s.summary_at, s.summary_entries,
              (SELECT count(*)::int FROM memory_entries e
                WHERE e.subject_id = s.id AND e.status = 'active' AND e.needs_review) AS pending
         FROM memory_subjects s WHERE s.id = $1`,
      [subjectId],
    )) as { summary: string | null; summary_at: string | null; summary_entries: number; pending: number }[];
    const meta = extra[0];
    return {
      door: await this.door(subjectId),
      counts,
      total: rows.reduce((sum, r) => sum + r.n, 0),
      pendingReview: meta?.pending ?? 0,
      profile:
        meta?.summary && meta.summary_at
          ? { content: meta.summary, generatedAt: meta.summary_at, entryCount: meta.summary_entries }
          : null,
    };
  }

  async createEntry(
    auth: AuthContext,
    subjectId: string,
    input: { type: MemoryEntryType; content: string; sensitivity?: MemorySensitivity; importance?: number },
  ): Promise<MemoryEntryDto> {
    const content = redactForMemory(input.content.trim()).slice(0, MEMORY_LIMITS.maxContentLength);
    const rows = (await this.dataSource.query(
      `INSERT INTO memory_entries
         (subject_id, type, content, importance, confidence, sensitivity, source_kind, edited_by_owner)
       VALUES ($1, $2, $3, $4, 1, $5, 'manual', true)
       RETURNING ${ENTRY_COLUMNS}`,
      [subjectId, input.type, content, input.importance ?? 3, input.sensitivity ?? 'shareable'],
    )) as EntryRow[];
    const entry = rows[0]!;
    void this.embedding.embedEntries([{ id: entry.id, content: entry.content }]);
    return toEntryDto(entry);
  }

  async updateEntry(
    subjectId: string,
    entryId: string,
    patch: { type?: MemoryEntryType; content?: string; sensitivity?: MemorySensitivity; importance?: number },
  ): Promise<MemoryEntryDto> {
    // Mengubah catatan berarti pemilik sudah meninjaunya.
    const sets = ['edited_by_owner = true', 'needs_review = false', 'updated_at = now()'];
    const params: unknown[] = [entryId, subjectId];
    if (patch.type !== undefined) {
      params.push(patch.type);
      sets.push(`type = $${params.length}`);
    }
    if (patch.content !== undefined) {
      params.push(redactForMemory(patch.content.trim()).slice(0, MEMORY_LIMITS.maxContentLength));
      sets.push(`content = $${params.length}`);
    }
    if (patch.sensitivity !== undefined) {
      params.push(patch.sensitivity);
      sets.push(`sensitivity = $${params.length}`);
    }
    if (patch.importance !== undefined) {
      params.push(patch.importance);
      sets.push(`importance = $${params.length}`);
    }
    const rows = updatedRows<EntryRow>(
      await this.dataSource.query(
        `UPDATE memory_entries SET ${sets.join(', ')}
          WHERE id = $1 AND subject_id = $2 RETURNING ${ENTRY_COLUMNS}`,
        params,
      ),
    );
    const entry = rows[0];
    if (!entry) throw new AppError(ERROR_CODES.notFound, 'Catatan memori tidak ditemukan.', 404);
    if (patch.content !== undefined) {
      await this.dataSource.query(`UPDATE memory_entries SET embedding_model = NULL WHERE id = $1`, [entry.id]);
      void this.embedding.embedEntries([{ id: entry.id, content: entry.content }]);
    }
    return toEntryDto(entry);
  }

  async deleteEntry(auth: AuthContext, subjectId: string, entryId: string): Promise<void> {
    const rows = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM memory_entries WHERE id = $1 AND subject_id = $2 RETURNING id`,
        [entryId, subjectId],
      ),
    );
    if (rows.length === 0) throw new AppError(ERROR_CODES.notFound, 'Catatan memori tidak ditemukan.', 404);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.memoryEntryDeleted,
      severity: 'info',
      summary: 'Menghapus catatan memori',
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'memory_entry',
      entityId: entryId,
      payload: {},
    });
  }

  /**
   * Kotak tinjauan (P2): setujui (dapat dibagikan lewat pintu), jadikan pribadi, atau hapus catatan
   * yang ditahan. `entryIds` kosong = semua catatan di kotak tinjauan.
   */
  async reviewEntries(
    auth: AuthContext,
    subjectId: string,
    entryIds: string[],
    decision: MemoryReviewDecision,
  ): Promise<{ affected: number }> {
    const params: unknown[] = [subjectId];
    let where = 'subject_id = $1 AND needs_review';
    if (entryIds.length > 0) {
      params.push(entryIds);
      where += ' AND id = ANY($2::uuid[])';
    }
    const sql =
      decision === 'delete'
        ? `DELETE FROM memory_entries WHERE ${where} RETURNING id`
        : `UPDATE memory_entries
              SET needs_review = false, updated_at = now()${decision === 'private' ? ", sensitivity = 'private'" : ''}
            WHERE ${where} RETURNING id`;
    const rows = updatedRows<{ id: string }>(await this.dataSource.query(sql, params));
    if (rows.length > 0) {
      await this.audit.record({
        eventKey: AUDIT_EVENTS.memoryEntriesReviewed,
        severity: 'info',
        summary: `Meninjau ${rows.length} catatan memori (${decision})`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'memory_subject',
        entityId: subjectId,
        payload: { decision, count: rows.length },
      });
    }
    return { affected: rows.length };
  }

  // ───────────────────────── Pintu (izin pemilik) ─────────────────────────

  async door(subjectId: string): Promise<MemoryDoorDto> {
    const rows = (await this.dataSource.query(
      `SELECT enabled, exposed_types, expose_agents, review_required, updated_at
         FROM memory_doors WHERE subject_id = $1`,
      [subjectId],
    )) as {
      enabled: boolean;
      exposed_types: MemoryEntryType[] | string;
      expose_agents: boolean;
      review_required: boolean;
      updated_at: string;
    }[];
    const row = rows[0];
    if (!row) {
      return {
        enabled: false,
        exposedTypes: [...DEFAULT_EXPOSED_MEMORY_TYPES],
        exposeAgents: false,
        reviewRequired: false,
        updatedAt: null,
      };
    }
    return {
      enabled: row.enabled,
      exposedTypes: parsePgArray(row.exposed_types),
      exposeAgents: row.expose_agents,
      reviewRequired: row.review_required,
      updatedAt: row.updated_at,
    };
  }

  async setDoor(
    auth: AuthContext,
    subjectId: string,
    input: { enabled: boolean; exposedTypes: MemoryEntryType[]; exposeAgents?: boolean; reviewRequired?: boolean },
  ): Promise<MemoryDoorDto> {
    const types = [...new Set(input.exposedTypes)];
    const current = await this.door(subjectId);
    const exposeAgents = input.exposeAgents ?? current.exposeAgents;
    const reviewRequired = input.reviewRequired ?? current.reviewRequired;
    await this.dataSource.query(
      `INSERT INTO memory_doors
         (subject_id, enabled, exposed_types, expose_agents, review_required, updated_by, updated_at)
       VALUES ($1, $2, $3::memory_entry_type[], $5, $6, $4, now())
       ON CONFLICT (subject_id) DO UPDATE
         SET enabled = $2, exposed_types = $3::memory_entry_type[], expose_agents = $5,
             review_required = $6, updated_by = $4, updated_at = now()`,
      [subjectId, input.enabled, types, auth.user.id, exposeAgents, reviewRequired],
    );
    await this.audit.record({
      eventKey: AUDIT_EVENTS.memoryDoorSettingsUpdated,
      severity: 'info',
      summary: input.enabled ? 'Mengizinkan pintu memori dibuka atasan' : 'Menutup izin pintu memori',
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'memory_subject',
      entityId: subjectId,
      payload: { enabled: input.enabled, exposedTypes: types, exposeAgents, reviewRequired },
    });
    return this.door(subjectId);
  }

  async accessLog(subjectId: string, skip: number, take: number): Promise<{ items: MemoryAccessLogDto[]; total: number }> {
    const total = (
      (await this.dataSource.query(
        `SELECT count(*)::int AS total FROM memory_access_log WHERE subject_id = $1`,
        [subjectId],
      )) as { total: number }[]
    )[0]!.total;
    const rows = (await this.dataSource.query(
      `SELECT l.id::text AS id, u.display_name AS actor_name, l.action, l.context_kind, l.entry_count, l.created_at
         FROM memory_access_log l JOIN users u ON u.id = l.actor_user_id
        WHERE l.subject_id = $1
        ORDER BY l.created_at DESC LIMIT $2 OFFSET $3`,
      [subjectId, take, skip],
    )) as {
      id: string;
      actor_name: string;
      action: MemoryAccessLogDto['action'];
      context_kind: MemoryAccessLogDto['contextKind'];
      entry_count: number;
      created_at: string;
    }[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        actorName: r.actor_name,
        action: r.action,
        contextKind: r.context_kind,
        entryCount: r.entry_count,
        createdAt: r.created_at,
      })),
      total,
    };
  }

  // ───────────────────────── Pintu terbuka per percakapan/tugas ─────────────────────────

  private async assertContextOwner(userId: string, context: MemoryContextRef): Promise<void> {
    const table = context.kind === 'conversation' ? 'conversations' : 'ai_tasks';
    const rows = (await this.dataSource.query(`SELECT 1 FROM ${table} WHERE id = $1 AND user_id = $2`, [
      context.id,
      userId,
    ])) as unknown[];
    if (rows.length === 0) {
      throw new AppError(
        ERROR_CODES.notFound,
        context.kind === 'conversation' ? 'Percakapan tidak ditemukan.' : 'Tugas tidak ditemukan.',
        404,
      );
    }
  }

  private doorTable(context: MemoryContextRef): { table: string; column: string } {
    return context.kind === 'conversation'
      ? { table: 'conversation_memory_doors', column: 'conversation_id' }
      : { table: 'task_memory_doors', column: 'task_id' };
  }

  async contextDoors(auth: AuthContext, context: MemoryContextRef): Promise<MemoryContextDoorDto[]> {
    await this.assertContextOwner(auth.user.id, context);
    const { table, column } = this.doorTable(context);
    const opened = (await this.dataSource.query(`SELECT subject_id FROM ${table} WHERE ${column} = $1`, [
      context.id,
    ])) as { subject_id: string }[];
    if (opened.length === 0) return [];
    const canOpen = auth.effective.allowed.has(PERMISSIONS.memoryDoorsOpen);
    const reach = new Map((await this.scope.reach(auth.user.id)).map((s) => [s.subjectId, s]));
    const result: MemoryContextDoorDto[] = [];
    for (const { subject_id } of opened) {
      const subject = reach.get(subject_id);
      if (subject) {
        result.push({ ...subject, effective: canOpen && subject.granted });
        continue;
      }
      // Di luar jangkauan sekarang (pindah departemen, nonaktif): tampil sebagai tertutup.
      const meta = (await this.dataSource.query(
        `SELECT s.kind, COALESCE(s.user_id, s.agent_id) AS ref_id, COALESCE(u.display_name, a.name) AS name
           FROM memory_subjects s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN agents a ON a.id = s.agent_id
          WHERE s.id = $1`,
        [subject_id],
      )) as { kind: 'user' | 'agent'; ref_id: string; name: string }[];
      if (!meta[0]) continue;
      result.push({
        subjectId: subject_id,
        kind: meta[0].kind,
        refId: meta[0].ref_id,
        name: meta[0].name,
        caption: null,
        departmentName: null,
        ownerName: null,
        granted: false,
        visibleEntries: 0,
        effective: false,
      });
    }
    return result;
  }

  /**
   * Tetapkan pintu terbuka untuk percakapan/tugas. Setiap subjek harus dalam jangkauan dan
   * diizinkan pemiliknya; bila tidak, 403 beserta id yang ditolak.
   */
  /** Tolak (403) subjek yang tidak dalam jangkauan atau belum diizinkan pemiliknya. */
  async assertOpenable(auth: AuthContext, subjectIds: string[]): Promise<string[]> {
    const wanted = [...new Set(subjectIds)];
    if (wanted.length === 0) return wanted;
    if (wanted.length > MEMORY_LIMITS.maxOpenDoors) {
      throw new AppError(
        ERROR_CODES.validation,
        `Paling banyak ${MEMORY_LIMITS.maxOpenDoors} pintu memori dapat dibuka sekaligus.`,
        400,
      );
    }
    if (!auth.effective.allowed.has(PERMISSIONS.memoryDoorsOpen)) {
      throw new AppError(ERROR_CODES.forbidden, 'Anda tidak berwenang membuka pintu memori.', 403);
    }
    const openable = await this.scope.openableIds(auth.user.id);
    const rejected = wanted.filter((id) => !openable.has(id));
    if (rejected.length > 0) {
      throw new AppError(
        ERROR_CODES.forbidden,
        'Sebagian pintu memori tidak dapat dibuka: di luar jangkauan Anda atau belum diizinkan pemiliknya.',
        403,
        { rejected },
      );
    }
    return wanted;
  }

  async setContextDoors(
    auth: AuthContext,
    context: MemoryContextRef,
    subjectIds: string[],
  ): Promise<MemoryContextDoorDto[]> {
    await this.assertContextOwner(auth.user.id, context);
    const wanted = await this.assertOpenable(auth, subjectIds);
    const { table, column } = this.doorTable(context);
    const before = new Set(
      ((await this.dataSource.query(`SELECT subject_id FROM ${table} WHERE ${column} = $1`, [context.id])) as {
        subject_id: string;
      }[]).map((r) => r.subject_id),
    );
    const opened = wanted.filter((id) => !before.has(id));
    const closed = [...before].filter((id) => !wanted.includes(id));
    await this.dataSource.transaction(async (manager) => {
      if (closed.length > 0) {
        await manager.query(`DELETE FROM ${table} WHERE ${column} = $1 AND subject_id = ANY($2::uuid[])`, [
          context.id,
          closed,
        ]);
      }
      for (const subjectId of opened) {
        await manager.query(
          `INSERT INTO ${table} (${column}, subject_id, opened_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [context.id, subjectId, auth.user.id],
        );
      }
      for (const [action, ids] of [
        ['door_opened', opened],
        ['door_closed', closed],
      ] as const) {
        for (const subjectId of ids) {
          await manager.query(
            `INSERT INTO memory_access_log (subject_id, actor_user_id, action, context_kind, context_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [subjectId, auth.user.id, action, context.kind, context.id],
          );
        }
      }
    });
    for (const [eventKey, ids, verb] of [
      [AUDIT_EVENTS.memoryDoorOpened, opened, 'Membuka'],
      [AUDIT_EVENTS.memoryDoorClosed, closed, 'Menutup'],
    ] as const) {
      for (const subjectId of ids) {
        await this.audit.record({
          eventKey,
          severity: 'info',
          summary: `${verb} pintu memori pada ${context.kind === 'conversation' ? 'percakapan' : 'tugas'}`,
          actorUserId: auth.user.id,
          actorLabel: auth.user.email,
          actorIp: auth.session.ip,
          entityType: 'memory_subject',
          entityId: subjectId,
          payload: { contextKind: context.kind, contextId: context.id },
        });
      }
    }
    return this.contextDoors(auth, context);
  }

  // ───────────────────────── Pengambilan (read path) ─────────────────────────

  /**
   * Ambil memori relevan untuk satu jawaban dan susun blok prompt-nya. Tidak pernah melempar:
   * kegagalan memori tidak boleh menggagalkan chat.
   */
  async retrieve(
    userId: string,
    permissions: ReadonlySet<string>,
    context: MemoryContextRef | null,
    query: string,
    options: { agentId?: string | null; peerAgentIds?: string[] } = {},
  ): Promise<MemoryRetrieval> {
    const empty: MemoryRetrieval = { block: '', refs: [] };
    if (!permissions.has(PERMISSIONS.memorySelfManage)) return empty;
    try {
      const settings = await this.settings.get();
      if (!settings.enabled) return empty;
      const subjects = await this.scope.resolve(userId, context, {
        canOpenDoors: permissions.has(PERMISSIONS.memoryDoorsOpen),
        agentId: options.agentId ?? null,
        ...(options.peerAgentIds?.length ? { peerAgentIds: options.peerAgentIds } : {}),
      });
      const candidates = await this.search(subjects, query);
      const summaries = await this.ownSummaries(subjects);
      if (candidates.length === 0 && summaries.length === 0) return empty;
      const ranked = rankCandidates(candidates);
      const result = buildMemoryBlock(ranked, settings.maxContextTokens, summaries);
      if (result.refs.length > 0) await this.recordUse(userId, context, subjects, result.refs);
      return result;
    } catch (error) {
      this.logger.warn(`Pengambilan memori gagal: ${(error as Error).message}`);
      return empty;
    }
  }

  /** Ringkasan profil (P3) hanya dari buku milik penanya: ringkasan memuat catatan pribadi. */
  private async ownSummaries(subjects: ScopeSubject[]): Promise<{ name: string; content: string }[]> {
    const own = subjects.filter((s) => s.own);
    if (own.length === 0) return [];
    const rows = (await this.dataSource.query(
      `SELECT id, summary FROM memory_subjects WHERE id = ANY($1::uuid[]) AND summary IS NOT NULL`,
      [own.map((s) => s.subjectId)],
    )) as { id: string; summary: string }[];
    return own.flatMap((subject, index) => {
      const row = rows.find((r) => r.id === subject.subjectId);
      if (!row) return [];
      return [{ name: index === 0 ? 'Anda' : subject.name, content: row.summary }];
    });
  }

  /** Filter cakupan dalam SQL: subjek sendiri semua catatan aktif; subjek lain sesuai pintunya. */
  private scopeFilter(subjects: ScopeSubject[], params: unknown[]): string {
    const clauses: string[] = [];
    for (const subject of subjects.filter((s) => s.own)) {
      params.push(subject.subjectId);
      clauses.push(
        subject.skipAgentProfile
          ? `(e.subject_id = $${params.length} AND e.source_kind <> 'agent_profile')`
          : `e.subject_id = $${params.length}`,
      );
    }
    for (const subject of subjects.filter((s) => !s.own)) {
      params.push(subject.subjectId, subject.exposedTypes);
      clauses.push(
        `(e.subject_id = $${params.length - 1} AND e.sensitivity = 'shareable' AND NOT e.needs_review
          AND e.type = ANY($${params.length}::memory_entry_type[]))`,
      );
    }
    return `e.status = 'active' AND (${clauses.join(' OR ')})`;
  }

  private async search(subjects: ScopeSubject[], query: string): Promise<RankCandidate[]> {
    const names = new Map(subjects.map((s) => [s.subjectId, s]));
    type Row = {
      id: string;
      subject_id: string;
      type: MemoryEntryType;
      content: string;
      importance: number;
      created_at: string;
    };
    const merged = new Map<string, RankCandidate>();
    const add = (rows: Row[], key: 'vectorRank' | 'textRank') => {
      rows.forEach((row, index) => {
        const subject = names.get(row.subject_id)!;
        const existing = merged.get(row.id) ?? {
          id: row.id,
          subjectId: row.subject_id,
          subjectName: subject.name,
          own: subject.own,
          type: row.type,
          content: row.content,
          importance: row.importance,
          createdAt: new Date(row.created_at),
          vectorRank: null,
          textRank: null,
        };
        existing[key] = index + 1;
        merged.set(row.id, existing);
      });
    };
    const columns = 'e.id, e.subject_id, e.type, e.content, e.importance, e.created_at';

    const tsQuery = toTsQuery(query);
    if (tsQuery) {
      const params: unknown[] = [];
      const filter = this.scopeFilter(subjects, params);
      params.push(tsQuery, CANDIDATES_PER_SEARCH);
      add(
        (await this.dataSource.query(
          `SELECT ${columns} FROM memory_entries e
            WHERE ${filter} AND e.tsv @@ to_tsquery('simple', $${params.length - 1})
            ORDER BY ts_rank(e.tsv, to_tsquery('simple', $${params.length - 1})) DESC
            LIMIT $${params.length}`,
          params,
        )) as Row[],
        'textRank',
      );
    }

    const queryVector = query.trim() ? await this.embedding.embed([query.slice(0, 2000)]) : null;
    if (queryVector) {
      const params: unknown[] = [];
      const filter = this.scopeFilter(subjects, params);
      params.push(toVectorLiteral(queryVector.vectors[0]!), queryVector.model, CANDIDATES_PER_SEARCH);
      add(
        (await this.dataSource.query(
          `SELECT ${columns} FROM memory_entries e
            WHERE ${filter} AND e.embedding IS NOT NULL AND e.embedding_model = $${params.length - 1}
            ORDER BY e.embedding <=> $${params.length - 2}::vector
            LIMIT $${params.length}`,
          params,
        )) as Row[],
        'vectorRank',
      );
    }

    // Profil dan preferensi penting milik sendiri selalu relevan (mis. gaya jawaban yang disukai).
    const standingParams: unknown[] = [];
    const standingFilter = this.scopeFilter(
      subjects.filter((s) => s.own),
      standingParams,
    );
    standingParams.push(STANDING_ENTRIES);
    const standing = (await this.dataSource.query(
      `SELECT ${columns} FROM memory_entries e
        WHERE ${standingFilter} AND e.type IN ('profile', 'preference') AND e.importance >= 4
        ORDER BY e.importance DESC, e.updated_at DESC LIMIT $${standingParams.length}`,
      standingParams,
    )) as Row[];
    standing.forEach((row, index) => {
      const existing = merged.get(row.id);
      if (existing) return;
      add([row], 'textRank');
      merged.get(row.id)!.textRank = CANDIDATES_PER_SEARCH + index + 1;
    });
    return [...merged.values()];
  }

  /** Catat pemakaian: hitungan per catatan dan log akses untuk tiap subjek orang lain. */
  private async recordUse(
    userId: string,
    context: MemoryContextRef | null,
    subjects: ScopeSubject[],
    refs: MemoryRefDto[],
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE memory_entries SET use_count = use_count + 1, last_used_at = now() WHERE id = ANY($1::uuid[])`,
      [refs.map((r) => r.entryId)],
    );
    if (!context) return;
    const bySubject = new Map<string, number>();
    const entrySubjects = (await this.dataSource.query(
      `SELECT id, subject_id FROM memory_entries WHERE id = ANY($1::uuid[])`,
      [refs.map((r) => r.entryId)],
    )) as { id: string; subject_id: string }[];
    const others = new Set(subjects.filter((s) => !s.own).map((s) => s.subjectId));
    for (const row of entrySubjects) {
      if (others.has(row.subject_id)) bySubject.set(row.subject_id, (bySubject.get(row.subject_id) ?? 0) + 1);
    }
    for (const [subjectId, count] of bySubject) {
      await this.dataSource.query(
        `INSERT INTO memory_access_log (subject_id, actor_user_id, action, context_kind, context_id, entry_count)
         VALUES ($1, $2, 'entries_read', $3, $4, $5)`,
        [subjectId, userId, context.kind, context.id, count],
      );
    }
  }
}
