import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS, PERMISSIONS } from '@bara/shared';
import { DataSource } from 'typeorm';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { evaluatePermission } from '../rbac/policy-engine';
import { AuthzTestDto } from './dto/misc.dto';

@ApiTags('admin-diagnostics')
@Controller('admin/diagnostics')
export class DiagnosticsAdminController {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly effective: EffectivePermissionsService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission(PERMISSIONS.effectiveInspect)
  @Get('users/:id/effective-permissions')
  async inspect(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    const users = (await this.dataSource.query(
      `SELECT id, email, display_name, status, is_superadmin, department_id FROM users WHERE id = $1`,
      [id],
    )) as {
      id: string;
      email: string;
      display_name: string;
      status: string;
      is_superadmin: boolean;
      department_id: string | null;
    }[];
    if (users.length === 0) throw new AppError(ERROR_CODES.notFound, 'Pengguna tidak ditemukan.', 404);

    const access = await this.effective.resolve(id);
    const decisions = [...access.decisions.values()]
      .map((d) => ({
        permission: d.permission,
        allowed: d.allowed,
        reason: d.reason,
        scope: d.scope,
        chain: d.chain,
      }))
      .sort((a, b) => a.permission.localeCompare(b.permission));
    const assignments = access.input.assignments.map((a) => ({
      roleCode: a.roleCode,
      roleName: a.roleName,
      dataScope: a.dataScope,
      departmentId: a.departmentId,
      source: a.source,
    }));
    return {
      user: users[0],
      isSuperadmin: access.isSuperadmin,
      rbacVersion: access.version,
      assignments,
      decisions,
    };
  }

  @RequirePermission(PERMISSIONS.authzTest)
  @HttpCode(200)
  @Post('authz-test')
  async authzTest(@CurrentAuth() auth: AuthContext, @Body() dto: AuthzTestDto) {
    const access = await this.effective.resolve(dto.userId);
    const decision = evaluatePermission(access.input, dto.permission, {
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      resourceOwnerId: dto.resourceOwnerId,
    });
    await this.audit.record({
      eventKey: AUDIT_EVENTS.adminAuthzTestPerformed,
      severity: 'info',
      summary: `Uji otorisasi ${dto.permission} untuk ${dto.userId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'user',
      entityId: dto.userId,
      payload: {
        permission: dto.permission,
        resourceType: dto.resourceType ?? null,
        resourceId: dto.resourceId ?? null,
        allowed: decision.allowed,
        reason: decision.reason,
      },
    });
    return {
      allowed: decision.allowed,
      reason: decision.reason,
      scope: decision.scope,
      chain: decision.chain,
    };
  }
}
