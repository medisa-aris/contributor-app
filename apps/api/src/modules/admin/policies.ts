import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS, PERMISSIONS } from '@contributor/shared';
import { DataSource } from 'typeorm';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/rbac.dto';

const SUBJECT_TABLE: Record<string, string> = {
  user: 'users',
  group: 'groups',
  role: 'roles',
};

@Injectable()
export class PoliciesService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly effective: EffectivePermissionsService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return (await this.dataSource.query(
      `SELECT rp.id, rp.name, rp.effect, rp.subject_type, rp.subject_id,
              CASE rp.subject_type
                WHEN 'user' THEN (SELECT email FROM users WHERE id = rp.subject_id)
                WHEN 'group' THEN (SELECT name FROM groups WHERE id = rp.subject_id)
                WHEN 'role' THEN (SELECT name FROM roles WHERE id = rp.subject_id)
              END AS subject_label,
              rp.permission_pattern, rp.resource_type, rp.resource_id,
              rp.priority, rp.conditions, rp.is_active, rp.created_at, rp.updated_at
         FROM resource_policies rp
        ORDER BY rp.priority DESC, rp.created_at DESC`,
    )) as unknown[];
  }

  private async auditEvent(
    auth: AuthContext,
    eventKey: string,
    summary: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      eventKey,
      severity: 'info',
      summary,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'resource_policy',
      entityId,
      payload,
    });
  }

  private async assertSubject(type: 'user' | 'group' | 'role', id: string): Promise<void> {
    const table = SUBJECT_TABLE[type]!;
    const rows = (await this.dataSource.query(`SELECT id FROM ${table} WHERE id = $1`, [id])) as {
      id: string;
    }[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, `Subjek ${type} tidak ditemukan.`, 404);
    }
  }

  async create(auth: AuthContext, dto: CreatePolicyDto) {
    await this.assertSubject(dto.subjectType, dto.subjectId);
    const rows = (await this.dataSource.query(
      `INSERT INTO resource_policies
         (name, effect, subject_type, subject_id, permission_pattern,
          resource_type, resource_id, priority, conditions, is_active)
       VALUES ($1, $2::policy_effect, $3::policy_subject_type, $4, $5, $6, $7::uuid, $8, $9::jsonb, $10)
       RETURNING id`,
      [
        dto.name,
        dto.effect,
        dto.subjectType,
        dto.subjectId,
        dto.permissionPattern,
        dto.resourceType ?? null,
        dto.resourceId ?? null,
        dto.priority ?? 0,
        JSON.stringify(dto.conditions ?? {}),
        dto.isActive ?? true,
      ],
    )) as { id: string }[];
    const id = rows[0]?.id ?? '';
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.policyCreated, `Membuat kebijakan ${dto.name}`, id, {
      effect: dto.effect,
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      permissionPattern: dto.permissionPattern,
    });
    return { id };
  }

  async update(auth: AuthContext, policyId: string, dto: UpdatePolicyDto) {
    const sets: string[] = [];
    const params: unknown[] = [policyId];
    if (dto.name !== undefined) {
      params.push(dto.name);
      sets.push(`name = $${params.length}`);
    }
    if (dto.priority !== undefined) {
      params.push(dto.priority);
      sets.push(`priority = $${params.length}`);
    }
    if (dto.isActive !== undefined) {
      params.push(dto.isActive);
      sets.push(`is_active = $${params.length}`);
    }
    if (dto.resourceType !== undefined) {
      params.push(dto.resourceType);
      sets.push(`resource_type = $${params.length}`);
    }
    if (dto.resourceId !== undefined) {
      params.push(dto.resourceId);
      sets.push(`resource_id = $${params.length}::uuid`);
    }
    if (dto.conditions !== undefined) {
      params.push(JSON.stringify(dto.conditions));
      sets.push(`conditions = $${params.length}::jsonb`);
    }
    if (sets.length === 0) return { updated: false };
    sets.push('updated_at = now()');
    const rows = updatedRows<{ id: string; name: string }>(
      await this.dataSource.query(
        `UPDATE resource_policies SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name`,
        params,
      ),
    );
    if (rows.length === 0) throw new AppError(ERROR_CODES.notFound, 'Kebijakan tidak ditemukan.', 404);
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.policyUpdated, `Memperbarui kebijakan ${rows[0]!.name}`, policyId, {
      changes: dto as Record<string, unknown>,
    });
    return { updated: true };
  }

  async remove(auth: AuthContext, policyId: string) {
    const rows = updatedRows<{ id: string; name: string }>(
      await this.dataSource.query(
        `DELETE FROM resource_policies WHERE id = $1 RETURNING id, name`,
        [policyId],
      ),
    );
    if (rows.length === 0) throw new AppError(ERROR_CODES.notFound, 'Kebijakan tidak ditemukan.', 404);
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.policyDeleted, `Menghapus kebijakan ${rows[0]!.name}`, policyId, {});
    return { deleted: true };
  }
}

@ApiTags('admin-policies')
@Controller('admin/policies')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @RequirePermission(PERMISSIONS.policiesRead)
  @Get()
  list() {
    return this.policies.list();
  }

  @RequirePermission(PERMISSIONS.policiesManage)
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePolicyDto) {
    return this.policies.create(auth, dto);
  }

  @RequirePermission(PERMISSIONS.policiesManage)
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdatePolicyDto,
  ) {
    return this.policies.update(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.policiesManage)
  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.policies.remove(auth, id);
  }
}
