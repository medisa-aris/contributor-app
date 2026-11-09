import { SetMetadata } from '@nestjs/common';
import type { AuditSeverity } from '@bara/shared';

export const AUDIT_EVENT_KEY = 'auditEvent';

export interface AuditMetadata {
  eventKey: string;
  severity: AuditSeverity;
}

/** Records an audit_events row after the handler succeeds (payload sanitized). */
export const Audit = (eventKey: string, severity: AuditSeverity = 'info'): MethodDecorator =>
  SetMetadata(AUDIT_EVENT_KEY, { eventKey, severity } satisfies AuditMetadata);
