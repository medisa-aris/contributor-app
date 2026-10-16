import { apiDelete, apiGet, apiGetPaged, apiPatch, apiPost, apiPut, type PaginatedResult } from '@/api/http';
import type { PagedQuery } from '@/composables/usePagedList';
import type {
  AdminDataScope,
  AdminDepartmentNode,
  AdminGroupDetail,
  AdminGroupRow,
  AdminPermissionRow,
  AdminPolicyRow,
  AdminRoleRow,
  AdminUserDetail,
  AdminUserRow,
  PolicyEffect,
  PolicySubjectType,
} from './types';

export function listUsers(query: PagedQuery): Promise<PaginatedResult<AdminUserRow>> {
  return apiGetPaged<AdminUserRow>('/admin/users', query);
}

export function getUser(id: string): Promise<AdminUserDetail> {
  return apiGet<AdminUserDetail>(`/admin/users/${id}`);
}

export interface CreateUserPayload {
  email: string;
  displayName: string;
  password: string;
  departmentId?: string | null;
  isSuperadmin?: boolean;
}

export function createUser(payload: CreateUserPayload): Promise<AdminUserDetail> {
  return apiPost<AdminUserDetail>('/admin/users', payload);
}

export interface UpdateUserPayload {
  displayName?: string;
  departmentId?: string | null;
  status?: 'active' | 'disabled';
  isSuperadmin?: boolean;
}

export function updateUser(id: string, payload: UpdateUserPayload): Promise<AdminUserDetail> {
  return apiPatch<AdminUserDetail>(`/admin/users/${id}`, payload);
}

export function resetUserPassword(id: string, newPassword: string): Promise<{ reset: boolean }> {
  return apiPost<{ reset: boolean }>(`/admin/users/${id}/password`, { newPassword });
}

export interface AssignRolePayload {
  roleId: string;
  dataScope: AdminDataScope;
  departmentId?: string | null;
}

export function assignUserRole(userId: string, payload: AssignRolePayload): Promise<unknown> {
  return apiPost(`/admin/users/${userId}/roles`, payload);
}

export function revokeUserRole(userId: string, assignmentId: string): Promise<unknown> {
  return apiDelete(`/admin/users/${userId}/roles/${assignmentId}`);
}

export function listRoles(): Promise<AdminRoleRow[]> {
  return apiGet<AdminRoleRow[]>('/admin/roles');
}

export function getRolePermissions(id: string): Promise<string[]> {
  return apiGet<string[]>(`/admin/roles/${id}/permissions`);
}

export function createRole(payload: { code: string; name: string; description?: string }): Promise<AdminRoleRow> {
  return apiPost<AdminRoleRow>('/admin/roles', payload);
}

export function updateRole(
  id: string,
  payload: { name?: string; description?: string },
): Promise<AdminRoleRow> {
  return apiPatch<AdminRoleRow>(`/admin/roles/${id}`, payload);
}

export function deleteRole(id: string): Promise<unknown> {
  return apiDelete(`/admin/roles/${id}`);
}

export function replaceRolePermissions(id: string, permissions: string[]): Promise<unknown> {
  return apiPut(`/admin/roles/${id}/permissions`, { permissions });
}

export function listGroups(): Promise<AdminGroupRow[]> {
  return apiGet<AdminGroupRow[]>('/admin/groups');
}

export function getGroup(id: string): Promise<AdminGroupDetail> {
  return apiGet<AdminGroupDetail>(`/admin/groups/${id}`);
}

export function createGroup(payload: { code: string; name: string; description?: string }): Promise<AdminGroupRow> {
  return apiPost<AdminGroupRow>('/admin/groups', payload);
}

export function updateGroup(
  id: string,
  payload: { name?: string; description?: string },
): Promise<AdminGroupRow> {
  return apiPatch<AdminGroupRow>(`/admin/groups/${id}`, payload);
}

export function deleteGroup(id: string): Promise<unknown> {
  return apiDelete(`/admin/groups/${id}`);
}

export function addGroupMembers(id: string, userIds: string[]): Promise<unknown> {
  return apiPost(`/admin/groups/${id}/members`, { userIds });
}

export function removeGroupMember(id: string, userId: string): Promise<unknown> {
  return apiDelete(`/admin/groups/${id}/members/${userId}`);
}

export function assignGroupRole(groupId: string, payload: AssignRolePayload): Promise<unknown> {
  return apiPost(`/admin/groups/${groupId}/roles`, payload);
}

export function revokeGroupRole(groupId: string, assignmentId: string): Promise<unknown> {
  return apiDelete(`/admin/groups/${groupId}/roles/${assignmentId}`);
}

export function listDepartments(): Promise<AdminDepartmentNode[]> {
  return apiGet<AdminDepartmentNode[]>('/admin/departments');
}

export function createDepartment(payload: {
  name: string;
  code: string;
  parentId?: string | null;
}): Promise<AdminDepartmentNode> {
  return apiPost<AdminDepartmentNode>('/admin/departments', payload);
}

export function updateDepartment(
  id: string,
  payload: { name?: string; code?: string; parentId?: string | null },
): Promise<AdminDepartmentNode> {
  return apiPatch<AdminDepartmentNode>(`/admin/departments/${id}`, payload);
}

export function deleteDepartment(id: string): Promise<unknown> {
  return apiDelete(`/admin/departments/${id}`);
}

export function listPolicies(): Promise<AdminPolicyRow[]> {
  return apiGet<AdminPolicyRow[]>('/admin/policies');
}

export interface PolicyPayload {
  name: string;
  effect: PolicyEffect;
  subjectType: PolicySubjectType;
  subjectId: string;
  permissionPattern: string;
  resourceType?: string | null;
  resourceId?: string | null;
  priority?: number;
  isActive?: boolean;
}

export function createPolicy(payload: PolicyPayload): Promise<AdminPolicyRow> {
  return apiPost<AdminPolicyRow>('/admin/policies', payload);
}

export function updatePolicy(
  id: string,
  payload: Partial<Pick<PolicyPayload, 'name' | 'priority' | 'isActive' | 'resourceType' | 'resourceId'>>,
): Promise<AdminPolicyRow> {
  return apiPatch<AdminPolicyRow>(`/admin/policies/${id}`, payload);
}

export function deletePolicy(id: string): Promise<unknown> {
  return apiDelete(`/admin/policies/${id}`);
}

export function listPermissions(): Promise<AdminPermissionRow[]> {
  return apiGet<AdminPermissionRow[]>('/admin/permissions');
}

export function syncPermissions(): Promise<{ added: number; total: number }> {
  return apiPost<{ added: number; total: number }>('/admin/permissions/sync');
}
