import { compare, hash, hashSync } from 'bcryptjs';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AUDIT_EVENTS } from '@contributor/shared';
import type { AuditSeverity, MeDto, ThemePreference } from '@contributor/shared';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext, AuthSession } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { allowedIdentifiers } from '../rbac/policy-engine';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { LoginLockoutService } from './login-lockout.service';
import { SessionService } from './session.service';

const BCRYPT_ROUNDS = 11;
const DEFAULT_ABSOLUTE_HOURS = 168;
const DUMMY_HASH = hashSync('timing-equalizer-placeholder', BCRYPT_ROUNDS);

interface UserAuthRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: string;
  is_superadmin: boolean;
  department_id: string | null;
  token_version: number;
  locked_until: Date | null;
}

interface ProfileRow {
  email: string;
  display_name: string;
  is_superadmin: boolean;
  department_id: string | null;
  department_name: string | null;
  locale: string;
  theme: string;
}

export interface LoginResult {
  me: MeDto;
  rawToken: string;
  csrfSecret: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
    private readonly lockout: LoginLockoutService,
    private readonly effective: EffectivePermissionsService,
    private readonly audit: AuditService,
  ) {}

  private async auditLogin(
    eventKey: string,
    severity: AuditSeverity,
    summary: string,
    userId: string | null,
    email: string,
    ip: string | null,
    userAgent: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      eventKey,
      severity,
      summary,
      actorUserId: userId,
      actorLabel: email,
      actorIp: ip,
      actorUserAgent: userAgent,
      entityType: userId ? 'user' : null,
      entityId: userId,
      payload,
    });
  }

  async login(
    emailRaw: string,
    password: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<LoginResult> {
    const email = emailRaw.trim().toLowerCase();
    const rows = (await this.dataSource.query(
      `SELECT id, email, password_hash, display_name, status, is_superadmin,
              department_id, token_version, locked_until
         FROM users
        WHERE lower(email) = $1`,
      [email],
    )) as UserAuthRow[];
    const user = rows[0];

    if (!user) {
      await compare(password, DUMMY_HASH);
      await this.lockout.record(email, null, ip, false, 'unknown_user');
      await this.auditLogin(
        AUDIT_EVENTS.authLoginFailed,
        'warn',
        `Login gagal (email tidak dikenal): ${email}`,
        null,
        email,
        ip,
        userAgent,
        { reason: 'unknown_user' },
      );
      throw new AppError(ERROR_CODES.invalidCredentials, 'Email atau kata sandi salah', 401);
    }
    if (user.status !== 'active') {
      await this.lockout.record(email, user.id, ip, false, 'disabled');
      await this.auditLogin(
        AUDIT_EVENTS.authLoginFailed,
        'warn',
        `Login ditolak (akun nonaktif): ${email}`,
        user.id,
        email,
        ip,
        userAgent,
        { reason: 'disabled' },
      );
      throw new AppError(ERROR_CODES.accountDisabled, 'Akun ini dinonaktifkan', 403);
    }
    if (await this.lockout.isCurrentlyLocked(user.locked_until)) {
      await this.lockout.record(email, user.id, ip, false, 'locked');
      await this.auditLogin(
        AUDIT_EVENTS.authLoginLocked,
        'warn',
        `Login ditolak (akun terkunci): ${email}`,
        user.id,
        email,
        ip,
        userAgent,
        { reason: 'locked' },
      );
      throw new AppError(
        ERROR_CODES.accountLocked,
        'Akun terkunci sementara karena percobaan login gagal. Coba lagi nanti.',
        423,
      );
    }

    const passwordOk = await compare(password, user.password_hash);
    if (!passwordOk) {
      await this.lockout.registerFailure(user.id);
      await this.lockout.record(email, user.id, ip, false, 'bad_password');
      await this.auditLogin(
        AUDIT_EVENTS.authLoginFailed,
        'warn',
        `Login gagal (kata sandi salah): ${email}`,
        user.id,
        email,
        ip,
        userAgent,
        { reason: 'bad_password' },
      );
      throw new AppError(ERROR_CODES.invalidCredentials, 'Email atau kata sandi salah', 401);
    }

    await this.lockout.registerSuccess(user.id);
    const hours = await this.sessionAbsoluteHours();
    const created = await this.sessions.create(user.id, user.token_version, hours, ip, userAgent);
    await this.lockout.record(email, user.id, ip, true, null);
    await this.auditLogin(
      AUDIT_EVENTS.authLoginSuccess,
      'info',
      `Login berhasil: ${email}`,
      user.id,
      email,
      ip,
      userAgent,
      { sessionId: created.sessionId },
    );

    const access = await this.effective.resolve(user.id);
    const me = await this.assembleMe(
      user.id,
      {
        id: created.sessionId,
        csrfSecret: created.csrfSecret,
        ip,
        createdAt: new Date(),
        expiresAt: created.expiresAt,
      },
      allowedIdentifiers(access.decisions),
    );

    return { me, rawToken: created.rawToken, csrfSecret: created.csrfSecret, expiresAt: created.expiresAt };
  }

  async buildMe(auth: AuthContext): Promise<MeDto> {
    return this.assembleMe(auth.user.id, auth.session, auth.effective.allowed);
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.sessions.revoke(auth.session.id, 'logout');
  }

  /** Mencabut semua sesi user (termasuk sesi saat ini) dan menaikkan token_version. */
  async logoutAll(auth: AuthContext): Promise<void> {
    await this.bumpTokenVersion(auth.user.id);
    await this.sessions.revokeAllForUser(auth.user.id, 'logout_all');
  }

  async changePassword(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const rows = (await this.dataSource.query('SELECT password_hash FROM users WHERE id = $1', [
      auth.user.id,
    ])) as { password_hash: string }[];
    const current = rows[0];
    if (!current) throw new AppError(ERROR_CODES.notFound, 'Pengguna tidak ditemukan', 404);

    const ok = await compare(currentPassword, current.password_hash);
    if (!ok) {
      throw new AppError(ERROR_CODES.invalidCredentials, 'Kata sandi saat ini salah', 401);
    }

    const newHash = await hash(newPassword, BCRYPT_ROUNDS);
    await this.dataSource.query(
      'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1',
      [auth.user.id, newHash],
    );
    await this.bumpTokenVersion(auth.user.id);
    await this.sessions.revokeAllForUser(auth.user.id, 'password_changed');
  }

  async updateProfile(
    auth: AuthContext,
    input: { displayName?: string; locale?: string; theme?: ThemePreference },
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [auth.user.id];
    if (input.displayName !== undefined) {
      params.push(input.displayName.trim());
      sets.push(`display_name = $${params.length}`);
    }
    if (input.locale !== undefined) {
      params.push(input.locale);
      sets.push(`locale = $${params.length}`);
    }
    if (input.theme !== undefined) {
      params.push(input.theme);
      sets.push(`theme = $${params.length}`);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = now()');
    await this.dataSource.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  private async assembleMe(
    userId: string,
    session: AuthSession,
    allowedIdentifiersSet: Iterable<string>,
  ): Promise<MeDto> {
    const rows = (await this.dataSource.query(
      `SELECT u.email, u.display_name, u.is_superadmin, u.department_id,
              d.name AS department_name, u.locale, u.theme
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = $1`,
      [userId],
    )) as ProfileRow[];
    const row = rows[0];
    if (!row) throw new AppError(ERROR_CODES.notFound, 'Pengguna tidak ditemukan', 404);

    return {
      user: {
        id: userId,
        email: row.email,
        displayName: row.display_name,
        departmentId: row.department_id,
        departmentName: row.department_name,
        isSuperadmin: row.is_superadmin,
      },
      permissions: [...allowedIdentifiersSet].sort(),
      csrfToken: session.csrfSecret,
      preferences: { theme: row.theme as ThemePreference, locale: row.locale },
      session: {
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      },
    };
  }

  private async bumpTokenVersion(userId: string): Promise<void> {
    await this.dataSource.query(
      'UPDATE users SET token_version = token_version + 1, updated_at = now() WHERE id = $1',
      [userId],
    );
  }

  private async sessionAbsoluteHours(): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT value FROM app_config WHERE key = 'security.session_absolute_hours'`,
    )) as { value: unknown }[];
    const value = rows[0]?.value;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_ABSOLUTE_HOURS;
  }
}
