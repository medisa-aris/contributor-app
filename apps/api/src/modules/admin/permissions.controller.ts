import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS, PERMISSION_CATALOG, PERMISSIONS } from '@bara/shared';
import { DataSource } from 'typeorm';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';

@ApiTags('admin-permissions')
@Controller('admin/permissions')
export class PermissionsController {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly effective: EffectivePermissionsService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission(PERMISSIONS.permissionsRead)
  @Get()
  list() {
    return this.dataSource.query(
      `SELECT p.id, p.identifier, p.name, p.description, p.is_system,
              (SELECT count(*)::int FROM role_permissions rp WHERE rp.permission_id = p.id) AS role_count
         FROM permissions p
        ORDER BY p.identifier`,
    ) as Promise<unknown[]>;
  }

  /** Menambahkan permission baru dari katalog aplikasi yang belum ada di database. */
  @RequirePermission(PERMISSIONS.permissionsAssign)
  @HttpCode(200)
  @Post('sync')
  async sync(@CurrentAuth() auth: AuthContext) {
    let added = 0;
    for (const def of PERMISSION_CATALOG) {
      const rows = (await this.dataSource.query(
        `INSERT INTO permissions (identifier, name, description, is_system)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (identifier) DO NOTHING
         RETURNING id`,
        [def.id, def.name, def.description],
      )) as { id: string }[];
      added += rows.length;
    }
    if (added > 0) {
      await this.effective.bumpVersion();
      await this.audit.record({
        eventKey: AUDIT_EVENTS.permissionSynced,
        severity: 'info',
        summary: `Sinkronisasi katalog permission (${added} baru)`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'permission',
        payload: { added },
      });
    }
    return { added };
  }
}
