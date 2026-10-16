import { apiGet, apiGetPaged, apiPost, type PaginatedResult } from '@/api/http';
import type { PagedQuery } from '@/composables/usePagedList';
import type { AdminAuditRow, AuthzTestResponse, EffectivePermissionsResponse } from './types';

export function getEffectivePermissions(userId: string): Promise<EffectivePermissionsResponse> {
  return apiGet<EffectivePermissionsResponse>(`/admin/diagnostics/users/${userId}/effective-permissions`);
}

export interface AuthzTestPayload {
  userId: string;
  permission: string;
  resourceType?: string;
  resourceId?: string;
  resourceOwnerId?: string;
}

export function runAuthzTest(payload: AuthzTestPayload): Promise<AuthzTestResponse> {
  return apiPost<AuthzTestResponse>('/admin/diagnostics/authz-test', payload);
}

export function listAuditEvents(query: PagedQuery): Promise<PaginatedResult<AdminAuditRow>> {
  return apiGetPaged<AdminAuditRow>('/admin/audit-events', query);
}
