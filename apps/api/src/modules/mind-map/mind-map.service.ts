import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS, PERMISSIONS } from '@bara/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { scopeClause } from '../admin/common/data-scope';
import {
  EffectivePermissionsService,
  type EffectiveScope,
} from '../rbac/effective-permissions.service';
import { MIND_MAP_MODES, type MindMapMode, type MindMapQueryDto } from './dto/mind-map.dto';

/** Judul bawaan percakapan yang belum berisi pikiran apa pun. */
const DEFAULT_CONVERSATION_TITLE = 'Percakapan baru';
const PERSON_THOUGHT_LIMIT = 200;
const TOPIC_HIT_LIMIT = 300;
const TOPIC_PERSON_PREVIEW = 8;
const KEYWORD_LIMIT = 15;

const STOPWORDS = new Set(
  (
    'yang dan di ke dari untuk dengan pada ini itu atau adalah akan dalam oleh sebagai juga ' +
    'bagi agar saya kami kita anda apa bagaimana cara buat membuat tentang tolong bantu ' +
    'the and for with from that this what how about into your are can use using'
  ).split(' '),
);

interface PersonRow {
  id: string;
  display_name: string;
  job_title: string | null;
  department_id: string | null;
  department_name: string | null;
}

export interface ThoughtItem {
  id: string;
  mode: MindMapMode;
  title: string;
  status: string | null;
  at: string;
}

@Injectable()
export class MindMapService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly effective: EffectivePermissionsService,
    private readonly audit: AuditService,
  ) {}

  /** Pohon departemen dalam cakupan + anggota dengan jumlah pikiran per mode. */
  async org(auth: AuthContext, query: MindMapQueryDto) {
    const scope = await this.effective.effectiveScope(auth.user.id, PERMISSIONS.mindMapTeamRead);
    const deptParams: unknown[] = [];
    const deptWhere =
      scope.mode === 'all'
        ? 'true'
        : scope.mode === 'departments'
          ? (deptParams.push(scope.departmentIds), `d.id = ANY($1::uuid[])`)
          : 'false';
    const departments = (await this.dataSource.query(
      `SELECT d.id, d.name, d.code, d.parent_id AS "parentId"
         FROM departments d WHERE ${deptWhere} ORDER BY d.name`,
      deptParams,
    )) as { id: string; name: string; code: string; parentId: string | null }[];

    const params: unknown[] = [];
    const people = await this.peopleWithCounts(auth, scope, query, params);
    return { departments, people };
  }

  /** Daftar judul pikiran seorang anggota tim (diaudit). */
  async personThoughts(auth: AuthContext, userId: string, query: MindMapQueryDto) {
    const scope = await this.effective.effectiveScope(auth.user.id, PERMISSIONS.mindMapTeamRead);
    const params: unknown[] = [userId];
    const clause = scopeClause({ ...scope, userId: auth.user.id }, 'u.department_id', params);
    const persons = (await this.dataSource.query(
      `SELECT u.id, u.display_name, u.job_title, u.department_id, d.name AS department_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = $1 AND u.status = 'active'${clause ? ` AND ${clause}` : ''}`,
      params,
    )) as PersonRow[];
    const person = persons[0];
    if (!person || (person.id === auth.user.id && !query.includeSelf)) {
      throw new AppError(ERROR_CODES.notFound, 'Anggota tim tidak ditemukan.', 404);
    }

    const { cte, values } = this.thoughtsCte(query, [userId]);
    const thoughts = (await this.dataSource.query(
      `${cte} SELECT id, mode, title, status, at FROM thoughts
        WHERE user_id = $1 ORDER BY at DESC LIMIT ${PERSON_THOUGHT_LIMIT}`,
      values,
    )) as ThoughtItem[];

    await this.record(auth, `Melihat Peta Pikiran ${person.display_name}`, person.id, {
      view: 'person',
      days: query.days,
      count: thoughts.length,
    });
    return {
      person: {
        id: person.id,
        displayName: person.display_name,
        jobTitle: person.job_title,
        departmentName: person.department_name,
      },
      thoughts,
    };
  }

  /** Cari judul pikiran di seluruh tim: siapa yang sedang memikirkan topik ini. */
  async topics(auth: AuthContext, query: MindMapQueryDto & { q?: string }) {
    const scope = await this.effective.effectiveScope(auth.user.id, PERMISSIONS.mindMapTeamRead);
    const q = (query.q ?? '').trim();
    const params: unknown[] = [];
    const people = await this.scopedPeople(auth, scope, query, params);
    const byId = new Map(people.map((p) => [p.id, p]));
    if (byId.size === 0) return { query: q, total: 0, people: [], keywords: [] };

    const { cte, values } = this.thoughtsCte(query, [[...byId.keys()]]);
    let where = 'user_id = ANY($1::uuid[])';
    if (q.length > 0) {
      values.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      where += ` AND title ILIKE $${values.length}`;
    }
    const rows = (await this.dataSource.query(
      `${cte} SELECT id, user_id, mode, title, status, at FROM thoughts
        WHERE ${where} ORDER BY at DESC LIMIT ${q.length > 0 ? TOPIC_HIT_LIMIT : 1000}`,
      values,
    )) as (ThoughtItem & { user_id: string })[];

    const keywords = this.keywords(
      rows.map((r) => r.title),
      q,
    );
    if (q.length === 0) return { query: q, total: rows.length, people: [], keywords };

    const grouped = new Map<string, (ThoughtItem & { user_id: string })[]>();
    for (const row of rows) {
      const list = grouped.get(row.user_id) ?? [];
      list.push(row);
      grouped.set(row.user_id, list);
    }
    const result = [...grouped.entries()]
      .map(([userId, items]) => {
        const p = byId.get(userId)!;
        return {
          id: p.id,
          displayName: p.display_name,
          jobTitle: p.job_title,
          departmentId: p.department_id,
          departmentName: p.department_name,
          count: items.length,
          thoughts: items.slice(0, TOPIC_PERSON_PREVIEW).map(({ user_id: _u, ...t }) => t),
        };
      })
      .sort((a, b) => b.count - a.count);

    await this.record(auth, `Mencari topik "${q.slice(0, 60)}" di Peta Pikiran`, null, {
      view: 'topics',
      q,
      days: query.days,
      hits: rows.length,
    });
    return { query: q, total: rows.length, people: result, keywords };
  }

  private async peopleWithCounts(
    auth: AuthContext,
    scope: EffectiveScope,
    query: MindMapQueryDto,
    params: unknown[],
  ) {
    const people = await this.scopedPeople(auth, scope, query, params);
    if (people.length === 0) return [];
    const { cte, values } = this.thoughtsCte(query, [people.map((p) => p.id)]);
    const counts = (await this.dataSource.query(
      `${cte} SELECT user_id, mode, count(*)::int AS n, max(at) AS last_at
         FROM thoughts WHERE user_id = ANY($1::uuid[]) GROUP BY user_id, mode`,
      values,
    )) as { user_id: string; mode: MindMapMode; n: number; last_at: string }[];

    return people.map((p) => {
      const mine = counts.filter((c) => c.user_id === p.id);
      const byMode = Object.fromEntries(MIND_MAP_MODES.map((m) => [m, 0])) as Record<
        MindMapMode,
        number
      >;
      for (const c of mine) byMode[c.mode] = c.n;
      const lastAt =
        mine
          .map((c) => c.last_at)
          .sort()
          .pop() ?? null;
      return {
        id: p.id,
        displayName: p.display_name,
        jobTitle: p.job_title,
        departmentId: p.department_id,
        counts: byMode,
        total: mine.reduce((sum, c) => sum + c.n, 0),
        lastAt,
      };
    });
  }

  /** Anggota aktif dalam cakupan pemanggil (pemanggil dikecualikan kecuali includeSelf). */
  private async scopedPeople(
    auth: AuthContext,
    scope: EffectiveScope,
    query: MindMapQueryDto,
    params: unknown[],
  ): Promise<PersonRow[]> {
    const clause = scopeClause({ ...scope, userId: auth.user.id }, 'u.department_id', params);
    const conditions = [`u.status = 'active'`];
    if (clause) conditions.push(clause);
    if (!query.includeSelf) {
      params.push(auth.user.id);
      conditions.push(`u.id <> $${params.length}::uuid`);
    }
    return (await this.dataSource.query(
      `SELECT u.id, u.display_name, u.job_title, u.department_id, d.name AS department_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE ${conditions.join(' AND ')} ORDER BY u.display_name`,
      params,
    )) as PersonRow[];
  }

  /**
   * CTE gabungan percakapan (Multi Brain / Partner) dan tugas (Subordinate).
   * `leading` adalah parameter $1.. yang sudah dipakai pemanggil; parameter filter ditambahkan setelahnya.
   */
  private thoughtsCte(query: MindMapQueryDto, leading: unknown[]) {
    const values: unknown[] = [...leading];
    values.push(new Date(Date.now() - query.days * 86_400_000).toISOString());
    const sinceIdx = values.length;
    values.push(query.modes && query.modes.length > 0 ? query.modes : [...MIND_MAP_MODES]);
    const modesIdx = values.length;
    values.push(DEFAULT_CONVERSATION_TITLE);
    const defaultIdx = values.length;
    const cte = `WITH raw AS (
      SELECT c.id, c.user_id, c.mode::text AS mode, c.title, NULL::text AS status, c.updated_at AS at
        FROM conversations c
       WHERE c.updated_at >= $${sinceIdx}::timestamptz AND c.title <> $${defaultIdx}
      UNION ALL
      SELECT t.id, t.user_id, 'subordinate' AS mode, t.title, t.status::text AS status, t.created_at AS at
        FROM ai_tasks t
       WHERE t.created_at >= $${sinceIdx}::timestamptz
    ), thoughts AS (SELECT * FROM raw WHERE mode = ANY($${modesIdx}::text[]))`;
    return { cte, values };
  }

  private keywords(titles: string[], query: string): { word: string; count: number }[] {
    const skip = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
    const counts = new Map<string, number>();
    for (const title of titles) {
      const seen = new Set<string>();
      for (const word of title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
        if (STOPWORDS.has(word) || skip.has(word) || seen.has(word)) continue;
        seen.add(word);
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, KEYWORD_LIMIT)
      .map(([word, count]) => ({ word, count }));
  }

  private async record(
    auth: AuthContext,
    summary: string,
    entityId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      eventKey: AUDIT_EVENTS.aiMindMapViewed,
      severity: 'info',
      summary,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'mind_map',
      entityId,
      payload,
    });
  }
}
