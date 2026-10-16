import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CSRF_EXEMPT_KEY } from '../../common/decorators/csrf-exempt.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { CsrfService } from './csrf.service';
import { safeCompare } from './session.service';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly csrf: CsrfService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(CSRF_EXEMPT_KEY, meta)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, meta)) return true;

    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    if (this.csrf.isSafeMethod(request.method)) return true;

    const auth = request.auth;
    if (!auth) {
      throw new AppError(ERROR_CODES.unauthenticated, 'Silakan login terlebih dahulu', 401);
    }

    const headerValue = request.headers[this.csrf.headerName];
    const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof token !== 'string' || !safeCompare(token, auth.session.csrfSecret)) {
      throw new AppError(ERROR_CODES.csrfInvalid, 'Token CSRF tidak valid', 403);
    }
    return true;
  }
}
