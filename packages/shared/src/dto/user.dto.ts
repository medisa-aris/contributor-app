import type { DataScope, UserStatus } from '../enums';

export interface UserSummaryDto {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  departmentId: string | null;
  departmentName: string | null;
  isSuperadmin: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}

export interface RoleAssignmentDto {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  dataScope: DataScope;
  departmentId: string | null;
  departmentName: string | null;
  source: 'user' | 'group';
  groupId: string | null;
  groupName: string | null;
  createdAt: string;
}

export interface GroupSummaryDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  memberCount: number;
  roleCount: number;
  createdAt: string;
}

export interface GroupDetailDto extends GroupSummaryDto {
  members: Array<{ id: string; email: string; displayName: string; departmentName: string | null }>;
  roleAssignments: RoleAssignmentDto[];
}

export interface DepartmentDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parentId: string | null;
  isActive: boolean;
  userCount: number;
  createdAt: string;
}

export interface DepartmentTreeNodeDto extends DepartmentDto {
  children: DepartmentTreeNodeDto[];
}
