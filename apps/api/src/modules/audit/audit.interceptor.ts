import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { mergeMap, type Observable } from 'rxjs';
import type { AuthContext } from '../../common/types/auth-context';
import { AUDIT_EVENT_KEY, type AuditMetadata } from '../../common/decorators/audit.decorator';
import { AuditService } from './audit.service';

const SENSITIVE_FIELDS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'csrfToken',
  'secret',
  'clientSecret',
  'apiKey',
]);

/** Strips credential-bearing fields recursively before persisting a request payload. */
export function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_FIELDS.has(key) ? '[REDACTED]' : sanitizePayload(entry);
  }
  return out;
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return req.ip ?? null;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_EVENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext; id?: string }>();
    return next.handle().pipe(
      mergeMap(async (data) => {
        try {
          await this.audit.record({
            eventKey: meta.eventKey,
            severity: meta.severity,
            summary: `${req.method} ${req.originalUrl}`,
            actorUserId: req.auth?.user.id ?? null,
            actorLabel: req.auth?.user.email ?? null,
            actorIp: clientIp(req),
            actorUserAgent: req.headers['user-agent'] ?? null,
            requestId: typeof req.id === 'string' ? req.id : null,
            entityId: typeof req.params?.id === 'string' ? req.params.id : null,
            payload: {
              params: sanitizePayload(req.params ?? {}),
              body: sanitizePayload(req.body ?? {}),
            },
          });
        } catch (error) {
          this.logger.error(
            `Gagal menulis audit ${meta.eventKey}: ${(error as Error).message}`,
          );
        }
        return data;
      }),
    );
  }
}
