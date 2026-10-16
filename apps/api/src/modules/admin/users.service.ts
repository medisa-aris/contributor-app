import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS, type DataScope } from '@contributor/shared';
import { hash } from 'bcryptjs';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { EscalationService, checkLastSuperadmin } from '../rbac/escalation.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { SessionService } from '../auth/session.service';
import { parsePagination, paginated } from './common/pagination';
import { scopeClause, type ScopeFilter } from './common/data-scope';
import type { CreateUserDto, ResetPasswordDto, RoleAssignmentDto, UpdateUserDto } from './dto/users.dto';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  is_superadmin: boolean;
  status: string;
  department_id: string | null;
  department_name: string | null;
  last_login_at: Date | null;
  created_at: Date;
}

export interface UserDetail extends UserRow {
  assignments: {
    id: string;
    roleId: string;
    roleCode: string;
    roleName: string;
    dataScope: DataScope;
    departmentId: string | null;
    source: 'user' | 'group';
    groupName: string | null;
  }[];
  groups: { id: string; code: string; name: string }[];
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly effective: EffectivePermissionsService,
    private readonly escalation: EscalationService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  private async scopeFor(userId: string, permission: string): Promise<ScopeFilter> {
    const scope = await this.effective.effectiveScope(userId, permission);
    return { mode: scope.mode, userId, departmentIds: scope.departmentIds };
  }

  private async auditEvent(
    auth: AuthContext,
    eventKey: string,
    summary: string,
    entityType: string,
    entityId: string | null,
    payload: Record<string, unknown>,
    severity: 'info' | 'warn' | 'critical' = 'info',
  ): Promise<void> {
    await this.audit.record({
      eventKey,
      severity,
      summary,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType,
      entityId,
      payload,
    });
  }

  async list(userId: string, query: Record<string, unknown>) {
    const scope = await this.scopeFor(userId, 'rbac.users.read');
    const params: unknown[] = [];
    const where: string[] = [];
    const scopeSql = scopeClause(scope, 'u.department_id', params);
    if (scopeSql) where.push(scopeSql);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    if (search) {
      params.push(`%${search}%`);
      where.push(`(u.email ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`);
    }
    if (typeof query.status === 'string' && ['active', 'disabled'].includes(query.status)) {
      params.push(query.status);
      where.push(`u.status = $${params.length}::user_status`);
    }
    if (typeof query.departmentId === 'string' && query.departmentId.length > 0) {
      params.push(query.departmentId);
      where.push(`u.department_id = $${params.length}::uuid`);
    }
    const pagination = parsePagination(query);
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM users u ${whereSql}`,
      params,
    )) as { total: number }[];
    const rows = (await this.dataSource.query(
      `SELECT u.id, u.email, u.display_name, u.is_superadmin, u.status, u.department_id,
              d.name AS department_name, u.last_login_at, u.created_at
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
         ${whereSql}
        ORDER BY u.display_name ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset],
    )) as UserRow[];
    return paginated(rows, pagination, countRows[0]?.total ?? 0);
  }

  async detail(userId: string, targetId: string): Promise<UserDetail> {
    const scope = await this.scopeFor(userId, 'rbac.users.read');
    const params: unknown[] = [targetId];
    let scopeSql = '';
    const clause = scopeClause(scope, 'u.department_id', params);
    if (clause) scopeSql = `AND ${clause}`;
    const rows = (await this.dataSource.query(
      `SELECT u.id, u.email, u.display_name, u.is_superadmin, u.status, u.department_id,
              d.name AS department_name, u.last_login_at, u.created_at
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = $1 ${scopeSql}`,
      params,
    )) as UserRow[];
    const user = rows[0];
    if (!user) throw new AppError(ERROR_CODES.notFound, 'Pengguna tidak ditemukan.', 404);

    const assignments = (await this.dataSource.query(
      `SELECT ur.id, ur.role_id, r.code AS role_code, r.name AS role_name, ur.data_scope,
              ur.department_id, 'user' AS source, NULL::text AS group_name
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
        UNION ALL
       SELECT gr.id, gr.role_id, r.code AS role_code, r.name AS role_name, gr.data_scope,
              gr.department_id, 'group' AS source, g.name AS group_name
         FROM group_roles gr
         JOIN roles r ON r.id = gr.role_id
         JOIN groups g ON g.id = gr.group_id
         JOIN user_groups ug ON ug.group_id = gr.group_id
        WHERE ug.user_id = $1`,
      [targetId],
    )) as {
      id: string;
      role_id: string;
      role_code: string;
      role_name: string;
      data_scope: DataScope;
      department_id: string | null;
      source: 'user' | 'group';
      group_name: string | null;
    }[];
    const groups = (await this.dataSource.query(
      `SELECT g.id, g.code, g.name FROM groups g
         JOIN user_groups ug ON ug.group_id = g.id
        WHERE ug.user_id = $1 ORDER BY g.name`,
      [targetId],
    )) as { id: string; code: string; name: string }[];

    return {
      ...user,
      assignments: assignments.map((a) => ({
        id: a.id,
        roleId: a.role_id,
        roleCode: a.role_code,
        roleName: a.role_name,
        dataScope: a.data_scope,
        departmentId: a.department_id,
        source: a.source,
        groupName: a.group_name,
      })),
      groups,
    };
  }

  async create(auth: AuthContext, dto: CreateUserDto): Promise<UserDetail> {
    const passwordHash = await hash(dto.password, 11);
    let created: { id: string }[];
    try {
      created = (await this.dataSource.query(
        `INSERT INTO users (email, password_hash, display_name, department_id, is_superadmin)
         VALUES (lower($1), $2, $3, $4, $5)
         RETURNING id`,
        [dto.email, passwordHash, dto.displayName, dto.departmentId ?? null, dto.isSuperadmin ?? false],
      )) as { id: string }[];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Email sudah terdaftar.', 409);
      }
      throw error;
    }
    const id = created[0]?.id ?? '';
    await this.auditEvent(auth, AUDIT_EVENTS.userCreated, `Membuat pengguna ${dto.email}`, 'user', id, {
      email: dto.email,
      isSuperadmin: dto.isSuperadmin ?? false,
    });
    return this.detail(auth.user.id, id);
  }

  async update(auth: AuthContext, targetId: string, dto: UpdateUserDto): Promise<UserDetail> {
    const target = (await this.dataSource.query(
      `SELECT id, email, is_superadmin, status, department_id FROM users WHERE id = $1`,
      [targetId],
    )) as { id: string; email: string; is_superadmin: boolean; status: string; department_id: string | null }[];
    const row = target[0];
    if (!row) throw new AppError(ERROR_CODES.notFound, 'Pengguna tidak ditemukan.', 404);
    if (row.is_superadmin && !auth.user.isSuperadmin) {
      throw new AppError(
        ERROR_CODES.escalationBlocked,
        'Hanya superadmin yang dapat mengubah akun superadmin.',
        403,
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [targetId];
    const changed: Record<string, unknown> = {};

    if (dto.displayName !== undefined) {
      params.push(dto.displayName);
      sets.push(`display_name = $${params.length}`);
      changed.displayName = dto.displayName;
    }
    if (dto.departmentId !== undefined) {
      params.push(dto.departmentId ?? null);
      sets.push(`department_id = $${params.length}::uuid`);
      changed.departmentId = dto.departmentId;
    }
    if (dto.status !== undefined && dto.status !== row.status) {
      if (targetId === auth.user.id && dto.status === 'disabled') {
        throw new AppError(ERROR_CODES.validation, 'Tidak dapat menonaktifkan akun sendiri.', 400);
      }
      changed.status = dto.status;
    }
    if (dto.isSuperadmin !== undefined && dto.isSuperadmin !== row.is_superadmin) {
      if (!auth.user.isSuperadmin) {
        throw new AppError(
          ERROR_CODES.escalationBlocked,
          'Hanya superadmin yang dapat mengubah status superadmin.',
          403,
        );
      }
      if (dto.isSuperadmin === false) {
        const active = (await this.dataSource.query(
          `SELECT count(*)::int AS total FROM users WHERE is_superadmin = true AND status = 'active'`,
        )) as { total: number }[];
        const violations = checkLastSuperadmin(true, active[0]?.total ?? 0, true);
        if (violations.length > 0) {
          await this.auditEvent(
            auth,
            AUDIT_EVENTS.securityPrivilegeEscalationBlocked,
            `Blokir pencabutan superadmin terakhir: ${row.email}`,
            'user',
            targetId,
            { violations },
            'warn',
          );
          throw new AppError(ERROR_CODES.escalationBlocked, violations[0]!.detail, 403, { violations });
        }
      }
      params.push(dto.isSuperadmin);
      sets.push(`is_superadmin = $${params.length}`);
      changed.isSuperadmin = dto.isSuperadmin;
    }

    const statusChanged = changed.status !== undefined;
    if (sets.length > 0) {
      sets.push('updated_at = now()');
      await this.dataSource.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
    }
    if (statusChanged && changed.status === 'disabled') {
      await this.dataSource.query(
        `UPDATE users SET token_version = token_version + 1 WHERE id = $1`,
        [targetId],
      );
      await this.sessions.revokeAllForUser(targetId, 'account_disabled');
    }
    if (sets.length > 0) {
      await this.effective.bumpVersion();
      await this.auditEvent(auth, AUDIT_EVENTS.userUpdated, `Memperbarui pengguna ${row.email}`, 'user', targetId, changed);
      if (statusChanged) {
        await this.auditEvent(
          auth,
          AUDIT_EVENTS.userStatusChanged,
          `Status ${row.email} menjadi ${String(changed.status)}`,
          'user',
          targetId,
          { from: row.status, to: changed.status },
        );
      }
    }
    return this.detail(auth.user.id, targetId);
  }

  async resetPassword(auth: AuthContext, targetId: string, dto: ResetPasswordDto): Promise<void> {
    const target = (await this.dataSource.query(
      `SELECT id, email, is_superadmin FROM users WHERE id = $1`,
      [targetId],
    )) as { id: string; email: string; is_superadmin: boolean }[];
    const row = target[0];
    if (!row) throw new AppError(ERROR_CODES.notFound, 'Pengguna tidak ditemukan.', 404);
    if (row.is_superadmin && !auth.user.isSuperadmin) {
      throw new AppError(ERROR_CODES.escalationBlocked, 'Hanya superadmin yang dapat mengatur ulang kata sandi superadmin.', 403);
    }
    const passwordHash = await hash(dto.newPassword, 11);
    await this.dataSource.query(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1,
              failed_login_count = 0, locked_until = NULL, updated_at = now()
        WHERE id = $1`,
      [targetId, passwordHash],
    );
    await this.sessions.revokeAllForUser(targetId, 'password_reset');
    await this.auditEvent(auth, AUDIT_EVENTS.authPasswordReset, `Mengatur ulang kata sandi ${row.email}`, 'user', targetId, {}, 'warn');
  }

  async assignRole(auth: AuthContext, targetId: string, dto: RoleAssignmentDto): Promise<UserDetail> {
    const roleRows = (await this.dataSource.query(
      `SELECT r.id, r.code, r.is_system, array_remove(array_agg(p.identifier), NULL) AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE r.id = $1
        GROUP BY r.id`,
      [dto.roleId],
    )) as { id: string; code: string; is_system: boolean; permissions: string[] }[];
    const role = roleRows[0];
    if (!role) throw new AppError(ERROR_CODES.notFound, 'Peran tidak ditemukan.', 404);

    if (dto.dataScope === 'department' && !dto.departmentId) {
      throw new AppError(ERROR_CODES.validation, 'departmentId wajib diisi untuk scope department.', 400);
    }
    if (dto.departmentId) {
      const dept = (await this.dataSource.query('SELECT id FROM departments WHERE id = $1', [
        dto.departmentId,
      ])) as { id: string }[];
      if (dept.length === 0) throw new AppError(ERROR_CODES.notFound, 'Departemen tidak ditemukan.', 404);
    }

    const violations = await this.escalation.checkGrant(auth.user.id, {
      subjectIsSelf: auth.user.id === targetId,
      roleCode: role.code,
      roleIsSystem: role.is_system,
      rolePermissions: role.permissions,
      dataScope: dto.dataScope,
    });
    if (violations.length > 0) {
      await this.auditEvent(
        auth,
        AUDIT_EVENTS.securityPrivilegeEscalationBlocked,
        `Pemberian peran ${role.code} ditolak untuk ${targetId}`,
        'user',
        targetId,
        { roleCode: role.code, violations },
        'warn',
      );
      throw new AppError(
        ERROR_CODES.escalationBlocked,
        'Pemberian peran ditolak oleh aturan anti-escalation.',
        403,
        { violations },
      );
    }

    try {
      await this.dataSource.query(
        `INSERT INTO user_roles (user_id, role_id, data_scope, department_id)
         VALUES ($1, $2, $3::data_scope, $4::uuid)`,
        [targetId, dto.roleId, dto.dataScope, dto.departmentId ?? null],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Peran dengan scope tersebut sudah dimiliki pengguna.', 409);
      }
      throw error;
    }
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.assignmentGranted, `Memberi peran ${role.code}`, 'user', targetId, {
      roleId: dto.roleId,
      roleCode: role.code,
      dataScope: dto.dataScope,
      departmentId: dto.departmentId ?? null,
    });
    return this.detail(auth.user.id, targetId);
  }

  async revokeRole(auth: AuthContext, targetId: string, assignmentId: string): Promise<UserDetail> {
    const rows = (await this.dataSource.query(
      `SELECT ur.id, ur.user_id, r.code, r.is_system
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.id = $1 AND ur.user_id = $2`,
      [assignmentId, targetId],
    )) as { id: string; user_id: string; code: string; is_system: boolean }[];
    const assignment = rows[0];
    if (!assignment) throw new AppError(ERROR_CODES.notFound, 'Assignment tidak ditemukan.', 404);

    if (auth.user.id === targetId) {
      await this.auditEvent(
        auth,
        AUDIT_EVENTS.securityPrivilegeEscalationBlocked,
        'Percobaan mencabut peran milik sendiri',
        'user',
        targetId,
        { assignmentId },
        'warn',
      );
      throw new AppError(
        ERROR_CODES.escalationBlocked,
        'Tidak boleh mengubah assignment role milik sendiri.',
        403,
      );
    }
    if (assignment.is_system && assignment.code === 'administrator' && !auth.user.isSuperadmin) {
      throw new AppError(
        ERROR_CODES.escalationBlocked,
        'Hanya superadmin yang dapat mencabut peran administrator.',
        403,
      );
    }

    const deleted = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM user_roles WHERE id = $1 AND user_id = $2 RETURNING id`,
        [assignmentId, targetId],
      ),
    );
    if (deleted.length === 0) throw new AppError(ERROR_CODES.notFound, 'Assignment tidak ditemukan.', 404);
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.assignmentRevoked, `Mencabut peran ${assignment.code}`, 'user', targetId, {
      assignmentId,
      roleCode: assignment.code,
    });
    return this.detail(auth.user.id, targetId);
  }
}
