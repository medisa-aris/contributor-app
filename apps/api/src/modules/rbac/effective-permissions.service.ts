import { Inject, Injectable } from '@nestjs/common';
import type { DataScope } from '@contributor/shared';
import { ALL_PERMISSION_IDS } from '@contributor/shared';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuthzCacheService } from './authz-cache.service';
import {
  evaluateAll,
  evaluatePermission,
  type EffectiveDecision,
  type PolicyAssignment,
  type PolicyInput,
  type ResourceContext,
} from './policy-engine';

export interface ResolvedAccess {
  userId: string;
  version: number;
  isSuperadmin: boolean;
  input: PolicyInput;
  decisions: Map<string, EffectiveDecision>;
  loadedAt: number;
}

interface RbacMetaRow {
  version: number;
}

interface UserCoreRow {
  id: string;
  is_superadmin: boolean;
  status: string;
  department_id: string | null;
}

interface AssignmentRow {
  role_id: string;
  role_code: string;
  role_name: string;
  data_scope: DataScope;
  department_id: string | null;
  source: 'user' | 'group';
  source_id: string;
}

interface RolePermissionRow {
  role_id: string;
  identifier: string;
}

interface PolicyRow {
  id: string;
  name: string;
  effect: 'allow' | 'deny';
  subject_type: 'user' | 'group' | 'role';
  subject_id: string;
  permission_pattern: string;
  resource_type: string | null;
  resource_id: string | null;
  priority: number;
  conditions: Record<string, unknown> | null;
}

export type ScopeMode = 'all' | 'departments' | 'own' | 'none';

export interface EffectiveScope {
  mode: ScopeMode;
  departmentIds: string[];
}

@Injectable()
export class EffectivePermissionsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly cache: AuthzCacheService,
  ) {}

  async currentVersion(): Promise<number> {
    const cached = this.cache.getCachedVersion();
    if (cached !== null) return cached;
    const rows = (await this.dataSource.query(
      'SELECT version FROM rbac_meta WHERE id = 1',
    )) as RbacMetaRow[];
    const version = rows[0]?.version ?? 1;
    this.cache.setVersion(version);
    return version;
  }

  /** Dipanggil setiap kali data RBAC berubah; versi baru langsung membatalkan cache. */
  async bumpVersion(): Promise<number> {
    const rows = updatedRows<RbacMetaRow>(
      await this.dataSource.query(
        'UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1 RETURNING version',
      ),
    );
    const version = rows[0]?.version ?? 1;
    this.cache.invalidateAll();
    this.cache.setVersion(version);
    return version;
  }

  async resolve(userId: string): Promise<ResolvedAccess> {
    const version = await this.currentVersion();
    const cacheKey = `access:${userId}`;
    const cached = this.cache.get<{ version: number; access: ResolvedAccess }>(cacheKey);
    if (cached && cached.version === version) return cached.access;

    const access = await this.loadAccess(userId, version);
    this.cache.set(cacheKey, { version, access });
    return access;
  }

  async can(
    userId: string,
    permission: string,
    ctx: ResourceContext = {},
  ): Promise<EffectiveDecision> {
    const access = await this.resolve(userId);
    return evaluatePermission(access.input, permission, ctx);
  }

  private async loadAccess(userId: string, version: number): Promise<ResolvedAccess> {
    const users = (await this.dataSource.query(
      'SELECT id, is_superadmin, status, department_id FROM users WHERE id = $1',
      [userId],
    )) as UserCoreRow[];
    const user = users[0];

    if (!user) {
      const emptyInput: PolicyInput = {
        userId,
        groupIds: [],
        isSuperadmin: false,
        assignments: [],
        rolePermissions: new Map(),
        policies: [],
      };
      return {
        userId,
        version,
        isSuperadmin: false,
        input: emptyInput,
        decisions: evaluateAll(emptyInput, ALL_PERMISSION_IDS),
        loadedAt: Date.now(),
      };
    }

    const groupRows = (await this.dataSource.query(
      'SELECT group_id FROM user_groups WHERE user_id = $1',
      [userId],
    )) as { group_id: string }[];
    const groupIds = groupRows.map((r) => r.group_id);

    const assignments = (await this.dataSource.query(
      `SELECT ur.role_id, r.code AS role_code, r.name AS role_name, ur.data_scope,
              ur.department_id, 'user' AS source, ur.user_id AS source_id
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
        UNION ALL
       SELECT gr.role_id, r.code AS role_code, r.name AS role_name, gr.data_scope,
              gr.department_id, 'group' AS source, gr.group_id AS source_id
         FROM group_roles gr
         JOIN roles r ON r.id = gr.role_id
        WHERE gr.group_id = ANY($2::uuid[])`,
      [userId, groupIds],
    )) as AssignmentRow[];

    const roleIds = [...new Set(assignments.map((a) => a.role_id))];
    const rolePermissions = new Map<string, string[]>();
    if (roleIds.length > 0) {
      const rows = (await this.dataSource.query(
        `SELECT rp.role_id, p.identifier
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = ANY($1::uuid[])`,
        [roleIds],
      )) as RolePermissionRow[];
      for (const row of rows) {
        const list = rolePermissions.get(row.role_id) ?? [];
        list.push(row.identifier);
        rolePermissions.set(row.role_id, list);
      }
    }

    const policyRows = (await this.dataSource.query(
      `SELECT id, name, effect, subject_type, subject_id, permission_pattern,
              resource_type, resource_id, priority, conditions
         FROM resource_policies
        WHERE is_active = true
          AND (
            (subject_type = 'user' AND subject_id = $1)
            OR (subject_type = 'group' AND subject_id = ANY($2::uuid[]))
            OR (subject_type = 'role' AND subject_id = ANY($3::uuid[]))
          )`,
      [userId, groupIds, roleIds],
    )) as PolicyRow[];

    const input: PolicyInput = {
      userId,
      groupIds,
      isSuperadmin: user.is_superadmin,
      assignments: assignments.map(
        (a): PolicyAssignment => ({
          source: a.source,
          sourceId: a.source_id,
          roleId: a.role_id,
          roleCode: a.role_code,
          roleName: a.role_name,
          dataScope: a.data_scope,
          departmentId: a.department_id,
        }),
      ),
      rolePermissions,
      policies: policyRows.map((p) => ({
        id: p.id,
        name: p.name,
        effect: p.effect,
        subjectType: p.subject_type,
        subjectId: p.subject_id,
        permissionPattern: p.permission_pattern,
        resourceType: p.resource_type,
        resourceId: p.resource_id,
        priority: p.priority,
        conditions: p.conditions ?? {},
      })),
    };

    return {
      userId,
      version,
      isSuperadmin: user.is_superadmin,
      input,
      decisions: evaluateAll(input, ALL_PERMISSION_IDS),
      loadedAt: Date.now(),
    };
  }

  async departmentSubtree(departmentId: string): Promise<string[]> {
    const rows = (await this.dataSource.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM departments WHERE id = $1
         UNION ALL
         SELECT d.id FROM departments d JOIN sub s ON d.parent_id = s.id
       )
       SELECT id FROM sub`,
      [departmentId],
    )) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /** Scope data efektif untuk sebuah izin (union subtree untuk scope department). */
  async effectiveScope(userId: string, permission: string): Promise<EffectiveScope> {
    const access = await this.resolve(userId);
    const decision =
      access.decisions.get(permission) ?? evaluatePermission(access.input, permission);
    if (access.isSuperadmin || decision.reason === 'superadmin') {
      return { mode: 'all', departmentIds: [] };
    }
    if (!decision.allowed) return { mode: 'none', departmentIds: [] };

    const granting = access.input.assignments.filter((a) =>
      (access.input.rolePermissions.get(a.roleId) ?? []).includes(permission),
    );
    if (granting.some((a) => a.dataScope === 'global')) {
      return { mode: 'all', departmentIds: [] };
    }
    if (granting.some((a) => a.dataScope === 'department')) {
      const ids = new Set<string>();
      for (const a of granting) {
        if (a.dataScope === 'department' && a.departmentId) {
          for (const id of await this.departmentSubtree(a.departmentId)) ids.add(id);
        }
      }
      return { mode: 'departments', departmentIds: [...ids] };
    }
    return { mode: 'own', departmentIds: [] };
  }
}
