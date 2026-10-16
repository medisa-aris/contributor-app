import type { AuditSeverity } from '../enums';

export interface AuditEventDto {
  id: string;
  occurredAt: string;
  severity: AuditSeverity;
  eventKey: string;
  summary: string;
  actorUserId: string | null;
  actorLabel: string | null;
  actorIp: string | null;
  requestId: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
}
