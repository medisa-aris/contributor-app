import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import { DataSource } from 'typeorm';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DATA_SOURCE } from '../../database/database.module';
import { paginated, parsePagination } from './common/pagination';

const SEVERITIES = ['info', 'warn', 'critical'];

@ApiTags('admin-audit')
@Controller('admin/audit-events')
export class AuditController {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  @RequirePermission(PERMISSIONS.auditRead)
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (typeof query.eventKey === 'string' && query.eventKey.length > 0) {
      params.push(`${query.eventKey}%`);
      where.push(`a.event_key LIKE $${params.length}`);
    }
    if (typeof query.severity === 'string' && SEVERITIES.includes(query.severity)) {
      params.push(query.severity);
      where.push(`a.severity = $${params.length}::audit_severity`);
    }
    if (typeof query.actorUserId === 'string' && query.actorUserId.length > 0) {
      params.push(query.actorUserId);
      where.push(`a.actor_user_id = $${params.length}::uuid`);
    }
    if (typeof query.entityType === 'string' && query.entityType.length > 0) {
      params.push(query.entityType);
      where.push(`a.entity_type = $${params.length}`);
    }
    if (typeof query.entityId === 'string' && query.entityId.length > 0) {
      params.push(query.entityId);
      where.push(`a.entity_id = $${params.length}`);
    }
    if (typeof query.search === 'string' && query.search.trim().length > 0) {
      params.push(`%${query.search.trim()}%`);
      where.push(`(a.summary ILIKE $${params.length} OR a.actor_label ILIKE $${params.length})`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const pagination = parsePagination(query, 50);

    const countRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM audit_events a ${whereSql}`,
      params,
    )) as { total: number }[];
    const rows = (await this.dataSource.query(
      `SELECT a.id, a.occurred_at, a.severity, a.event_key, a.summary,
              a.actor_user_id, a.actor_label, a.actor_ip, a.request_id,
              a.entity_type, a.entity_id, a.payload
         FROM audit_events a
         ${whereSql}
        ORDER BY a.occurred_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset],
    )) as unknown[];
    return paginated(rows, pagination, countRows[0]?.total ?? 0);
  }
}
