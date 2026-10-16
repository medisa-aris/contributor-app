import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';

export type LoginFailureReason = 'bad_password' | 'unknown_user' | 'locked' | 'disabled';

@Injectable()
export class LoginLockoutService {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async isCurrentlyLocked(lockedUntil: Date | null): Promise<boolean> {
    return lockedUntil !== null && lockedUntil.getTime() > Date.now();
  }

  async record(
    email: string,
    userId: string | null,
    ip: string | null,
    success: boolean,
    reason: LoginFailureReason | null,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO login_attempts (email, user_id, ip, success, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [email, userId, ip, success, reason],
    );
  }

  async registerFailure(userId: string): Promise<{ failedCount: number; lockedUntil: Date | null }> {
    const { threshold, minutes } = await this.thresholds();
    const rows = updatedRows<{ failed_login_count: number; locked_until: Date | null }>(
      await this.dataSource.query(
        `UPDATE users
            SET failed_login_count = failed_login_count + 1,
                locked_until = CASE
                  WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3)
                  ELSE locked_until
                END,
                updated_at = now()
          WHERE id = $1
          RETURNING failed_login_count, locked_until`,
        [userId, threshold, minutes],
      ),
    );
    return {
      failedCount: rows[0]?.failed_login_count ?? 0,
      lockedUntil: rows[0]?.locked_until ?? null,
    };
  }

  async registerSuccess(userId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE users
          SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now()
        WHERE id = $1`,
      [userId],
    );
  }

  private async thresholds(): Promise<{ threshold: number; minutes: number }> {
    const rows = (await this.dataSource.query(
      `SELECT key, value FROM app_config
        WHERE key IN ('security.lockout_threshold', 'security.lockout_minutes')`,
    )) as { key: string; value: unknown }[];
    let threshold = 5;
    let minutes = 15;
    for (const row of rows) {
      const n = typeof row.value === 'number' ? row.value : Number(row.value);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (row.key === 'security.lockout_threshold') threshold = Math.floor(n);
      if (row.key === 'security.lockout_minutes') minutes = Math.floor(n);
    }
    return { threshold, minutes };
  }
}
