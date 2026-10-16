import { Inject, Injectable } from '@nestjs/common';
import type { AuditSeverity } from '@contributor/shared';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';

export interface AuditEventInput {
  eventKey: string;
  severity: AuditSeverity;
  summary: string;
  actorUserId?: string | null;
  actorLabel?: string | null;
  actorIp?: string | null;
  actorUserAgent?: string | null;
  requestId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async record(input: AuditEventInput): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO audit_events
         (severity, event_key, summary, actor_user_id, actor_label, actor_ip,
          actor_user_agent, request_id, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.severity,
        input.eventKey,
        input.summary,
        input.actorUserId ?? null,
        input.actorLabel ?? null,
        input.actorIp ?? null,
        input.actorUserAgent ?? null,
        input.requestId ?? null,
        input.entityType ?? null,
        input.entityId ?? null,
        JSON.stringify(input.payload ?? {}),
      ],
    );
  }
}
