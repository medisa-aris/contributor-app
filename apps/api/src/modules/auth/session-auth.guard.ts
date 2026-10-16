import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { allowedIdentifiers } from '../rbac/policy-engine';
import { SessionService } from './session.service';

const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
    private readonly effective: EffectivePermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { auth?: AuthContext }>();
    const cookieName = this.config.get<string>('app.sessionCookieName') ?? 'ca_session';
    const rawToken: unknown = request.cookies?.[cookieName];
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new AppError(ERROR_CODES.unauthenticated, 'Silakan login terlebih dahulu', 401);
    }

    const session = await this.sessions.findByToken(rawToken);
    if (!session || session.revoked_at !== null) {
      throw new AppError(ERROR_CODES.unauthenticated, 'Sesi tidak valid atau telah berakhir', 401);
    }
    if (session.expires_at.getTime() <= Date.now()) {
      throw new AppError(ERROR_CODES.unauthenticated, 'Sesi telah berakhir', 401);
    }
    if (session.token_version_snapshot !== session.token_version) {
      throw new AppError(ERROR_CODES.unauthenticated, 'Sesi telah dicabut', 401);
    }
    if (session.status !== 'active') {
      throw new AppError(ERROR_CODES.accountDisabled, 'Akun ini dinonaktifkan', 403);
    }

    const access = await this.effective.resolve(session.user_id);
    request.auth = {
      user: {
        id: session.user_id,
        email: session.email,
        displayName: session.display_name,
        isSuperadmin: session.is_superadmin,
        departmentId: session.department_id,
        tokenVersion: session.token_version,
        status: session.status as 'active' | 'disabled',
      },
      session: {
        id: session.id,
        csrfSecret: session.csrf_secret,
        ip: session.ip,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
      },
      effective: {
        allowed: allowedIdentifiers(access.decisions),
        decisions: access.decisions,
      },
    };

    if (Date.now() - session.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
      await this.sessions.touch(session.id);
    }
    return true;
  }
}
