import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  MEMORY_ENTRY_TYPES,
  PERMISSIONS,
  type MemoryEntryType,
  type MemorySensitivity,
} from '@bara/shared';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AiGatewayService } from '../ai/gateway.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { MemoryEmbeddingService } from './memory-embedding.service';
import { redactForMemory } from './memory-redactor';
import { MemoryScopeService } from './memory-scope.service';
import { toTsQuery } from './memory.service';
import { MemorySettingsService } from './memory-settings.service';

const DEBOUNCE_MS = 60_000;
const MAX_TRANSCRIPT_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2000;
const MAX_EXISTING = 30;
const MAX_OPERATIONS = 5;
const MIN_CONFIDENCE = 0.5;
const MAX_ENTRY_CHARS = 300;
const RETENTION_INTERVAL_MS = 60 * 60_000;
const QUEUE_LOG_INTERVAL_MS = 5 * 60_000;
const MAX_MEMBER_AGENTS = 5;
const MAX_MEMBER_CHARS = 1200;

export const EXTRACTOR_PROMPT = `Anda adalah pencatat klinis untuk memori terpusat ContributorAI.
Dari transkrip, catat hal yang tahan lama tentang SUBJEK (bukan pengetahuan umum dan bukan tentang AI):
siapa dia dan tanggung jawabnya (profile), preferensinya (preference), fakta kerja yang ia pegang (fact),
keputusan yang ia ambil atau sepakati (decision), peristiwa penting (episode), dan keahliannya (skill).

Aturan:
- Pilih sedikit catatan yang tepat (paling banyak 5). Bila tidak ada yang layak, kembalikan operasi kosong.
- Tiap catatan berdiri sendiri, orang ketiga, maksimal 300 karakter, dalam bahasa transkrip. Tulis
  "Dina menyetujui…", bukan "dia menyetujui…". Sertakan tanggal bila relevan.
- Jangan pernah mencatat rahasia, kredensial, data kesehatan, agama, biometrik, genetik, catatan kriminal,
  orientasi seksual, atau data pribadi spesifik lain. Abaikan teks bertanda [NIK], [nomor telepon], dsb.
- Tandai "private" untuk hal yang bersifat pribadi; selain itu "shareable".
- Bandingkan dengan catatan yang sudah ada:
  - sama maknanya dan tidak ada info baru → jangan dicatat;
  - sama maknanya dengan detail lebih baik → op "update" dengan targetId;
  - bertentangan dengan catatan lama (mis. keputusan berubah) → op "supersede" dengan targetId;
  - selain itu → op "add".

Jawab HANYA JSON tanpa teks lain:
{"operations":[{"op":"add|update|supersede","targetId":"<id catatan lama atau null>","about":"user|agent|agent2|…",
"type":"profile|preference|fact|decision|episode|skill","content":"...","importance":1-5,
"confidence":0-1,"sensitivity":"shareable|private"}]}`;

export interface ExtractionOperation {
  op: 'add' | 'update' | 'supersede';
  targetId: string | null;
  /** "user", "agent" (agent utama/Leader), atau "agent2", "agent3", … untuk anggota grup. */
  about: string;
  type: MemoryEntryType;
  content: string;
  importance: number;
  confidence: number;
  sensitivity: MemorySensitivity;
}

/** JSON pertama yang dapat dibaca dari keluaran model (boleh dibungkus teks atau ```json). */
function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const end = cleaned.lastIndexOf(cleaned[start] === '[' ? ']' : '}');
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Parse keluaran model secara defensif; operasi tidak valid dibuang. Model kecil sering
 * mengembalikan array polos atau satu objek operasi tanpa pembungkus `operations`.
 */
export function parseOperations(raw: string): ExtractionOperation[] {
  const parsed = extractJson(raw);
  if (parsed === null || typeof parsed !== 'object') return [];
  const wrapped = parsed as { operations?: unknown; entries?: unknown; op?: unknown; content?: unknown };
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(wrapped.operations)
      ? wrapped.operations
      : Array.isArray(wrapped.entries)
        ? wrapped.entries
        : wrapped.op !== undefined || wrapped.content !== undefined
          ? [parsed]
          : null;
  if (!list) return [];
  const operations: ExtractionOperation[] = [];
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue;
    const op = item.op ?? 'add';
    const type = item.type as MemoryEntryType;
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    const confidence = Number(item.confidence);
    if (op !== 'add' && op !== 'update' && op !== 'supersede') continue;
    if (!MEMORY_ENTRY_TYPES.includes(type) || !content) continue;
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) continue;
    operations.push({
      op,
      targetId: typeof item.targetId === 'string' && item.targetId ? item.targetId : null,
      about: typeof item.about === 'string' && /^agent\d*$/.test(item.about.trim()) ? item.about.trim() : 'user',
      type,
      content: content.slice(0, MAX_ENTRY_CHARS),
      importance: Math.min(5, Math.max(1, Math.round(Number(item.importance) || 3))),
      confidence: Math.min(1, confidence),
      sensitivity: item.sensitivity === 'private' ? 'private' : 'shareable',
    });
    if (operations.length >= MAX_OPERATIONS) break;
  }
  return operations;
}

interface ExistingEntry {
  id: string;
  type: MemoryEntryType;
  content: string;
  edited_by_owner: boolean;
}

interface ExtractionSubject {
  about: string;
  subjectId: string;
  name: string;
}

/**
 * Jalur tulis memori (psikiater mencatat). Berjalan di belakang layar setelah giliran chat atau
 * tugas selesai; tidak memperlambat jawaban. Teks selalu disaring dari data pribadi lebih dulu.
 */
@Injectable()
export class MemoryExtractionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MemoryExtractionService.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly inflight = new Set<Promise<unknown>>();
  private retentionTimer: NodeJS.Timeout | null = null;
  private queueTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly gateway: AiGatewayService,
    private readonly scope: MemoryScopeService,
    private readonly embedding: MemoryEmbeddingService,
    private readonly settings: MemorySettingsService,
    private readonly effective: EffectivePermissionsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.retentionTimer = setInterval(() => void this.applyRetention(), RETENTION_INTERVAL_MS);
    this.retentionTimer.unref();
    this.queueTimer = setInterval(() => void this.logQueue(), QUEUE_LOG_INTERVAL_MS);
    this.queueTimer.unref();
    this.track(this.resumePending());
  }

  /** Kedalaman antrean pencatatan dan embedding, untuk observabilitas. */
  async queueStats(): Promise<{ scheduled: number; running: number; embeddingBacklog: number | null }> {
    let embeddingBacklog: number | null = null;
    if (await this.embedding.vectorAvailable()) {
      const rows = (await this.dataSource.query(
        `SELECT count(*)::int AS n FROM memory_entries WHERE status = 'active' AND embedding IS NULL`,
      )) as { n: number }[];
      embeddingBacklog = rows[0]?.n ?? 0;
    }
    return { scheduled: this.pending.size, running: this.inflight.size, embeddingBacklog };
  }

  private async logQueue(): Promise<void> {
    try {
      const stats = await this.queueStats();
      if (stats.scheduled + stats.running + (stats.embeddingBacklog ?? 0) === 0) return;
      this.logger.log(
        `Antrean memori: ${stats.scheduled} terjadwal, ${stats.running} berjalan` +
          (stats.embeddingBacklog === null ? '' : `, ${stats.embeddingBacklog} catatan menunggu embedding`),
      );
    } catch (error) {
      this.logger.warn(`Statistik antrean memori gagal: ${(error as Error).message}`);
    }
  }

  /**
   * Jadwal debounce hidup di memori proses; setelah restart, percakapan dan tugas 24 jam
   * terakhir yang belum dicatat dijadwalkan ulang (penanda `memory_watermark` / `memory_extracted_at`).
   */
  async resumePending(): Promise<number> {
    if (!(await this.settings.get()).enabled) return 0;
    const conversations = (await this.dataSource.query(
      `SELECT c.id, c.user_id FROM conversations c
        WHERE c.updated_at > now() - interval '1 day'
          AND EXISTS (SELECT 1 FROM conversation_messages m
                       WHERE m.conversation_id = c.id AND m.id > c.memory_watermark AND m.role = 'assistant')
        ORDER BY c.updated_at DESC LIMIT 100`,
    )) as { id: string; user_id: string }[];
    const tasks = (await this.dataSource.query(
      `SELECT id, user_id FROM ai_tasks
        WHERE status = 'completed' AND memory_extracted_at IS NULL AND parent_task_id IS NULL
          AND finished_at > now() - interval '1 day'
        ORDER BY finished_at DESC LIMIT 100`,
    )) as { id: string; user_id: string }[];
    let scheduled = 0;
    for (const [index, row] of conversations.entries()) {
      if (!(await this.effective.can(row.user_id, PERMISSIONS.memorySelfManage)).allowed) continue;
      this.scheduleConversation(row.id, DEBOUNCE_MS + index * 2_000);
      scheduled += 1;
    }
    for (const row of tasks) {
      if (!(await this.effective.can(row.user_id, PERMISSIONS.memorySelfManage)).allowed) continue;
      this.scheduleTask(row.id);
      scheduled += 1;
    }
    if (scheduled > 0) this.logger.log(`Melanjutkan ${scheduled} pencatatan memori yang tertunda.`);
    return scheduled;
  }

  onModuleDestroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    if (this.queueTimer) clearInterval(this.queueTimer);
  }

  /** Jadwalkan pencatatan percakapan; giliran beruntun digabung (debounce). */
  scheduleConversation(conversationId: string, delayMs = DEBOUNCE_MS): void {
    const existing = this.pending.get(conversationId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(conversationId);
      this.track(this.extractConversation(conversationId));
    }, delayMs);
    timer.unref();
    this.pending.set(conversationId, timer);
  }

  scheduleTask(taskId: string): void {
    this.track(this.extractTask(taskId));
  }

  /** Jalankan semua jadwal sekarang dan tunggu selesai (uji dan shutdown). */
  async flush(): Promise<void> {
    for (const [conversationId, timer] of this.pending) {
      clearTimeout(timer);
      this.pending.delete(conversationId);
      this.track(this.extractConversation(conversationId));
    }
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private track(promise: Promise<unknown>): void {
    const tracked = promise
      .catch((error: Error) => this.logger.warn(`Ekstraksi memori gagal: ${error.message}`))
      .finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }

  private async withinBudget(userId: string): Promise<boolean> {
    const { enabled, maxExtractionsPerDay } = await this.settings.get();
    if (!enabled) return false;
    const rows = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM memory_extraction_runs
        WHERE user_id = $1 AND created_at > now() - interval '1 day' AND error IS NULL`,
      [userId],
    )) as { n: number }[];
    if ((rows[0]?.n ?? 0) >= maxExtractionsPerDay) {
      this.logger.log(`Kuota ekstraksi memori harian pengguna ${userId} habis; dilewati.`);
      return false;
    }
    return true;
  }

  async extractConversation(conversationId: string): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT c.user_id, c.mode, c.memory_watermark, u.display_name
         FROM conversations c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
      [conversationId],
    )) as { user_id: string; mode: string; memory_watermark: string; display_name: string }[];
    const conversation = rows[0];
    if (!conversation || !(await this.withinBudget(conversation.user_id))) return;
    const messages = (await this.dataSource.query(
      `SELECT id, role, content FROM conversation_messages
        WHERE conversation_id = $1 AND id > $2 AND role IN ('user', 'assistant')
        ORDER BY id DESC LIMIT $3`,
      [conversationId, conversation.memory_watermark, MAX_TRANSCRIPT_MESSAGES],
    )) as { id: string; role: 'user' | 'assistant'; content: string }[];
    if (messages.length === 0) return;
    messages.reverse();
    const lastId = messages[messages.length - 1]!.id;
    const transcript = messages
      .map((m) => `${m.role === 'user' ? conversation.display_name : 'Asisten'}: ${m.content.slice(0, MAX_MESSAGE_CHARS)}`)
      .join('\n\n');

    const subjectId = await this.scope.ensureUserSubject(conversation.user_id);
    await this.run(
      conversation.user_id,
      { kind: 'conversation', id: conversationId, messageId: lastId },
      transcript,
      [{ about: 'user', subjectId, name: conversation.display_name }],
      `Subjek: ${conversation.display_name} (pengguna). Mode percakapan: ${conversation.mode}.`,
    );
    await this.dataSource.query(
      `UPDATE conversations SET memory_watermark = GREATEST(memory_watermark, $2) WHERE id = $1`,
      [conversationId, lastId],
    );
  }

  async extractTask(taskId: string): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT t.user_id, t.title, t.instruction, t.result, t.agent_id, t.group_id, t.parent_task_id,
              t.memory_extracted_at, u.display_name,
              COALESCE(t.agent_id, g.leader_agent_id) AS working_agent_id
         FROM ai_tasks t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN agent_groups g ON g.id = t.group_id
        WHERE t.id = $1 AND t.status = 'completed'`,
      [taskId],
    )) as {
      user_id: string;
      title: string;
      instruction: string;
      result: string | null;
      parent_task_id: string | null;
      memory_extracted_at: string | null;
      display_name: string;
      working_agent_id: string | null;
    }[];
    const task = rows[0];
    if (!task || task.parent_task_id || task.memory_extracted_at) return;
    if (!(await this.withinBudget(task.user_id))) return;

    const subjects: ExtractionSubject[] = [
      { about: 'user', subjectId: await this.scope.ensureUserSubject(task.user_id), name: task.display_name },
    ];
    let agentName: string | null = null;
    if (task.working_agent_id) {
      const agentSubject = await this.scope.ensureAgentSubject(task.working_agent_id);
      agentName =
        ((await this.dataSource.query(`SELECT name FROM agents WHERE id = $1`, [task.working_agent_id])) as {
          name: string;
        }[])[0]?.name ?? null;
      if (agentSubject && agentName) subjects.push({ about: 'agent', subjectId: agentSubject, name: agentName });
    }
    const members = await this.groupContributions(taskId, task.working_agent_id);
    for (const [index, member] of members.entries()) {
      const subjectId = await this.scope.ensureAgentSubject(member.agentId);
      if (subjectId) subjects.push({ about: `agent${index + 2}`, subjectId, name: member.name });
    }
    const memberSubjects = subjects.filter((s) => /^agent\d+$/.test(s.about));
    const replies = (await this.dataSource.query(
      `SELECT message->>'content' AS content FROM ai_task_messages
        WHERE task_id = $1 AND message->>'role' = 'user' ORDER BY id LIMIT 6`,
      [taskId],
    )) as { content: string | null }[];
    const transcript = [
      `${task.display_name} memberi tugas "${task.title}":`,
      task.instruction.slice(0, MAX_MESSAGE_CHARS),
      ...replies
        .slice(1)
        .filter((r) => r.content)
        .map((r) => `${task.display_name} menambahkan: ${r.content!.slice(0, MAX_MESSAGE_CHARS)}`),
      ...members
        .filter((m) => memberSubjects.some((s) => s.name === m.name))
        .map((m) => `Kontribusi anggota grup ${m.name}:\n${m.text}`),
      `Hasil kerja ${agentName ?? 'agent'}:`,
      (task.result ?? '').slice(0, MAX_MESSAGE_CHARS * 2),
    ].join('\n\n');
    const memberNote =
      memberSubjects.length > 0
        ? ' Anggota grup: ' +
          memberSubjects.map((s) => `"${s.name}" (about="${s.about}")`).join(', ') +
          '. Catat untuk anggota hanya hal yang tampak dari kontribusinya sendiri.'
        : '';
    await this.run(
      task.user_id,
      { kind: 'task', id: taskId, messageId: null },
      transcript,
      subjects,
      (agentName
        ? `Subjek: ${task.display_name} (pengguna, about="user") dan agent "${agentName}" (about="agent"). ` +
          'Untuk agent, catat cara kerja, prosedur, dan preferensi pemilik yang perlu diingat agent pada tugas berikutnya.'
        : `Subjek: ${task.display_name} (pengguna).`) + memberNote,
    );
    await this.dataSource.query(`UPDATE ai_tasks SET memory_extracted_at = now() WHERE id = $1`, [taskId]);
  }

  /**
   * Kontribusi agent anggota grup selain agent utama: hasil sub-tugas delegasi dan giliran diskusi.
   * Hanya agent aktif milik pemilik tugas yang ikut dicatat.
   */
  private async groupContributions(
    taskId: string,
    leaderAgentId: string | null,
  ): Promise<{ agentId: string; name: string; text: string }[]> {
    const rows = (await this.dataSource.query(
      `SELECT a.id AS agent_id, a.name, string_agg(x.text, E'\n\n' ORDER BY x.at) AS text
         FROM (
           SELECT c.agent_id, c.result AS text, c.finished_at AS at
             FROM ai_tasks c WHERE c.parent_task_id = $1 AND c.status = 'completed' AND c.result IS NOT NULL
           UNION ALL
           SELECT (e.payload->>'agentId')::uuid, e.payload->>'content', e.created_at
             FROM ai_task_events e
            WHERE e.task_id = $1 AND e.event_type = 'discussion' AND e.payload ? 'agentId'
         ) x
         JOIN agents a ON a.id = x.agent_id
         JOIN ai_tasks t ON t.id = $1
        WHERE a.owner_user_id = t.user_id AND a.status = 'active'
          AND ($2::uuid IS NULL OR a.id <> $2::uuid)
        GROUP BY a.id, a.name
        ORDER BY min(x.at)
        LIMIT $3`,
      [taskId, leaderAgentId, MAX_MEMBER_AGENTS],
    )) as { agent_id: string; name: string; text: string | null }[];
    return rows
      .filter((r) => r.text)
      .map((r) => ({ agentId: r.agent_id, name: r.name, text: r.text!.slice(-MAX_MEMBER_CHARS) }));
  }

  /** Catatan aktif yang paling mungkin bersinggungan dengan transkrip, untuk rekonsiliasi. */
  private async existingEntries(subjectIds: string[], transcript: string): Promise<(ExistingEntry & { subject_id: string })[]> {
    const tsQuery = toTsQuery(transcript.slice(0, 4000));
    const related = tsQuery
      ? ((await this.dataSource.query(
          `SELECT id, subject_id, type, content, edited_by_owner FROM memory_entries
            WHERE subject_id = ANY($1::uuid[]) AND status = 'active' AND tsv @@ to_tsquery('simple', $2)
            ORDER BY ts_rank(tsv, to_tsquery('simple', $2)) DESC LIMIT $3`,
          [subjectIds, tsQuery, MAX_EXISTING - 10],
        )) as (ExistingEntry & { subject_id: string })[])
      : [];
    const recent = (await this.dataSource.query(
      `SELECT id, subject_id, type, content, edited_by_owner FROM memory_entries
        WHERE subject_id = ANY($1::uuid[]) AND status = 'active'
        ORDER BY importance DESC, updated_at DESC LIMIT 10`,
      [subjectIds],
    )) as (ExistingEntry & { subject_id: string })[];
    const merged = new Map([...related, ...recent].map((e) => [e.id, e]));
    return [...merged.values()].slice(0, MAX_EXISTING);
  }

  private async run(
    userId: string,
    source: { kind: 'conversation' | 'task'; id: string; messageId: string | null },
    rawTranscript: string,
    subjects: ExtractionSubject[],
    subjectNote: string,
  ): Promise<void> {
    const transcript = redactForMemory(rawTranscript);
    const existing = await this.existingEntries(
      subjects.map((s) => s.subjectId),
      transcript,
    );
    const aboutOf = new Map(subjects.map((s) => [s.subjectId, s.about]));
    const existingText =
      existing.length > 0
        ? existing.map((e) => `- id=${e.id} about=${aboutOf.get(e.subject_id)} (${e.type}) ${e.content}`).join('\n')
        : '(belum ada)';
    const { extractorModel } = await this.settings.get();
    // Kotak tinjauan (P2): catatan baru/berubah ditahan bila pemilik buku mewajibkan tinjauan.
    const reviewed = new Set(
      ((await this.dataSource.query(
        `SELECT subject_id FROM memory_doors WHERE subject_id = ANY($1::uuid[]) AND review_required`,
        [subjects.map((s) => s.subjectId)],
      )) as { subject_id: string }[]).map((r) => r.subject_id),
    );
    const counts = { added: 0, updated: 0, superseded: 0 };
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    try {
      const result = await this.gateway.chat({
        mode: 'subordinate',
        systemPrompt: EXTRACTOR_PROMPT,
        messages: [
          {
            role: 'user',
            content: `${subjectNote}\n\nCatatan yang sudah ada:\n${existingText}\n\nTranskrip:\n${transcript}`,
          },
        ],
        guard: source.kind === 'conversation' ? { userId, conversationId: source.id } : { userId, taskId: source.id },
        usageSource: 'memory',
        ...(extractorModel ? { model: extractorModel } : {}),
      });
      tokensIn = result.tokensIn;
      tokensOut = result.tokensOut;
      const existingById = new Map(existing.map((e) => [e.id, e]));
      const touched: { id: string; content: string }[] = [];
      for (const operation of parseOperations(result.content)) {
        const subject = subjects.find((s) => s.about === operation.about) ?? subjects[0]!;
        const content = redactForMemory(operation.content);
        const target = operation.targetId ? existingById.get(operation.targetId) : undefined;
        const targetUsable = target && target.subject_id === subject.subjectId && !target.edited_by_owner;
        if (operation.op === 'update' && targetUsable) {
          await this.dataSource.query(
            `UPDATE memory_entries
                SET content = $2, type = $3, importance = $4, confidence = $5, embedding_model = NULL,
                    source_kind = $6, source_id = $7, source_message_id = $8, updated_at = now(),
                    needs_review = needs_review OR $9
              WHERE id = $1 AND status = 'active' AND NOT edited_by_owner`,
            [
              target.id,
              content,
              operation.type,
              operation.importance,
              operation.confidence,
              source.kind,
              source.id,
              source.messageId,
              reviewed.has(subject.subjectId),
            ],
          );
          touched.push({ id: target.id, content });
          counts.updated += 1;
          continue;
        }
        const inserted = (await this.dataSource.query(
          `INSERT INTO memory_entries
             (subject_id, type, content, importance, confidence, sensitivity, source_kind, source_id,
              source_message_id, supersedes_id, needs_review)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            subject.subjectId,
            operation.type,
            content,
            operation.importance,
            operation.confidence,
            operation.sensitivity,
            source.kind,
            source.id,
            source.messageId,
            operation.op === 'supersede' && targetUsable ? target.id : null,
            reviewed.has(subject.subjectId),
          ],
        )) as { id: string }[];
        touched.push({ id: inserted[0]!.id, content });
        if (operation.op === 'supersede' && targetUsable) {
          await this.dataSource.query(
            `UPDATE memory_entries SET status = 'superseded', valid_to = now(), updated_at = now()
              WHERE id = $1 AND status = 'active'`,
            [target.id],
          );
          counts.superseded += 1;
        } else {
          counts.added += 1;
        }
      }
      await this.recordRun(userId, source, counts, tokensIn, tokensOut, null);
      if (touched.length > 0) await this.embedding.embedEntries(touched);
    } catch (error) {
      await this.recordRun(userId, source, counts, tokensIn, tokensOut, (error as Error).message.slice(0, 500));
      throw error;
    }
  }

  private async recordRun(
    userId: string,
    source: { kind: 'conversation' | 'task'; id: string },
    counts: { added: number; updated: number; superseded: number },
    tokensIn: number | null,
    tokensOut: number | null,
    error: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO memory_extraction_runs
         (user_id, source_kind, source_id, added, updated, superseded, tokens_in, tokens_out, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        source.kind,
        source.id,
        counts.added,
        counts.updated,
        counts.superseded,
        tokensIn,
        tokensOut,
        error,
      ],
    );
    if (!error) {
      this.logger.log(
        `Memori dicatat dari ${source.kind} ${source.id}: +${counts.added} ~${counts.updated} ⇄${counts.superseded}`,
      );
    }
  }

  /** Arsipkan catatan peristiwa yang melewati masa retensi (0 = nonaktif). */
  async applyRetention(): Promise<number> {
    const { retentionDays } = await this.settings.get();
    if (retentionDays <= 0) return 0;
    const rows = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE memory_entries SET status = 'archived', updated_at = now()
          WHERE type = 'episode' AND status = 'active' AND created_at < now() - make_interval(days => $1)
          RETURNING id`,
        [retentionDays],
      ),
    );
    return rows.length;
  }
}
