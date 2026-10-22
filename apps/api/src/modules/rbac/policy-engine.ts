import type { DataScope, PolicyEffect, PolicySubjectType } from '@bara/shared';
import { DATA_SCOPE_REACH, matchesPermissionPattern } from '@bara/shared';

export interface PolicyAssignment {
  source: 'user' | 'group';
  sourceId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  dataScope: DataScope;
  departmentId: string | null;
}

export interface PolicyRecord {
  id: string;
  name: string;
  effect: PolicyEffect;
  subjectType: PolicySubjectType;
  subjectId: string;
  permissionPattern: string;
  resourceType: string | null;
  resourceId: string | null;
  priority: number;
  conditions: Record<string, unknown>;
}

export interface PolicyInput {
  userId: string;
  groupIds: string[];
  isSuperadmin: boolean;
  assignments: PolicyAssignment[];
  rolePermissions: Map<string, string[]>;
  policies: PolicyRecord[];
}

export interface ResourceContext {
  resourceType?: string | null;
  resourceId?: string | null;
  resourceOwnerId?: string | null;
}

export type DecisionReason =
  | 'superadmin'
  | 'role_grant'
  | 'no_role_grant'
  | 'policy_deny'
  | 'ownership_required';

export interface DecisionChainEntry {
  kind: 'role' | 'policy' | 'superadmin';
  label: string;
  effect: 'allow' | 'deny' | 'info';
  detail: string;
}

export interface EffectiveDecision {
  allowed: boolean;
  permission: string;
  reason: DecisionReason;
  scope: DataScope | null;
  chain: DecisionChainEntry[];
}

function matchesSubject(policy: PolicyRecord, input: PolicyInput): boolean {
  if (policy.subjectType === 'user') return policy.subjectId === input.userId;
  if (policy.subjectType === 'group') return input.groupIds.includes(policy.subjectId);
  return input.assignments.some((a) => a.roleId === policy.subjectId);
}

function matchesResource(policy: PolicyRecord, ctx: ResourceContext): boolean {
  if (policy.resourceType === null && policy.resourceId === null) return true;
  if (ctx.resourceType == null || ctx.resourceId == null) return false;
  const typeOk = policy.resourceType === null || policy.resourceType === ctx.resourceType;
  const idOk =
    policy.resourceId === null || policy.resourceId === '*' || policy.resourceId === ctx.resourceId;
  return typeOk && idOk;
}

function widestScope(assignments: PolicyAssignment[]): DataScope {
  let best: DataScope = 'own';
  let bestReach = -1;
  for (const a of assignments) {
    const reach = DATA_SCOPE_REACH[a.dataScope];
    if (reach > bestReach) {
      bestReach = reach;
      best = a.dataScope;
    }
  }
  return best;
}

/**
 * Deny-by-default. Explicit DENY selalu menimpa ALLOW pada tingkat resource yang sama;
 * priority hanya mengurutkan tampilan rantai keputusan. Role bawaan sistem tidak
 * melewati pemeriksaan policy (hanya superadmin yang bypass).
 */
export function evaluatePermission(
  input: PolicyInput,
  permission: string,
  ctx: ResourceContext = {},
): EffectiveDecision {
  if (input.isSuperadmin) {
    return {
      allowed: true,
      permission,
      reason: 'superadmin',
      scope: 'global',
      chain: [
        {
          kind: 'superadmin',
          label: 'Superadmin',
          effect: 'allow',
          detail: 'Akun superadmin melewati pemeriksaan izin',
        },
      ],
    };
  }

  const chain: DecisionChainEntry[] = [];
  const granting = input.assignments.filter((a) =>
    (input.rolePermissions.get(a.roleId) ?? []).includes(permission),
  );

  if (granting.length === 0) {
    chain.push({
      kind: 'role',
      label: 'Grant role',
      effect: 'info',
      detail: `Tidak ada role yang memberikan izin ${permission}`,
    });
    return { allowed: false, permission, reason: 'no_role_grant', scope: null, chain };
  }

  const scope = widestScope(granting);
  chain.push({
    kind: 'role',
    label: 'Grant role',
    effect: 'allow',
    detail: `${granting.length} assignment role memberikan ${permission} (scope terluas: ${scope})`,
  });

  const subjectPolicies = input.policies.filter(
    (p) => matchesSubject(p, input) && matchesPermissionPattern(p.permissionPattern, permission),
  );
  const resourcePolicies = subjectPolicies.filter((p) => matchesResource(p, ctx));

  const deny = resourcePolicies
    .filter((p) => p.effect === 'deny')
    .sort((a, b) => b.priority - a.priority)[0];
  if (deny) {
    chain.push({
      kind: 'policy',
      label: deny.name,
      effect: 'deny',
      detail: `Policy deny (${deny.permissionPattern}) menimpa semua allow`,
    });
    return { allowed: false, permission, reason: 'policy_deny', scope, chain };
  }

  const allows = resourcePolicies
    .filter((p) => p.effect === 'allow')
    .sort((a, b) => b.priority - a.priority);
  for (const p of allows) {
    if (p.conditions['ownership'] === true && ctx.resourceOwnerId !== input.userId) {
      chain.push({
        kind: 'policy',
        label: p.name,
        effect: 'deny',
        detail: 'Policy mensyaratkan kepemilikan resource (ownership) dan tidak terpenuhi',
      });
      return { allowed: false, permission, reason: 'ownership_required', scope, chain };
    }
    chain.push({
      kind: 'policy',
      label: p.name,
      effect: 'allow',
      detail: `Policy allow (${p.permissionPattern}) cocok`,
    });
  }

  return { allowed: true, permission, reason: 'role_grant', scope, chain };
}

export function evaluateAll(
  input: PolicyInput,
  permissions: readonly string[],
): Map<string, EffectiveDecision> {
  const map = new Map<string, EffectiveDecision>();
  for (const permission of permissions) {
    map.set(permission, evaluatePermission(input, permission));
  }
  return map;
}

export function allowedIdentifiers(decisions: Map<string, EffectiveDecision>): Set<string> {
  const set = new Set<string>();
  for (const [identifier, decision] of decisions) {
    if (decision.allowed) set.add(identifier);
  }
  return set;
}
