import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  AUDIT_EVENTS,
  type MemoryDigestDto,
  type MemoryDigestPeriod,
  type MemoryEntryType,
  type MemoryProfileSummaryDto,
  type MemoryRefDto,
  type MemoryThemeSubjectDto,
} from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AiGatewayService } from '../ai/gateway.service';
import { AuditService } from '../audit/audit.service';
import { redactForMemory } from './memory-redactor';
import { MemoryScopeService } from './memory-scope.service';
import { MemorySettingsService } from './memory-settings.service';
import { MemoryService, memoryKeywords } from './memory.service';

const CONSOLIDATE_INTERVAL_MS = 6 * 60 * 60_000;
const CONSOLIDATE_BATCH = 20;
/** Ringkasan profil baru dibuat bila buku punya cukup catatan. */
export const SUMMARY_MIN_ENTRIES = 5;
const SUMMARY_SOURCE_ENTRIES = 40;
const SUMMARY_MAX_CHARS = 900;
const DIGEST_ENTRIES_PER_SUBJECT = 10;
const THEME_ENTRIES_PER_SUBJECT = 200;
const THEMES_PER_SUBJECT = 8;
/** Kata kerja/pengisi yang sering muncul di catatan tetapi tidak bermakna sebagai tema. */
const THEME_STOPWORDS = new Set(
  (
    'setiap selalu sering harus perlu lebih sudah masih sedang telah dapat bisa minta meminta memberi memberikan ' +
    'diberi dilakukan melakukan dicatat mencatat disepakati menyepakati sepakat hasil hasilnya bentuk area mulai ' +
    'secara sebelum sesudah setelah antara tentang terkait mengenai hari minggu bulan tahun kali para bagian ' +
    'pengguna asisten agent tugas catatan'
  ).split(' '),
);

export const CONSOLIDATION_PROMPT = `Anda menyusun "ringkasan profil" untuk memori terpusat ContributorAI.
Dari daftar catatan tentang SUBJEK, tulis satu paragraf ringkas (maksimal 600 karakter) dalam bahasa catatan:
peran dan tanggung jawabnya, cara kerja dan preferensi utamanya, serta keputusan atau fakta yang masih berlaku.
Tulis orang ketiga dengan nama subjek. Utamakan catatan berkepentingan tinggi dan yang terbaru; abaikan yang
sepele. Jangan menambah hal yang tidak tertulis. Jawab hanya paragraf ringkasan, tanpa judul atau daftar.`;

export const DIGEST_PROMPT = `Anda menyusun ringkasan tim untuk seorang atasan dari memori terpusat ContributorAI.
Bahan hanya catatan yang diizinkan pemiliknya untuk dibaca atasan. Susun dalam Markdown, singkat (maksimal 200 kata):
1. "Tema utama" — 2–4 butir lintas anggota.
2. "Keputusan dan kesepakatan" — bila ada.
3. "Per anggota" — satu butir singkat per nama.
4. "Perlu perhatian" — hanya bila tersirat jelas dari catatan.
Selalu sebut nama sumber. Jangan menambah informasi di luar catatan, jangan menilai kinerja atau pribadi
seseorang, dan jangan menampilkan kode [m1], [m2].`;

interface SubjectMeta {
  id: string;
  kind: 'user' | 'agent';
  name: string;
  owner_user_id: string;
  department_name: string | null;
}

/**
 * Wawasan memori (P2/P3): ringkasan profil per subjek, ringkasan tim untuk atasan, dan tema memori
 * untuk Peta Pikiran. Atasan hanya pernah menerima bahan dari pintu yang diizinkan (shareable, jenis
 * yang dibuka, sudah ditinjau) dan setiap pembacaan tercatat di log akses pemiliknya.
 */
@Injectable()
export class MemoryInsightsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MemoryInsightsService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly gateway: AiGatewayService,
    private readonly scope: MemoryScopeService,
    private readonly memory: MemoryService,
    private readonly settings: MemorySettingsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.consolidatePending(), CONSOLIDATE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ───────────────────────── Ringkasan profil (konsolidasi) ─────────────────────────

  /** Perbarui ringkasan subjek yang bukunya berubah sejak ringkasan terakhir. */
  async consolidatePending(): Promise<number> {
    if (this.running || !(await this.settings.get()).enabled) return 0;
    this.running = true;
    try {
      const rows = (await this.dataSource.query(
        `SELECT s.id FROM memory_subjects s
          WHERE (SELECT count(*) FROM memory_entries e WHERE e.subject_id = s.id AND e.status = 'active') >= $1
            AND (s.summary_at IS NULL OR EXISTS (
                  SELECT 1 FROM memory_entries e WHERE e.subject_id = s.id AND e.updated_at > s.summary_at))
          ORDER BY s.summary_at NULLS FIRST LIMIT $2`,
        [SUMMARY_MIN_ENTRIES, CONSOLIDATE_BATCH],
      )) as { id: string }[];
      let done = 0;
      for (const row of rows) {
        try {
          await this.consolidate(row.id);
          done += 1;
        } catch (error) {
          this.logger.warn(`Ringkasan profil ${row.id} gagal: ${(error as Error).message}`);
        }
      }
      if (done > 0) this.logger.log(`Ringkasan profil memori diperbarui untuk ${done} subjek.`);
      return done;
    } finally {
      this.running = false;
    }
  }

  private async subjectMeta(subjectId: string): Promise<SubjectMeta | null> {
    const rows = (await this.dataSource.query(
      `SELECT s.id, s.kind, s.owner_user_id, COALESCE(u.display_name, a.name) AS name, d.name AS department_name
         FROM memory_subjects s
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN agents a ON a.id = s.agent_id
        WHERE s.id = $1`,
      [subjectId],
    )) as SubjectMeta[];
    return rows[0] ?? null;
  }

  /**
   * Ringkasan profil satu subjek dari catatan aktifnya (termasuk pribadi). Karena itu ringkasan
   * hanya dipakai untuk pemilik buku sendiri dan tidak pernah dibaca lewat pintu.
   */
  async consolidate(subjectId: string): Promise<MemoryProfileSummaryDto | null> {
    const subject = await this.subjectMeta(subjectId);
    if (!subject) throw new AppError(ERROR_CODES.notFound, 'Buku memori tidak ditemukan.', 404);
    const entries = (await this.dataSource.query(
      `SELECT type, content, importance FROM memory_entries
        WHERE subject_id = $1 AND status = 'active'
        ORDER BY importance DESC, updated_at DESC LIMIT $2`,
      [subjectId, SUMMARY_SOURCE_ENTRIES],
    )) as { type: MemoryEntryType; content: string; importance: number }[];
    if (entries.length === 0) {
      await this.dataSource.query(
        `UPDATE memory_subjects SET summary = NULL, summary_at = now(), summary_entries = 0 WHERE id = $1`,
        [subjectId],
      );
      return null;
    }
    const { extractorModel } = await this.settings.get();
    const result = await this.gateway.chat({
      mode: 'subordinate',
      systemPrompt: CONSOLIDATION_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `Subjek: ${subject.name} (${subject.kind === 'agent' ? 'agent digital' : 'pengguna'}).\n\nCatatan:\n` +
            entries.map((e) => `- (${e.type}, penting ${e.importance}) ${e.content}`).join('\n'),
        },
      ],
      guard: { userId: subject.owner_user_id },
      usageSource: 'memory',
      ...(extractorModel ? { model: extractorModel } : {}),
    });
    const content = redactForMemory(cleanSummary(result.content)).slice(0, SUMMARY_MAX_CHARS);
    if (!content) return null;
    const row = updatedRows<{ summary: string; summary_at: string; summary_entries: number }>(
      await this.dataSource.query(
        `UPDATE memory_subjects SET summary = $2, summary_at = now(), summary_entries = $3
          WHERE id = $1 RETURNING summary, summary_at, summary_entries`,
        [subjectId, content, entries.length],
      ),
    )[0];
    return row ? { content: row.summary, generatedAt: row.summary_at, entryCount: row.summary_entries } : null;
  }

  // ───────────────────────── Bahan dari pintu (atasan) ─────────────────────────

  /** Catatan yang boleh dibaca atasan lewat pintu: shareable, jenis dibuka, sudah ditinjau. */
  private async doorEntries(
    subjectId: string,
    limit: number,
    days?: number,
  ): Promise<{ id: string; type: MemoryEntryType; content: string }[]> {
    const params: unknown[] = [subjectId, limit];
    let since = '';
    if (days) {
      params.push(days);
      since = ' AND e.updated_at > now() - make_interval(days => $3)';
    }
    return (await this.dataSource.query(
      `SELECT e.id, e.type, e.content FROM memory_entries e
         JOIN memory_doors md ON md.subject_id = e.subject_id AND md.enabled
        WHERE e.subject_id = $1 AND e.status = 'active' AND e.sensitivity = 'shareable'
          AND NOT e.needs_review AND e.type = ANY(md.exposed_types)${since}
        ORDER BY e.importance DESC, e.updated_at DESC LIMIT $2`,
      params,
    )) as { id: string; type: MemoryEntryType; content: string }[];
  }

  private async logRead(
    actorUserId: string,
    subjectId: string,
    action: 'digest_read' | 'themes_read',
    entryIds: string[],
  ): Promise<void> {
    if (entryIds.length === 0) return;
    await this.dataSource.query(
      `INSERT INTO memory_access_log (subject_id, actor_user_id, action, context_kind, context_id, entry_count)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [subjectId, actorUserId, action, action === 'digest_read' ? 'digest' : 'mind_map', entryIds.length],
    );
  }

  // ───────────────────────── Ringkasan tim ─────────────────────────

  async digest(auth: AuthContext, subjectIds: string[], days: MemoryDigestPeriod): Promise<MemoryDigestDto> {
    const wanted = await this.memory.assertOpenable(auth, subjectIds);
    if (wanted.length === 0) {
      throw new AppError(ERROR_CODES.validation, 'Pilih setidaknya satu pintu memori.', 400);
    }
    const reach = new Map((await this.scope.reach(auth.user.id)).map((s) => [s.subjectId, s]));
    const subjects: MemoryDigestDto['subjects'] = [];
    const refs: MemoryRefDto[] = [];
    const sections: string[] = [];
    for (const subjectId of wanted) {
      const name = reach.get(subjectId)?.name ?? 'Anggota';
      const entries = await this.doorEntries(subjectId, DIGEST_ENTRIES_PER_SUBJECT, days);
      subjects.push({ subjectId, name, entries: entries.length });
      if (entries.length === 0) continue;
      const lines = entries.map((entry) => {
        const ref = `m${refs.length + 1}`;
        refs.push({ ref, entryId: entry.id, subjectName: name, own: false, type: entry.type, content: entry.content });
        return `- [${ref}] (${entry.type}) ${entry.content}`;
      });
      sections.push(`### ${name}\n${lines.join('\n')}`);
      await this.logRead(auth.user.id, subjectId, 'digest_read', entries.map((e) => e.id));
    }
    const generatedAt = new Date().toISOString();
    if (refs.length === 0) {
      return {
        content: `Belum ada catatan yang dapat dibagikan dalam ${days} hari terakhir dari anggota yang dipilih.`,
        refs,
        days,
        subjects,
        generatedAt,
      };
    }
    const { extractorModel } = await this.settings.get();
    const result = await this.gateway.chat({
      mode: 'subordinate',
      systemPrompt: DIGEST_PROMPT,
      messages: [{ role: 'user', content: `Periode: ${days} hari terakhir.\n\n${sections.join('\n\n')}` }],
      guard: { userId: auth.user.id },
      usageSource: 'memory',
      ...(extractorModel ? { model: extractorModel } : {}),
    });
    await this.dataSource.query(
      `UPDATE memory_entries SET use_count = use_count + 1, last_used_at = now() WHERE id = ANY($1::uuid[])`,
      [refs.map((r) => r.entryId)],
    );
    await this.audit.record({
      eventKey: AUDIT_EVENTS.memoryDigestGenerated,
      severity: 'info',
      summary: `Menyusun ringkasan tim dari ${subjects.length} pintu memori`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'memory_digest',
      entityId: null,
      payload: { subjectIds: wanted, days, entries: refs.length },
    });
    // Kode rujukan internal ([m1] (decision)) tidak untuk dibaca pengguna; model kecil kadang menyalinnya.
    const content = result.content.replace(/\s*\[m\d+\](\s*\([a-z]+\))?/g, '').trim();
    return { content, refs, days, subjects, generatedAt };
  }

  // ───────────────────────── Tema memori (Peta Pikiran) ─────────────────────────

  /**
   * Tema per subjek: buku sendiri (semua catatan aktif) dan subjek dalam jangkauan yang pintunya
   * diizinkan (bahan pintu saja). Yang dikembalikan hanya kata kunci dan jumlah, bukan isi catatan.
   */
  async themes(auth: AuthContext): Promise<MemoryThemeSubjectDto[]> {
    const selfId = await this.scope.ensureUserSubject(auth.user.id);
    const result: MemoryThemeSubjectDto[] = [];
    const self = await this.subjectMeta(selfId);
    const ownEntries = (await this.dataSource.query(
      `SELECT id, type, content FROM memory_entries
        WHERE subject_id = $1 AND status = 'active' ORDER BY importance DESC, updated_at DESC LIMIT $2`,
      [selfId, THEME_ENTRIES_PER_SUBJECT],
    )) as { id: string; type: MemoryEntryType; content: string }[];
    if (self) result.push(themeOf(self, true, ownEntries));

    for (const subject of await this.scope.reach(auth.user.id)) {
      if (!subject.granted) continue;
      const entries = await this.doorEntries(subject.subjectId, THEME_ENTRIES_PER_SUBJECT);
      if (entries.length === 0) continue;
      await this.logRead(auth.user.id, subject.subjectId, 'themes_read', entries.map((e) => e.id));
      result.push(
        themeOf(
          {
            id: subject.subjectId,
            kind: subject.kind,
            name: subject.name,
            department_name: subject.departmentName,
          },
          false,
          entries,
        ),
      );
    }
    return result;
  }
}

/**
 * Buang awalan yang sering ditulis model kecil ("Subjek: …", "Ringkasan profil:", judul Markdown)
 * sehingga yang tersimpan hanya paragraf ringkasannya.
 */
export function cleanSummary(raw: string): string {
  const lines = raw.replace(/\r/g, '').split('\n');
  while (lines.length > 0) {
    const line = lines[0]!.trim();
    if (!line || /^#{1,6}\s/.test(line) || /^subjek\s*:/i.test(line)) {
      lines.shift();
      continue;
    }
    const rest = line.replace(/^\**ringkasan(\s+profil)?\**\s*:\s*/i, '');
    if (!rest) {
      lines.shift();
      continue;
    }
    lines[0] = rest;
    break;
  }
  return lines.join('\n').replace(/\*\*/g, '').trim();
}

/** Hitung jenis catatan dan kata kunci terbanyak (per catatan, bukan per kemunculan). */
export function themeOf(
  subject: Pick<SubjectMeta, 'id' | 'kind' | 'name' | 'department_name'>,
  own: boolean,
  entries: { type: MemoryEntryType; content: string }[],
): MemoryThemeSubjectDto {
  const counts: Partial<Record<MemoryEntryType, number>> = {};
  const terms = new Map<string, number>();
  const nameWords = new Set(memoryKeywords(subject.name));
  for (const entry of entries) {
    counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    for (const word of new Set(memoryKeywords(entry.content))) {
      if (word.length < 4 || nameWords.has(word) || THEME_STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
      terms.set(word, (terms.get(word) ?? 0) + 1);
    }
  }
  const themes = [...terms.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, THEMES_PER_SUBJECT)
    .map(([term, weight]) => ({ term, weight }));
  return {
    subjectId: subject.id,
    kind: subject.kind,
    name: subject.name,
    departmentName: subject.department_name,
    own,
    total: entries.length,
    counts,
    themes,
  };
}
