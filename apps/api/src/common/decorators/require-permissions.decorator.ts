import { SetMetadata } from '@nestjs/common';
import type { PermissionId } from '@bara/shared';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

export interface RequiredPermissionsMeta {
  permissions: PermissionId[];
  mode: 'all' | 'any';
}

/** Declares the permission identifiers required to call a route (deny-by-default otherwise). */
export const RequirePermissions = (
  permissions: PermissionId[],
  mode: 'all' | 'any' = 'all',
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, { permissions, mode } satisfies RequiredPermissionsMeta);
