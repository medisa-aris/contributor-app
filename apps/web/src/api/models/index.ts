import type {
  AiModelDto,
  AiProviderCode,
  AiProviderStatusDto,
  DefaultModelLimitsDto,
  GrantTarget,
  ModelGrantDto,
  ModelTestResultDto,
  QuotaPeriod,
  ReachDto,
  UserModelDto,
  UserModelsResponseDto,
} from '@bara/shared';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/api/http';

export type {
  AiModelDto,
  AiProviderCode,
  AiProviderStatusDto,
  DefaultModelLimitsDto,
  GrantTarget,
  ModelGrantDto,
  ModelTestResultDto,
  QuotaPeriod,
  ReachDto,
  UserModelDto,
  UserModelsResponseDto,
};

// ── Admin: penyedia (baca saja) dan katalog ──
export const listProviders = () => apiGet<AiProviderStatusDto[]>('/admin/ai/providers');
export const checkProvider = (code: AiProviderCode) =>
  apiPost<AiProviderStatusDto['lastCheck']>(`/admin/ai/providers/${code}/check`);
export const listCatalog = () => apiGet<AiModelDto[]>('/admin/ai/models');
export const addModels = (items: { provider: AiProviderCode; modelKey: string; displayName?: string; description?: string }[]) =>
  apiPost<AiModelDto[]>('/admin/ai/models', { items });
export const updateModel = (id: string, patch: Partial<AiModelDto>) => apiPatch<AiModelDto>(`/admin/ai/models/${id}`, patch);
export const testModel = (id: string, vision = false) =>
  apiPost<ModelTestResultDto>(`/admin/ai/models/${id}/test`, { vision });
export const enableModel = (id: string) => apiPost<AiModelDto>(`/admin/ai/models/${id}/enable`);
export const disableModel = (id: string) => apiPost<AiModelDto>(`/admin/ai/models/${id}/disable`);
export const setDefaultModel = (id: string) => apiPost<AiModelDto>(`/admin/ai/models/${id}/default`, { confirm: true });
export const deleteModel = (id: string) => apiDelete<void>(`/admin/ai/models/${id}`);
export const getDefaultLimits = () => apiGet<DefaultModelLimitsDto>('/admin/ai/default-model-limits');
export const saveDefaultLimits = (limits: DefaultModelLimitsDto) =>
  apiPut<DefaultModelLimitsDto>('/admin/ai/default-model-limits', limits);

// ── Izin model (admin & leader) ──
export interface GrantInput {
  targetType: GrantTarget;
  targetId: string | null;
  includeSubDepartments?: boolean;
  modelId: string;
  tokenLimit: number | null;
  period: QuotaPeriod;
  note?: string | null;
}
export const listGrants = () => apiGet<ModelGrantDto[]>('/ai/model-grants');
export const createGrant = (input: GrantInput) => apiPost<ModelGrantDto>('/ai/model-grants', input);
export const updateGrant = (id: string, patch: Partial<Pick<GrantInput, 'tokenLimit' | 'period' | 'includeSubDepartments' | 'note'>>) =>
  apiPatch<ModelGrantDto>(`/ai/model-grants/${id}`, patch);
export const deleteGrant = (id: string) => apiDelete<void>(`/ai/model-grants/${id}`);
export const grantReach = () => apiGet<ReachDto>('/ai/model-grants/reach');
export const grantableModels = () => apiGet<AiModelDto[]>('/ai/model-grants/grantable-models');
export const effectiveModels = (userId: string) => apiGet<UserModelDto[]>('/ai/model-grants/effective', { userId });

// ── Pengguna ──
export const myModels = () => apiGet<UserModelsResponseDto>('/ai/models');
export const setPreferredModel = (modelId: string | null) => apiPut<{ modelId: string | null }>('/ai/preferences/model', { modelId });

/** Angka token ringkas: 32 rb, 1,2 jt. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (value >= 10_000) return `${Math.round(value / 1000).toLocaleString('id-ID')} rb`;
  return value.toLocaleString('id-ID');
}
