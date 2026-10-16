import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS } from '@contributor/shared';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SessionService } from './session.service';

const CSRF_COOKIE = 'ca_csrf';
const LOGIN_RATE_LIMIT = Number(process.env.LOGIN_RATE_LIMIT ?? '10');

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? null;
  }
  return req.ip ?? null;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @CsrfExempt()
  @Throttle({ default: { limit: LOGIN_RATE_LIMIT, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const result = await this.auth.login(
      dto.email,
      dto.password,
      clientIp(req),
      req.headers['user-agent'] ?? null,
    );
    this.setAuthCookies(res, result.rawToken, result.csrfSecret, result.expiresAt);
    return result.me;
  }

  @Audit(AUDIT_EVENTS.authLogout)
  @HttpCode(200)
  @Post('logout')
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ loggedOut: boolean }> {
    await this.auth.logout(auth);
    this.clearCookies(res);
    return { loggedOut: true };
  }

  @Audit(AUDIT_EVENTS.authLogoutAll, 'warn')
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ loggedOut: boolean }> {
    await this.auth.logoutAll(auth);
    this.clearCookies(res);
    return { loggedOut: true };
  }

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.auth.buildMe(auth);
  }

  @Patch('profile')
  async updateProfile(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateProfileDto,
  ): Promise<unknown> {
    await this.auth.updateProfile(auth, dto);
    return this.auth.buildMe(auth);
  }

  @Audit(AUDIT_EVENTS.authPasswordChanged, 'critical')
  @HttpCode(200)
  @Post('password')
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ changed: boolean }> {
    await this.auth.changePassword(auth, dto.currentPassword, dto.newPassword);
    this.clearCookies(res);
    return { changed: true };
  }

  @Get('sessions')
  async listSessions(@CurrentAuth() auth: AuthContext): Promise<unknown[]> {
    const rows = await this.sessions.listActiveForUser(auth.user.id);
    return rows.map((row) => ({
      id: row.id,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      current: row.id === auth.session.id,
    }));
  }

  @Audit(AUDIT_EVENTS.authSessionRevoked)
  @Delete('sessions/:id')
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<{ revoked: boolean }> {
    const revoked = await this.sessions.revokeOwned(id, auth.user.id, 'revoked_by_user');
    if (!revoked) {
      throw new AppError(ERROR_CODES.notFound, 'Sesi tidak ditemukan.', 404);
    }
    return { revoked: true };
  }

  private setAuthCookies(res: Response, token: string, csrf: string, expiresAt: Date): void {
    const secure = this.config.get<boolean>('app.cookieSecure') ?? false;
    const cookieName = this.config.get<string>('app.sessionCookieName') ?? 'ca_session';
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      expires: expiresAt,
    });
    res.cookie(CSRF_COOKIE, csrf, {
      httpOnly: false,
      sameSite: 'lax',
      secure,
      path: '/',
      expires: expiresAt,
    });
  }

  private clearCookies(res: Response): void {
    const cookieName = this.config.get<string>('app.sessionCookieName') ?? 'ca_session';
    res.clearCookie(cookieName, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }
}
