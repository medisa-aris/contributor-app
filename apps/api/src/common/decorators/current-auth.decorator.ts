import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../types/auth-context';

/** Injects the server-validated auth context (never trust client-supplied identity). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext =>
    ctx.switchToHttp().getRequest<Request & { auth: AuthContext }>().auth,
);
