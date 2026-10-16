import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS, PERMISSIONS } from '@contributor/shared';
import { DataSource } from 'typeorm';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import { paginated, parsePagination } from './common/pagination';

@ApiTags('admin-sessions')
@Controller('admin/sessions')
export class SessionsAdminController {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission(PERMISSIONS.sessionsManage)
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const params: unknown[] = [];
    const where: string[] = ['s.revoked_at IS NULL', 's.expires_at > now()'];
    if (typeof query.userId === 'string' && query.userId.length > 0) {
      params.push(query.userId);
      where.push(`s.user_id = $${params.length}::uuid`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const pagination = parsePagination(query, 50);
    const countRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM sessions s ${whereSql}`,
      params,
    )) as { total: number }[];
    const rows = (await this.dataSource.query(
      `SELECT s.id, s.user_id, u.email, u.display_name, s.ip, s.user_agent,
              s.created_at, s.last_seen_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         ${whereSql}
        ORDER BY s.last_seen_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset],
    )) as unknown[];
    return paginated(rows, pagination, countRows[0]?.total ?? 0);
  }

  @Audit(AUDIT_EVENTS.authSessionRevoked, 'warn')
  @RequirePermission(PERMISSIONS.sessionsManage)
  @Delete(':id')
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    const rows = updatedRows<{ id: string; user_id: string }>(
      await this.dataSource.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'revoked_by_admin'
          WHERE id = $1 AND revoked_at IS NULL
          RETURNING id, user_id`,
        [id],
      ),
    );
    if (rows.length === 0) throw new AppError(ERROR_CODES.notFound, 'Sesi tidak ditemukan.', 404);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.authSessionRevoked,
      severity: 'warn',
      summary: `Admin mencabut sesi ${id}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'session',
      entityId: id,
      payload: { userId: rows[0]!.user_id },
    });
    return { revoked: true };
  }
}
