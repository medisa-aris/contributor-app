import type { DataScope, PolicyEffect, PolicySubjectType } from '../enums';

export interface PermissionDto {
  id: string;
  identifier: string;
  name: string;
  description: string | null;
  application: string | null;
  module: string | null;
}

export interface RoleSummaryDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
  assignmentCount: number;
  createdAt: string;
}

export interface RoleDetailDto extends RoleSummaryDto {
  permissions: PermissionDto[];
}

export interface PolicyDto {
  id: string;
  name: string;
  effect: PolicyEffect;
  subjectType: PolicySubjectType;
  subjectId: string;
  subjectLabel: string;
  permissionPattern: string;
  resourceType: string | null;
  resourceId: string | null;
  conditions: Record<string, unknown>;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveChainEntryDto {
  source: string;
  sourceType: 'user_role' | 'group_role' | 'policy' | 'superadmin';
  effect: PolicyEffect;
  pattern: string;
  scope: DataScope | null;
  specificity: string;
}

export interface EffectiveDecisionDto {
  permissionId: string;
  allowed: boolean;
  effect: PolicyEffect | 'default_deny';
  scope: DataScope | null;
  departmentId: string | null;
  chain: EffectiveChainEntryDto[];
}

export interface AuthzTestRequestDto {
  userId: string;
  permissionId: string;
  resourceType?: string;
  resourceId?: string;
}

export interface AuthzTestResultDto {
  allowed: boolean;
  decision: EffectiveDecisionDto;
  evaluatedAt: string;
}
