import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { updatedRows } from '../../database/query-result';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';

const TOKEN_BYTES = 32;

export interface CreatedSession {
  sessionId: string;
  rawToken: string;
  csrfSecret: string;
  expiresAt: Date;
}

export interface SessionWithUser {
  id: string;
  user_id: string;
  csrf_secret: string;
  token_version_snapshot: number;
  ip: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  email: string;
  display_name: string;
  status: string;
  is_superadmin: boolean;
  department_id: string | null;
  token_version: number;
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

@Injectable()
export class SessionService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async create(
    userId: string,
    tokenVersion: number,
    absoluteHours: number,
    ip: string | null,
    userAgent: string | null,
  ): Promise<CreatedSession> {
    const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const csrfSecret = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + absoluteHours * 3_600_000);
    const rows = (await this.dataSource.query(
      `INSERT INTO sessions
         (user_id, token_hash, csrf_secret, token_version_snapshot, ip, user_agent, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
       RETURNING id`,
      [userId, hashToken(rawToken), csrfSecret, tokenVersion, ip, userAgent, expiresAt],
    )) as { id: string }[];
    return { sessionId: rows[0]?.id ?? '', rawToken, csrfSecret, expiresAt };
  }

  async findByToken(rawToken: string): Promise<SessionWithUser | null> {
    const rows = (await this.dataSource.query(
      `SELECT s.id, s.user_id, s.csrf_secret, s.token_version_snapshot, s.ip,
              s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
              u.email, u.display_name, u.status, u.is_superadmin, u.department_id, u.token_version
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [hashToken(rawToken)],
    )) as SessionWithUser[];
    return rows[0] ?? null;
  }

  async touch(sessionId: string): Promise<void> {
    await this.dataSource.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [
      sessionId,
    ]);
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE sessions SET revoked_at = now(), revoke_reason = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, reason],
    );
  }

  /** Revokes only when the session belongs to the given user (prevents cross-user revocation). */
  async revokeOwned(sessionId: string, userId: string, reason: string): Promise<boolean> {
    const rows = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = $3
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
          RETURNING id`,
        [sessionId, userId, reason],
      ),
    );
    return rows.length > 0;
  }

  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const rows = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = $2
          WHERE user_id = $1 AND revoked_at IS NULL
          RETURNING id`,
        [userId, reason],
      ),
    );
    return rows.length;
  }

  async listActiveForUser(userId: string): Promise<
    { id: string; ip: string | null; user_agent: string | null; created_at: Date; last_seen_at: Date; expires_at: Date }[]
  > {
    return (await this.dataSource.query(
      `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at
         FROM sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_seen_at DESC`,
      [userId],
    )) as never;
  }
}
