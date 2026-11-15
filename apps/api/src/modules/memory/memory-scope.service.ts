import { Inject, Injectable } from '@nestjs/common';
import type { MemoryContextKind, MemoryEntryType, MemoryReachSubjectDto } from '@bara/shared';
import { DataSource, type EntityManager } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';

type Queryable = Pick<DataSource | EntityManager, 'query'>;

export interface MemoryContextRef {
  kind: MemoryContextKind;
  id: string;
}

/** Subjek yang boleh dibaca oleh satu pengambilan memori. */
export interface ScopeSubject {
  subjectId: string;
  name: string;
  /** Milik penanya (buku sendiri atau agent miliknya yang sedang bekerja): semua catatan aktif. */
  own: boolean;
  /** Untuk subjek lain: hanya jenis yang dibuka pintunya dan sensitivitas `shareable`. */
  exposedTypes: MemoryEntryType[];
  /** Agent yang sedang bekerja: profil hasil migrasi `agents.memory` sudah ada di system prompt. */
  skipAgentProfile?: boolean;
}

/** Jangkauan atasan: subtree departemen yang ia kepalai + agent pribadinya sendiri. */
const REACH_SQL = `
  WITH RECURSIVE led AS (
    SELECT id FROM departments WHERE head_user_id = $1 AND is_active
    UNION
    SELECT d.id FROM departments d JOIN led ON d.parent_id = led.id WHERE d.is_active
  )
  SELECT 'user'::text AS kind, u.id AS ref_id
    FROM users u
   WHERE u.status = 'active' AND u.id <> $1
     AND (u.department_id IN (SELECT id FROM led)
          OR u.id IN (SELECT head_user_id FROM departments WHERE id IN (SELECT id FROM led)))
  UNION
  SELECT 'agent'::text, a.id
    FROM agents a
   WHERE a.owner_user_id = $1 AND a.status = 'active' AND NOT a.is_template`;

/**
 * Satu-satunya tempat cakupan memori ditentukan. Dihitung ulang setiap kueri, sehingga
 * pencabutan izin, perubahan kepala departemen, atau pengguna nonaktif langsung berlaku.
 */
@Injectable()
export class MemoryScopeService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async ensureUserSubject(userId: string, db: Queryable = this.dataSource): Promise<string> {
    await db.query(
      `INSERT INTO memory_subjects (kind, user_id, owner_user_id) VALUES ('user', $1, $1)
       ON CONFLICT DO NOTHING`,
      [userId],
    );
    const rows = (await db.query(`SELECT id FROM memory_subjects WHERE user_id = $1`, [userId])) as {
      id: string;
    }[];
    return rows[0]!.id;
  }

  /** Subjek agent (bukan templat); pintu agent bawaan terbuka untuk pemiliknya. */
  async ensureAgentSubject(agentId: string, db: Queryable = this.dataSource): Promise<string | null> {
    await db.query(
      `INSERT INTO memory_subjects (kind, agent_id, owner_user_id)
       SELECT 'agent', a.id, a.owner_user_id FROM agents a
        WHERE a.id = $1 AND a.owner_user_id IS NOT NULL AND NOT a.is_template
       ON CONFLICT DO NOTHING`,
      [agentId],
    );
    const rows = (await db.query(`SELECT id, owner_user_id FROM memory_subjects WHERE agent_id = $1`, [
      agentId,
    ])) as { id: string; owner_user_id: string }[];
    const subject = rows[0];
    if (!subject) return null;
    await db.query(
      `INSERT INTO memory_doors (subject_id, enabled, updated_by) VALUES ($1, true, $2)
       ON CONFLICT DO NOTHING`,
      [subject.id, subject.owner_user_id],
    );
    return subject.id;
  }

  /** Subjek dalam jangkauan beserta status izin pintunya (tanpa isi memori). */
  async reach(leaderUserId: string): Promise<MemoryReachSubjectDto[]> {
    const refs = (await this.dataSource.query(REACH_SQL, [leaderUserId])) as {
      kind: 'user' | 'agent';
      ref_id: string;
    }[];
    if (refs.length === 0) return [];
    const userIds = refs.filter((r) => r.kind === 'user').map((r) => r.ref_id);
    const agentIds = refs.filter((r) => r.kind === 'agent').map((r) => r.ref_id);
    await this.dataSource.query(
      `INSERT INTO memory_subjects (kind, user_id, owner_user_id)
       SELECT 'user', id, id FROM unnest($1::uuid[]) AS id
       ON CONFLICT DO NOTHING`,
      [userIds],
    );
    for (const agentId of agentIds) await this.ensureAgentSubject(agentId);

    const rows = (await this.dataSource.query(
      `SELECT s.id AS subject_id, s.kind, COALESCE(s.user_id, s.agent_id) AS ref_id,
              COALESCE(u.display_name, a.name) AS name,
              CASE WHEN s.kind = 'user' THEN u.job_title ELSE a.description END AS caption,
              d.name AS department_name,
              COALESCE(md.enabled, false) AS granted,
              (SELECT count(*)::int FROM memory_entries e
                WHERE e.subject_id = s.id AND e.status = 'active' AND e.sensitivity = 'shareable'
                  AND md.enabled
                  AND e.type = ANY(md.exposed_types)) AS visible_entries
         FROM memory_subjects s
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN agents a ON a.id = s.agent_id
         LEFT JOIN memory_doors md ON md.subject_id = s.id
        WHERE s.user_id = ANY($1::uuid[]) OR s.agent_id = ANY($2::uuid[])
        ORDER BY s.kind DESC, name`,
      [userIds, agentIds],
    )) as {
      subject_id: string;
      kind: 'user' | 'agent';
      ref_id: string;
      name: string;
      caption: string | null;
      department_name: string | null;
      granted: boolean;
      visible_entries: number;
    }[];
    return rows.map((r) => ({
      subjectId: r.subject_id,
      kind: r.kind,
      refId: r.ref_id,
      name: r.name,
      caption: r.caption,
      departmentName: r.department_name,
      granted: r.granted,
      visibleEntries: r.visible_entries,
    }));
  }

  /** Subjek yang dapat dibuka sekarang (dalam jangkauan dan pintunya diizinkan). */
  async openableIds(leaderUserId: string): Promise<Set<string>> {
    const reach = await this.reach(leaderUserId);
    return new Set(reach.filter((s) => s.granted).map((s) => s.subjectId));
  }

  /**
   * Cakupan satu pengambilan: buku sendiri ∪ (pintu terbuka ∩ jangkauan ∩ diizinkan).
   * `canOpenDoors` = izin `ai.memory.doors.open`; tanpa itu pintu yang tercatat diabaikan.
   * `agentId`: agent yang sedang bekerja ikut mengingat bukunya sendiri.
   */
  async resolve(
    userId: string,
    context: MemoryContextRef | null,
    options: { canOpenDoors: boolean; agentId?: string | null },
  ): Promise<ScopeSubject[]> {
    const selfId = await this.ensureUserSubject(userId);
    const selfName = ((await this.dataSource.query(`SELECT display_name FROM users WHERE id = $1`, [
      userId,
    ])) as { display_name: string }[])[0]?.display_name;
    const scope: ScopeSubject[] = [{ subjectId: selfId, name: selfName ?? 'Anda', own: true, exposedTypes: [] }];

    if (options.agentId) {
      const agentSubject = await this.ensureAgentSubject(options.agentId);
      const owned = (await this.dataSource.query(
        `SELECT a.name FROM agents a WHERE a.id = $1 AND a.owner_user_id = $2`,
        [options.agentId, userId],
      )) as { name: string }[];
      if (agentSubject && owned[0]) {
        scope.push({
          subjectId: agentSubject,
          name: owned[0].name,
          own: true,
          exposedTypes: [],
          skipAgentProfile: true,
        });
      }
    }

    if (!context || !options.canOpenDoors) return scope;
    const table = context.kind === 'conversation' ? 'conversation_memory_doors' : 'task_memory_doors';
    const column = context.kind === 'conversation' ? 'conversation_id' : 'task_id';
    const opened = (await this.dataSource.query(
      `SELECT subject_id FROM ${table} WHERE ${column} = $1`,
      [context.id],
    )) as { subject_id: string }[];
    if (opened.length === 0) return scope;

    const reach = new Map((await this.reach(userId)).map((s) => [s.subjectId, s]));
    const already = new Set(scope.map((s) => s.subjectId));
    const doors = (await this.dataSource.query(
      `SELECT subject_id, exposed_types FROM memory_doors
        WHERE subject_id = ANY($1::uuid[]) AND enabled`,
      [opened.map((o) => o.subject_id)],
    )) as { subject_id: string; exposed_types: MemoryEntryType[] | string }[];
    for (const door of doors) {
      const subject = reach.get(door.subject_id);
      if (!subject || already.has(door.subject_id)) continue;
      scope.push({
        subjectId: door.subject_id,
        name: subject.name,
        own: false,
        exposedTypes: parsePgArray(door.exposed_types),
      });
    }
    return scope;
  }
}

/** node-postgres mengembalikan array enum sebagai string `{a,b}`. */
export function parsePgArray(value: MemoryEntryType[] | string): MemoryEntryType[] {
  if (Array.isArray(value)) return value;
  const inner = value.replace(/^\{|\}$/g, '');
  return (inner ? inner.split(',') : []) as MemoryEntryType[];
}
