import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS, isKnownPermissionId } from '@contributor/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { CreateRoleDto, ReplaceRolePermissionsDto, UpdateRoleDto } from './dto/rbac.dto';

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permission_count: number;
  assignment_count: number;
  created_at: Date;
}

@Injectable()
export class RolesService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly effective: EffectivePermissionsService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return (await this.dataSource.query(
      `SELECT r.id, r.code, r.name, r.description, r.is_system, r.created_at,
              (SELECT count(*)::int FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
              (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id)
                + (SELECT count(*)::int FROM group_roles gr WHERE gr.role_id = r.id) AS assignment_count
         FROM roles r
        ORDER BY r.is_system DESC, r.name ASC`,
    )) as RoleRow[];
  }

  async permissions(roleId: string) {
    await this.mustExist(roleId);
    const rows = (await this.dataSource.query(
      `SELECT p.identifier FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 ORDER BY p.identifier`,
      [roleId],
    )) as { identifier: string }[];
    return rows.map((r) => r.identifier);
  }

  private async mustExist(roleId: string): Promise<{ id: string; code: string; is_system: boolean; name: string }> {
    const rows = (await this.dataSource.query(
      `SELECT id, code, is_system, name FROM roles WHERE id = $1`,
      [roleId],
    )) as { id: string; code: string; is_system: boolean; name: string }[];
    const role = rows[0];
    if (!role) throw new AppError(ERROR_CODES.notFound, 'Peran tidak ditemukan.', 404);
    return role;
  }

  private async auditEvent(
    auth: AuthContext,
    eventKey: string,
    summary: string,
    entityId: string,
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
      entityType: 'role',
      entityId,
      payload,
    });
  }

  async create(auth: AuthContext, dto: CreateRoleDto) {
    let rows: { id: string }[];
    try {
      rows = (await this.dataSource.query(
        `INSERT INTO roles (code, name, description) VALUES ($1, $2, $3) RETURNING id`,
        [dto.code, dto.name, dto.description ?? null],
      )) as { id: string }[];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Kode peran sudah digunakan.', 409);
      }
      throw error;
    }
    const id = rows[0]?.id ?? '';
    await this.auditEvent(auth, AUDIT_EVENTS.roleCreated, `Membuat peran ${dto.code}`, id, {
      code: dto.code,
      name: dto.name,
    });
    return this.mustExist(id);
  }

  async update(auth: AuthContext, roleId: string, dto: UpdateRoleDto) {
    const role = await this.mustExist(roleId);
    if (role.is_system && !auth.user.isSuperadmin) {
      throw new AppError(
        ERROR_CODES.escalationBlocked,
        'Hanya superadmin yang dapat mengubah peran sistem.',
        403,
      );
    }
    const sets: string[] = [];
    const params: unknown[] = [roleId];
    if (dto.name !== undefined) {
      params.push(dto.name);
      sets.push(`name = $${params.length}`);
    }
    if (dto.description !== undefined) {
      params.push(dto.description);
      sets.push(`description = $${params.length}`);
    }
    if (sets.length > 0) {
      sets.push('updated_at = now()');
      await this.dataSource.query(`UPDATE roles SET ${sets.join(', ')} WHERE id = $1`, params);
      await this.effective.bumpVersion();
      await this.auditEvent(auth, AUDIT_EVENTS.roleUpdated, `Memperbarui peran ${role.code}`, roleId, {
        name: dto.name,
      });
    }
    return this.mustExist(roleId);
  }

  async remove(auth: AuthContext, roleId: string) {
    const role = await this.mustExist(roleId);
    if (role.is_system) {
      throw new AppError(ERROR_CODES.conflict, 'Peran sistem tidak dapat dihapus.', 409);
    }
    const usage = (await this.dataSource.query(
      `SELECT (SELECT count(*)::int FROM user_roles WHERE role_id = $1)
            + (SELECT count(*)::int FROM group_roles WHERE role_id = $1) AS total`,
      [roleId],
    )) as { total: number }[];
    if ((usage[0]?.total ?? 0) > 0) {
      throw new AppError(ERROR_CODES.conflict, 'Peran masih dipakai oleh pengguna atau grup.', 409);
    }
    const deleted = updatedRows<{ id: string }>(
      await this.dataSource.query(`DELETE FROM roles WHERE id = $1 RETURNING id`, [roleId]),
    );
    if (deleted.length === 0) throw new AppError(ERROR_CODES.notFound, 'Peran tidak ditemukan.', 404);
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.roleDeleted, `Menghapus peran ${role.code}`, roleId, {});
    return { deleted: true };
  }

  async replacePermissions(auth: AuthContext, roleId: string, dto: ReplaceRolePermissionsDto) {
    const role = await this.mustExist(roleId);
    const unknown = dto.permissions.filter((p) => !isKnownPermissionId(p));
    if (unknown.length > 0) {
      throw new AppError(ERROR_CODES.validation, 'Ada permission tidak dikenal.', 400, { unknown });
    }
    if (role.is_system && role.code === 'administrator' && !auth.user.isSuperadmin) {
      await this.auditEvent(
        auth,
        AUDIT_EVENTS.securityPrivilegeEscalationBlocked,
        'Percobaan mengubah permission peran administrator',
        roleId,
        { requested: dto.permissions },
        'warn',
      );
      throw new AppError(
        ERROR_CODES.escalationBlocked,
        'Hanya superadmin yang dapat mengubah permission peran administrator.',
        403,
      );
    }
    if (!auth.user.isSuperadmin) {
      const forbidden = dto.permissions.filter((p) => !auth.effective.allowed.has(p));
      if (forbidden.length > 0) {
        await this.auditEvent(
          auth,
          AUDIT_EVENTS.securityPrivilegeEscalationBlocked,
          `Percobaan memberikan permission di luar kewenangan pada peran ${role.code}`,
          roleId,
          { forbidden },
          'warn',
        );
        throw new AppError(
          ERROR_CODES.escalationBlocked,
          'Anda tidak dapat memberikan permission yang tidak Anda miliki.',
          403,
          { forbidden },
        );
      }
    }

    const before = await this.permissions(roleId);
    await this.dataSource.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
    if (dto.permissions.length > 0) {
      await this.dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE identifier = ANY($2::text[])`,
        [roleId, dto.permissions],
      );
    }
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.rolePermissionsUpdated, `Mengubah permission peran ${role.code}`, roleId, {
      before,
      after: [...dto.permissions].sort(),
    });
    return { permissions: await this.permissions(roleId) };
  }
}
