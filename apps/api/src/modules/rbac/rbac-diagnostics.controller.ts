import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  allowedIdentifiers,
  type DecisionChainEntry,
} from './policy-engine';
import type { AuthContext } from '../../common/types/auth-context';

interface DecisionView {
  permission: string;
  allowed: boolean;
  reason: string;
  scope: string | null;
  chain: DecisionChainEntry[];
}

@ApiTags('rbac')
@Controller('rbac/diagnostics')
export class RbacDiagnosticsController {
  @RequirePermission(PERMISSIONS.adminAccess)
  @Get('summary')
  summary(@CurrentAuth() auth: AuthContext) {
    const decisions = [...auth.effective.decisions.values()];
    return {
      userId: auth.user.id,
      isSuperadmin: auth.user.isSuperadmin,
      totalPermissions: decisions.length,
      allowedCount: allowedIdentifiers(auth.effective.decisions).size,
      deniedCount: decisions.filter((d) => !d.allowed).length,
    };
  }

  @RequirePermission(PERMISSIONS.effectiveInspect)
  @Get('effective-permissions')
  effectivePermissions(@CurrentAuth() auth: AuthContext) {
    const decisions: DecisionView[] = [...auth.effective.decisions.values()]
      .map((d) => ({
        permission: d.permission,
        allowed: d.allowed,
        reason: d.reason,
        scope: d.scope,
        chain: d.chain,
      }))
      .sort((a, b) => a.permission.localeCompare(b.permission));
    return {
      user: {
        id: auth.user.id,
        email: auth.user.email,
        displayName: auth.user.displayName,
        isSuperadmin: auth.user.isSuperadmin,
        departmentId: auth.user.departmentId,
      },
      allowed: [...auth.effective.allowed].sort(),
      decisions,
    };
  }
}
