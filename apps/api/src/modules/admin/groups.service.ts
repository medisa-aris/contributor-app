import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS } from '@bara/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import { EscalationService } from '../rbac/escalation.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { CreateGroupDto, GroupMembersDto, UpdateGroupDto } from './dto/rbac.dto';
import type { RoleAssignmentDto } from './dto/users.dto';

@Injectable()
export class GroupsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly effective: EffectivePermissionsService,
    private readonly escalation: EscalationService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return (await this.dataSource.query(
      `SELECT g.id, g.code, g.name, g.description, g.created_at,
              (SELECT count(*)::int FROM user_groups ug WHERE ug.group_id = g.id) AS member_count,
              (SELECT count(*)::int FROM group_roles gr WHERE gr.group_id = g.id) AS role_count
         FROM groups g
        ORDER BY g.name ASC`,
    )) as unknown[];
  }

  async detail(groupId: string) {
    const groups = (await this.dataSource.query(
      `SELECT id, code, name, description, created_at FROM groups WHERE id = $1`,
      [groupId],
    )) as { id: string; code: string; name: string; description: string | null; created_at: Date }[];
    const group = groups[0];
    if (!group) throw new AppError(ERROR_CODES.notFound, 'Grup tidak ditemukan.', 404);

    const members = (await this.dataSource.query(
      `SELECT u.id, u.email, u.display_name, u.status, u.department_id, d.name AS department_name
         FROM user_groups ug
         JOIN users u ON u.id = ug.user_id
         LEFT JOIN departments d ON d.id = u.department_id
        WHERE ug.group_id = $1
        ORDER BY u.display_name`,
      [groupId],
    )) as unknown[];
    const roles = (await this.dataSource.query(
      `SELECT gr.id, gr.role_id, r.code AS role_code, r.name AS role_name, gr.data_scope, gr.department_id
         FROM group_roles gr JOIN roles r ON r.id = gr.role_id
        WHERE gr.group_id = $1
        ORDER BY r.name`,
      [groupId],
    )) as {
      id: string;
      role_id: string;
      role_code: string;
      role_name: string;
      data_scope: string;
      department_id: string | null;
    }[];
    return {
      ...group,
      members,
      roles: roles.map((r) => ({
        id: r.id,
        roleId: r.role_id,
        roleCode: r.role_code,
        roleName: r.role_name,
        dataScope: r.data_scope,
        departmentId: r.department_id,
      })),
    };
  }

  async mustExist(groupId: string): Promise<{ id: string; code: string; name: string }> {
    const rows = (await this.dataSource.query(`SELECT id, code, name FROM groups WHERE id = $1`, [
      groupId,
    ])) as { id: string; code: string; name: string }[];
    const group = rows[0];
    if (!group) throw new AppError(ERROR_CODES.notFound, 'Grup tidak ditemukan.', 404);
    return group;
  }

  async auditEvent(
    auth: AuthContext,
    eventKey: string,
    summary: string,
    groupId: string,
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
      entityType: 'group',
      entityId: groupId,
      payload,
    });
  }

  async create(auth: AuthContext, dto: CreateGroupDto) {
    let rows: { id: string }[];
    try {
      rows = (await this.dataSource.query(
        `INSERT INTO groups (code, name, description) VALUES ($1, $2, $3) RETURNING id`,
        [dto.code, dto.name, dto.description ?? null],
      )) as { id: string }[];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Kode grup sudah digunakan.', 409);
      }
      throw error;
    }
    const id = rows[0]?.id ?? '';
    await this.auditEvent(auth, AUDIT_EVENTS.groupCreated, `Membuat grup ${dto.code}`, id, {
      code: dto.code,
      name: dto.name,
    });
    return this.detail(id);
  }

  async update(auth: AuthContext, groupId: string, dto: UpdateGroupDto) {
    const group = await this.mustExist(groupId);
    const sets: string[] = [];
    const params: unknown[] = [groupId];
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
      await this.dataSource.query(`UPDATE groups SET ${sets.join(', ')} WHERE id = $1`, params);
      await this.auditEvent(auth, AUDIT_EVENTS.groupUpdated, `Memperbarui grup ${group.code}`, groupId, {
        name: dto.name,
      });
    }
    return this.detail(groupId);
  }

  async remove(auth: AuthContext, groupId: string) {
    const group = await this.mustExist(groupId);
    const deleted = updatedRows<{ id: string }>(
      await this.dataSource.query(`DELETE FROM groups WHERE id = $1 RETURNING id`, [groupId]),
    );
    if (deleted.length === 0) throw new AppError(ERROR_CODES.notFound, 'Grup tidak ditemukan.', 404);
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.groupDeleted, `Menghapus grup ${group.code}`, groupId, {});
    return { deleted: true };
  }

  async addMembers(auth: AuthContext, groupId: string, dto: GroupMembersDto) {
    await this.mustExist(groupId);
    const existing = (await this.dataSource.query(
      `SELECT id FROM users WHERE id = ANY($1::uuid[])`,
      [dto.userIds],
    )) as { id: string }[];
    if (existing.length !== dto.userIds.length) {
      throw new AppError(ERROR_CODES.validation, 'Ada pengguna yang tidak ditemukan.', 400);
    }
    await this.dataSource.query(
      `INSERT INTO user_groups (group_id, user_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [groupId, dto.userIds],
    );
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.groupMembersAdded, `Menambah anggota grup`, groupId, {
      userIds: dto.userIds,
    }, 'warn');
    return this.detail(groupId);
  }

  async removeMember(auth: AuthContext, groupId: string, userId: string) {
    await this.mustExist(groupId);
    const deleted = updatedRows<{ user_id: string }>(
      await this.dataSource.query(
        `DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2 RETURNING user_id`,
        [groupId, userId],
      ),
    );
    if (deleted.length === 0) throw new AppError(ERROR_CODES.notFound, 'Anggota tidak ditemukan di grup.', 404);
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.groupMembersRemoved, `Menghapus anggota dari grup`, groupId, {
      userId,
    }, 'warn');
    return this.detail(groupId);
  }

  async assignRole(auth: AuthContext, groupId: string, dto: RoleAssignmentDto) {
    const group = await this.mustExist(groupId);
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

    const violations = await this.escalation.checkGrant(auth.user.id, {
      subjectIsSelf: false,
      roleCode: role.code,
      roleIsSystem: role.is_system,
      rolePermissions: role.permissions,
      dataScope: dto.dataScope,
    });
    if (violations.length > 0) {
      await this.auditEvent(
        auth,
        AUDIT_EVENTS.securityPrivilegeEscalationBlocked,
        `Pemberian peran ${role.code} ke grup ${group.code} ditolak`,
        groupId,
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
        `INSERT INTO group_roles (group_id, role_id, data_scope, department_id)
         VALUES ($1, $2, $3::data_scope, $4::uuid)`,
        [groupId, dto.roleId, dto.dataScope, dto.departmentId ?? null],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Peran dengan scope tersebut sudah dimiliki grup.', 409);
      }
      throw error;
    }
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.assignmentGranted, `Memberi peran ${role.code} ke grup ${group.code}`, groupId, {
      roleId: dto.roleId,
      roleCode: role.code,
      dataScope: dto.dataScope,
      departmentId: dto.departmentId ?? null,
    });
    return this.detail(groupId);
  }

  async revokeRole(auth: AuthContext, groupId: string, assignmentId: string) {
    await this.mustExist(groupId);
    const rows = (await this.dataSource.query(
      `SELECT gr.id, r.code, r.is_system
         FROM group_roles gr JOIN roles r ON r.id = gr.role_id
        WHERE gr.id = $1 AND gr.group_id = $2`,
      [assignmentId, groupId],
    )) as { id: string; code: string; is_system: boolean }[];
    const assignment = rows[0];
    if (!assignment) throw new AppError(ERROR_CODES.notFound, 'Assignment tidak ditemukan.', 404);
    if (assignment.is_system && assignment.code === 'administrator' && !auth.user.isSuperadmin) {
      throw new AppError(
        ERROR_CODES.escalationBlocked,
        'Hanya superadmin yang dapat mencabut peran administrator.',
        403,
      );
    }
    const deleted = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM group_roles WHERE id = $1 AND group_id = $2 RETURNING id`,
        [assignmentId, groupId],
      ),
    );
    if (deleted.length === 0) throw new AppError(ERROR_CODES.notFound, 'Assignment tidak ditemukan.', 404);
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.assignmentRevoked, `Mencabut peran ${assignment.code} dari grup`, groupId, {
      assignmentId,
      roleCode: assignment.code,
    });
    return this.detail(groupId);
  }
}
