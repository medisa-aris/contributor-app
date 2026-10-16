import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSIONS_KEY = 'requirePermissions';

export interface RequiredPermissions {
  ids: string[];
  mode: 'all' | 'any';
}

/** Route requires every listed permission (deny-by-default applies when metadata is absent). */
export const RequirePermission = (...ids: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, { ids, mode: 'all' } satisfies RequiredPermissions);

/** Route requires at least one of the listed permissions. */
export const RequireAnyPermission = (...ids: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, { ids, mode: 'any' } satisfies RequiredPermissions);
