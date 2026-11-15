/** Kontrak API katalog model, izin model, dan pemakaian token (docs/LLM-MultiModel-requirement.md). */

export const AI_PROVIDER_CODES = ['openrouter', 'openai', 'anthropic', 'ollama'] as const;
export type AiProviderCode = (typeof AI_PROVIDER_CODES)[number];

export type AiModelStatus = 'draft' | 'enabled' | 'disabled';
export type QuotaPeriod = 'day' | 'week';
export type GrantTarget = 'user' | 'department' | 'agent' | 'everyone';

export interface AiProviderStatusDto {
  code: AiProviderCode;
  configured: boolean;
  baseUrl: string;
  /** Nama variabel env yang mengaktifkan penyedia ini (untuk petunjuk di UI). */
  envVar: string;
  modelCount: number;
  enabledModelCount: number;
  lastCheck: { ok: boolean; latencyMs: number | null; error: string | null; checkedAt: string } | null;
}

export interface AiModelDto {
  id: string;
  provider: AiProviderCode;
  modelKey: string;
  displayName: string;
  description: string | null;
  status: AiModelStatus;
  isDefault: boolean;
  leaderGrantable: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStream: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  costTier: 1 | 2 | 3 | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestLatencyMs: number | null;
  lastTestError: string | null;
  providerConfigured: boolean;
  /** Boleh dipakai untuk kerja panjang (§14). */
  longRunAllowed: boolean;
  supportsEffort: boolean;
  defaultEffort: string | null;
  supportsThinking: boolean;
  supportsCompaction: boolean;
  supportsContextEditing: boolean;
  supportsTaskBudget: boolean;
  supportsPromptCache: boolean;
  /** false = jangan kirim temperature/top_p/top_k (model Claude terbaru menolaknya). */
  acceptsSamplingParams: boolean;
}

export interface ModelTestProbeDto {
  probe: 'basic' | 'tools' | 'vision';
  ok: boolean;
  latencyMs: number | null;
  detail: string | null;
}

export interface ModelTestResultDto {
  model: AiModelDto;
  probes: ModelTestProbeDto[];
}

export interface DefaultModelLimitsDto {
  tokenLimit: number | null;
  period: QuotaPeriod;
  requestsPerMinute: number | null;
}

export interface ModelGrantDto {
  id: string;
  targetType: GrantTarget;
  targetId: string | null;
  targetName: string;
  includeSubDepartments: boolean;
  modelId: string;
  modelName: string;
  tokenLimit: number | null;
  period: QuotaPeriod;
  grantedScope: 'admin' | 'leader';
  note: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  /** Pemanggil boleh mengubah/menghapus baris ini. */
  editable: boolean;
  /** Target sudah keluar dari jangkauan leader pemanggil. */
  outOfReach: boolean;
  /** Izin pada model yang kini menjadi model bawaan (tidak berlaku). */
  notApplicable: boolean;
}

export interface QuotaWindowDto {
  period: QuotaPeriod;
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
  /** Baris izin yang menghasilkan batas ini (null untuk batas model bawaan). */
  sourceGrantId: string | null;
  sourceLabel: string;
}

export interface UserModelDto {
  id: string;
  provider: AiProviderCode;
  displayName: string;
  description: string | null;
  costTier: 1 | 2 | 3 | null;
  supportsTools: boolean;
  supportsVision: boolean;
  longRunAllowed: boolean;
  isDefault: boolean;
  /** Model bawaan tanpa batas (tidak ada batas model bawaan yang diatur). */
  unlimited: boolean;
  quotas: QuotaWindowDto[];
  requestsPerMinute: number | null;
  exhausted: boolean;
}

export interface UserModelsResponseDto {
  models: UserModelDto[];
  preferredModelId: string | null;
}

export interface ReachDto {
  departments: { id: string; name: string; parentId: string | null }[];
  users: { id: string; name: string; jobTitle: string | null; departmentId: string | null; departmentName: string | null }[];
  agents: { id: string; name: string; ownerUserId: string; ownerName: string }[];
  /** true bila pemanggil admin (seluruh organisasi). */
  global: boolean;
}

export interface UsageRowDto {
  key: string;
  label: string;
  tokens: number;
  limit: number | null;
}
