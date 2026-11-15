import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';

export interface OrgReach {
  /** Departemen yang dikepalai beserta seluruh sub-departemennya. */
  departmentIds: string[];
  /** Anggota departemen tersebut dan kepala sub-departemennya, tanpa sang atasan. */
  userIds: string[];
  /** Agent pribadi aktif milik atasan, ditambah milik bawahan bila diminta. */
  agentIds: string[];
}

const LED_DEPARTMENTS = `
  WITH RECURSIVE led AS (
    SELECT id FROM departments WHERE head_user_id = $1 AND is_active
    UNION
    SELECT d.id FROM departments d JOIN led ON d.parent_id = led.id WHERE d.is_active
  )`;

/**
 * Satu definisi "atasan": kepala departemen (`departments.head_user_id`) menjangkau subtree
 * departemennya. Dipakai bersama oleh memori terpusat dan izin model; dihitung ulang tiap
 * permintaan sehingga pergantian kepala atau perpindahan anggota langsung berlaku.
 */
@Injectable()
export class OrgReachService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async reach(
    leaderUserId: string,
    options: { includeSubordinateAgents?: boolean } = {},
  ): Promise<OrgReach> {
    const departments = (await this.dataSource.query(`${LED_DEPARTMENTS} SELECT id FROM led`, [
      leaderUserId,
    ])) as { id: string }[];
    const departmentIds = departments.map((d) => d.id);
    const users = (await this.dataSource.query(
      `SELECT u.id FROM users u
        WHERE u.status = 'active' AND u.id <> $1
          AND (u.department_id = ANY($2::uuid[])
               OR u.id IN (SELECT head_user_id FROM departments WHERE id = ANY($2::uuid[])))`,
      [leaderUserId, departmentIds],
    )) as { id: string }[];
    const userIds = users.map((u) => u.id);
    const owners = options.includeSubordinateAgents ? [leaderUserId, ...userIds] : [leaderUserId];
    const agents = (await this.dataSource.query(
      `SELECT id FROM agents
        WHERE owner_user_id = ANY($1::uuid[]) AND status = 'active' AND NOT is_template`,
      [owners],
    )) as { id: string }[];
    return { departmentIds, userIds, agentIds: agents.map((a) => a.id) };
  }

  /** true bila pengguna mengepalai setidaknya satu departemen aktif. */
  async isHead(userId: string): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM departments WHERE head_user_id = $1 AND is_active LIMIT 1`,
      [userId],
    )) as unknown[];
    return rows.length > 0;
  }
}
