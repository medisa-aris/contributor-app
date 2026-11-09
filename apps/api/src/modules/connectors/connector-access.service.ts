import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';

export type ConnectorType = 'database' | 'mcp';
export type ConnectorAccessLevel = 'read' | 'read_write';

export interface EffectiveGrant {
  connectorType: ConnectorType;
  connectorId: string;
  access: ConnectorAccessLevel;
  /** null = semua tabel; selain itu daftar tabel yang diizinkan (gabungan semua grant). */
  tableAllowlist: string[] | null;
}

interface GrantRow {
  connector_type: ConnectorType;
  connector_id: string;
  access: ConnectorAccessLevel;
  table_allowlist: string[] | null;
}

/** Peringkat level akses; nilai lebih tinggi menang saat beberapa grant berlaku. */
export const ACCESS_RANK: Record<ConnectorAccessLevel, number> = { read: 1, read_write: 2 };

/** Gabungkan grant mentah per konektor: akses tertinggi menang, allowlist digabung. */
export function mergeGrants(rows: GrantRow[]): EffectiveGrant[] {
  const merged = new Map<string, EffectiveGrant>();
  for (const row of rows) {
    const key = `${row.connector_type}:${row.connector_id}`;
    const current = merged.get(key);
    const allowlist =
      Array.isArray(row.table_allowlist) && row.table_allowlist.length > 0
        ? row.table_allowlist
        : null;
    if (!current) {
      merged.set(key, {
        connectorType: row.connector_type,
        connectorId: row.connector_id,
        access: row.access,
        tableAllowlist: allowlist ? [...allowlist] : null,
      });
      continue;
    }
    if (ACCESS_RANK[row.access] > ACCESS_RANK[current.access]) current.access = row.access;
    // Satu grant tanpa allowlist berarti semua tabel diizinkan.
    if (current.tableAllowlist === null || allowlist === null) {
      current.tableAllowlist = null;
    } else {
      current.tableAllowlist = [...new Set([...current.tableAllowlist, ...allowlist])];
    }
  }
  return [...merged.values()];
}

/** Batasi akses yang diminta (agent/percakapan) agar tidak melebihi grant. */
export function capAccess(
  requested: ConnectorAccessLevel,
  granted: ConnectorAccessLevel,
): ConnectorAccessLevel {
  return ACCESS_RANK[requested] <= ACCESS_RANK[granted] ? requested : granted;
}

/**
 * Resolusi grant konektor untuk seorang user. Grant berlaku bila subjeknya:
 * user itu sendiri, salah satu perannya (langsung atau lewat grup), grupnya, atau
 * departemennya maupun departemen induknya (grant departemen mencakup seluruh subtree).
 * Superadmin tidak mendapat akses otomatis: konektor data tetap butuh grant eksplisit.
 */
@Injectable()
export class ConnectorAccessService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async effectiveGrants(userId: string): Promise<EffectiveGrant[]> {
    const rows = (await this.dataSource.query(
      `WITH RECURSIVE dept_chain AS (
         SELECT d.id, d.parent_id
           FROM departments d JOIN users u ON u.department_id = d.id
          WHERE u.id = $1
         UNION ALL
         SELECT d.id, d.parent_id FROM departments d JOIN dept_chain c ON d.id = c.parent_id
       ),
       my_roles AS (
         SELECT role_id FROM user_roles WHERE user_id = $1
         UNION
         SELECT gr.role_id FROM user_groups ug JOIN group_roles gr ON gr.group_id = ug.group_id
          WHERE ug.user_id = $1
       ),
       my_groups AS (SELECT group_id FROM user_groups WHERE user_id = $1)
       SELECT g.connector_type, g.connector_id, g.access, g.table_allowlist
         FROM connector_grants g
        WHERE (g.subject_type = 'user' AND g.subject_id = $1)
           OR (g.subject_type = 'role' AND g.subject_id IN (SELECT role_id FROM my_roles))
           OR (g.subject_type = 'group' AND g.subject_id IN (SELECT group_id FROM my_groups))
           OR (g.subject_type = 'department' AND g.subject_id IN (SELECT id FROM dept_chain))`,
      [userId],
    )) as GrantRow[];
    return mergeGrants(rows);
  }

  async grantFor(
    userId: string,
    type: ConnectorType,
    connectorId: string,
  ): Promise<EffectiveGrant | null> {
    const grants = await this.effectiveGrants(userId);
    return grants.find((g) => g.connectorType === type && g.connectorId === connectorId) ?? null;
  }
}
