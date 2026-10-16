import { apiDelete, apiGet, apiGetPaged, apiPatch, apiPost, apiPut, type PaginatedResult } from '@/api/http';
import type { PagedQuery } from '@/composables/usePagedList';
import type {
  AdminConfigEntry,
  AdminNavApplication,
  AdminNavFeature,
  AdminNavMenuItem,
  AdminNavModule,
  AdminNavTree,
  AdminProvidersOverview,
  AdminSessionRow,
  NavLevel,
} from './types';

export function listConfig(): Promise<AdminConfigEntry[]> {
  return apiGet<AdminConfigEntry[]>('/admin/config');
}

export function updateConfig(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
  return apiPut<{ key: string; value: unknown }>(`/admin/config/${encodeURIComponent(key)}`, { value });
}

export function listSessions(query: PagedQuery): Promise<PaginatedResult<AdminSessionRow>> {
  return apiGetPaged<AdminSessionRow>('/admin/sessions', query);
}

export function revokeSession(id: string): Promise<unknown> {
  return apiDelete(`/admin/sessions/${id}`);
}

export function getProviders(): Promise<AdminProvidersOverview> {
  return apiGet<AdminProvidersOverview>('/admin/providers');
}

export function getAdminNavTree(): Promise<AdminNavTree> {
  return apiGet<AdminNavTree>('/admin/nav/tree');
}

export interface NavApplicationPayload {
  identifier: string;
  name: string;
  icon?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export function createNavApplication(payload: NavApplicationPayload): Promise<AdminNavApplication> {
  return apiPost<AdminNavApplication>('/admin/nav/applications', payload);
}

export function updateNavApplication(
  id: string,
  payload: Partial<NavApplicationPayload>,
): Promise<AdminNavApplication> {
  return apiPatch<AdminNavApplication>(`/admin/nav/applications/${id}`, payload);
}

export function deleteNavApplication(id: string): Promise<unknown> {
  return apiDelete(`/admin/nav/applications/${id}`);
}

export interface NavModulePayload {
  applicationId: string;
  parentId?: string | null;
  identifier: string;
  name: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export function createNavModule(payload: NavModulePayload): Promise<AdminNavModule> {
  return apiPost<AdminNavModule>('/admin/nav/modules', payload);
}

export function updateNavModule(id: string, payload: Partial<NavModulePayload>): Promise<AdminNavModule> {
  return apiPatch<AdminNavModule>(`/admin/nav/modules/${id}`, payload);
}

export function deleteNavModule(id: string): Promise<unknown> {
  return apiDelete(`/admin/nav/modules/${id}`);
}

export interface NavFeaturePayload {
  moduleId: string;
  identifier: string;
  name: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export function createNavFeature(payload: NavFeaturePayload): Promise<AdminNavFeature> {
  return apiPost<AdminNavFeature>('/admin/nav/features', payload);
}

export function updateNavFeature(id: string, payload: Partial<NavFeaturePayload>): Promise<AdminNavFeature> {
  return apiPatch<AdminNavFeature>(`/admin/nav/features/${id}`, payload);
}

export function deleteNavFeature(id: string): Promise<unknown> {
  return apiDelete(`/admin/nav/features/${id}`);
}

export interface NavMenuItemPayload {
  key: string;
  applicationId: string;
  moduleId?: string | null;
  featureId?: string | null;
  parentId?: string | null;
  labelDefault: string;
  i18nKey?: string;
  icon?: string;
  routePath?: string;
  requiredPermission?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  isFuture?: boolean;
}

export function createNavMenuItem(payload: NavMenuItemPayload): Promise<AdminNavMenuItem> {
  return apiPost<AdminNavMenuItem>('/admin/nav/menu-items', payload);
}

export function updateNavMenuItem(
  id: string,
  payload: Partial<NavMenuItemPayload>,
): Promise<AdminNavMenuItem> {
  return apiPatch<AdminNavMenuItem>(`/admin/nav/menu-items/${id}`, payload);
}

export function deleteNavMenuItem(id: string): Promise<unknown> {
  return apiDelete(`/admin/nav/menu-items/${id}`);
}

export function reorderNav(items: { id: string; type: NavLevel; sortOrder: number }[]): Promise<unknown> {
  return apiPut('/admin/nav/reorder', { items });
}
