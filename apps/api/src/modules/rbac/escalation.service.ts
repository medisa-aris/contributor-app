import { Injectable } from '@nestjs/common';
import type { DataScope } from '@contributor/shared';
import { DATA_SCOPE_REACH } from '@contributor/shared';
import { EffectivePermissionsService } from './effective-permissions.service';

export interface EscalationViolation {
  code: string;
  detail: string;
}

export const ESCALATION_CODES = {
  selfModification: 'self_modification',
  systemRoleRequiresSuperadmin: 'system_role_requires_superadmin',
  permissionSubset: 'permission_subset',
  scopeExceeded: 'scope_exceeded',
  lastSuperadmin: 'last_superadmin',
} as const;

export interface ActorSummary {
  userId: string;
  isSuperadmin: boolean;
  hasPermission: (permission: string) => boolean;
  scopeFor: (permission: string) => DataScope | null;
}

export interface GrantIntent {
  subjectIsSelf: boolean;
  roleCode: string;
  roleIsSystem: boolean;
  rolePermissions: string[];
  dataScope: DataScope;
}

/**
 * Aturan anti-escalation: aktor non-superadmin hanya boleh memberikan/mencabut
 * assignment role yang seluruh izinnya ia miliki, dengan scope tidak melebihi
 * scope-nya sendiri; role sistem administrator hanya oleh superadmin; dan
 * tidak boleh mengubah assignment milik sendiri.
 */
export function checkRoleGrant(actor: ActorSummary, intent: GrantIntent): EscalationViolation[] {
  const violations: EscalationViolation[] = [];

  if (intent.subjectIsSelf) {
    violations.push({
      code: ESCALATION_CODES.selfModification,
      detail: 'Tidak boleh mengubah assignment role milik sendiri',
    });
  }
  if (actor.isSuperadmin) return violations;

  if (intent.roleIsSystem && intent.roleCode === 'administrator') {
    violations.push({
      code: ESCALATION_CODES.systemRoleRequiresSuperadmin,
      detail: 'Hanya superadmin yang dapat memberikan role administrator',
    });
  }

  for (const permission of intent.rolePermissions) {
    if (!actor.hasPermission(permission)) {
      violations.push({
        code: ESCALATION_CODES.permissionSubset,
        detail: `Anda tidak memiliki izin ${permission}`,
      });
      continue;
    }
    const actorScope = actor.scopeFor(permission) ?? 'own';
    if (DATA_SCOPE_REACH[intent.dataScope] > DATA_SCOPE_REACH[actorScope]) {
      violations.push({
        code: ESCALATION_CODES.scopeExceeded,
        detail: `Scope ${intent.dataScope} melebihi scope Anda (${actorScope}) untuk izin ${permission}`,
      });
    }
  }

  return violations;
}

export function checkLastSuperadmin(
  targetIsSuperadmin: boolean,
  activeSuperadmins: number,
  removingPrivilege: boolean,
): EscalationViolation[] {
  if (targetIsSuperadmin && removingPrivilege && activeSuperadmins <= 1) {
    return [
      {
        code: ESCALATION_CODES.lastSuperadmin,
        detail: 'Superadmin terakhir tidak dapat dinonaktifkan atau dicabut haknya',
      },
    ];
  }
  return [];
}

@Injectable()
export class EscalationService {
  constructor(private readonly effective: EffectivePermissionsService) {}

  async checkGrant(actorUserId: string, intent: GrantIntent): Promise<EscalationViolation[]> {
    const access = await this.effective.resolve(actorUserId);
    const actor: ActorSummary = {
      userId: actorUserId,
      isSuperadmin: access.isSuperadmin,
      hasPermission: (permission) => access.decisions.get(permission)?.allowed ?? false,
      scopeFor: (permission) => access.decisions.get(permission)?.scope ?? null,
    };
    return checkRoleGrant(actor, intent);
  }
}
