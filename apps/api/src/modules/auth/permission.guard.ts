import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import {
  REQUIRE_PERMISSIONS_KEY,
  type RequiredPermissions,
} from '../../common/decorators/require-permission.decorator';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';

/**
 * Enforces @RequirePermission metadata against the effective permissions resolved
 * by SessionAuthGuard. Routes without metadata stay reachable for any authenticated
 * session; resource-scoped (ownership) decisions belong to the service layer.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermissions | undefined>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.ids.length === 0) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const auth = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>().auth;
    if (!auth) {
      throw new AppError(ERROR_CODES.unauthenticated, 'Sesi tidak ditemukan.', 401);
    }

    const missing =
      required.mode === 'all'
        ? required.ids.filter((id) => !auth.effective.allowed.has(id))
        : required.ids.some((id) => auth.effective.allowed.has(id))
          ? []
          : required.ids;

    if (missing.length > 0) {
      throw new AppError(
        ERROR_CODES.forbidden,
        'Anda tidak memiliki izin untuk mengakses sumber daya ini.',
        403,
        { required: required.ids, mode: required.mode, missing },
      );
    }
    return true;
  }
}
