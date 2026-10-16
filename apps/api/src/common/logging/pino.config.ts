import type { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Options } from 'pino-http';

/** Sensitive paths must never reach application logs (data minimization). */
const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
];

export function buildPinoHttpOptions(config: ConfigService): Options {
  return {
    level: config.get<string>('app.logLevel') ?? 'info',
    genReqId: (req: IncomingMessage) =>
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    autoLogging: {
      ignore: (req) =>
        req.url === '/api/health' ||
        req.url === '/api/health/ready' ||
        req.url === '/api/docs' ||
        (req.url?.startsWith('/api/docs') ?? false),
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  };
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.id) {
    res.setHeader('x-request-id', String(req.id));
  }
  next();
}
