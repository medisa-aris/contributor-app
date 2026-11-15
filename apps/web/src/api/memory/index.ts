import type {
  MemoryAccessLogDto as SharedAccessLog,
  MemoryBookSummaryDto,
  MemoryContextDoorDto,
  MemoryContextKind,
  MemoryDigestDto,
  MemoryDigestPeriod,
  MemoryDoorDto,
  MemoryEntryDto as SharedEntry,
  MemoryEntryType,
  MemoryReachSubjectDto,
  MemoryReviewDecision,
  MemorySensitivity,
  MemoryStatusDto,
  MemoryThemeSubjectDto,
} from '@bara/shared';
import { apiDelete, apiGet, apiGetPaged, apiPatch, apiPost, apiPut } from '@/api/http';

/** Salinan berbentuk type literal agar cocok dengan baris CaTable (Record<string, unknown>). */
type Flat<T> = { [K in keyof T]: T[K] };
export type MemoryEntryDto = Flat<SharedEntry>;
export type MemoryAccessLogDto = Flat<SharedAccessLog>;

export type {
  MemoryBookSummaryDto,
  MemoryDigestDto,
  MemoryDigestPeriod,
  MemoryReviewDecision,
  MemoryThemeSubjectDto,
  MemoryContextDoorDto,
  MemoryDoorDto,
  MemoryEntryType,
  MemoryReachSubjectDto,
  MemorySensitivity,
};

export interface MemoryEntryInput {
  type: MemoryEntryType;
  content: string;
  sensitivity?: MemorySensitivity;
  importance?: number;
}

/** Buku memori: milik sendiri (agentId kosong) atau agent pribadi milik pengguna. */
function base(agentId?: string | null): string {
  return agentId ? `/memory/agents/${agentId}` : '/memory/me';
}

export function memoryStatus(): Promise<MemoryStatusDto> {
  return apiGet<MemoryStatusDto>('/memory/status');
}

export function memorySummary(agentId?: string | null): Promise<MemoryBookSummaryDto> {
  return apiGet<MemoryBookSummaryDto>(`${base(agentId)}/summary`);
}

export function listMemoryEntries(
  query: { page: number; pageSize: number; type?: MemoryEntryType; search?: string; status?: string },
  agentId?: string | null,
) {
  return apiGetPaged<MemoryEntryDto>(`${base(agentId)}/entries`, query);
}

export function createMemoryEntry(input: MemoryEntryInput, agentId?: string | null): Promise<MemoryEntryDto> {
  return apiPost<MemoryEntryDto>(`${base(agentId)}/entries`, input);
}

export function updateMemoryEntry(
  id: string,
  patch: Partial<MemoryEntryInput>,
  agentId?: string | null,
): Promise<MemoryEntryDto> {
  return apiPatch<MemoryEntryDto>(`${base(agentId)}/entries/${id}`, patch);
}

export function deleteMemoryEntry(id: string, agentId?: string | null): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`${base(agentId)}/entries/${id}`);
}

export function getMyDoor(): Promise<MemoryDoorDto> {
  return apiGet<MemoryDoorDto>('/memory/me/door');
}

export function setMemoryDoor(
  input: { enabled: boolean; exposedTypes: MemoryEntryType[]; exposeAgents?: boolean; reviewRequired?: boolean },
  agentId?: string | null,
): Promise<MemoryDoorDto> {
  return apiPut<MemoryDoorDto>(`${base(agentId)}/door`, input);
}

export function listMyAccessLog(query: { page: number; pageSize: number }) {
  return apiGetPaged<MemoryAccessLogDto>('/memory/me/access-log', query);
}

export function memoryReach(): Promise<MemoryReachSubjectDto[]> {
  return apiGet<MemoryReachSubjectDto[]>('/memory/reach');
}

export function contextDoors(kind: MemoryContextKind, id: string): Promise<MemoryContextDoorDto[]> {
  return apiGet<MemoryContextDoorDto[]>(`/memory/contexts/${kind}/${id}/doors`);
}

export function setContextDoors(
  kind: MemoryContextKind,
  id: string,
  subjectIds: string[],
): Promise<MemoryContextDoorDto[]> {
  return apiPut<MemoryContextDoorDto[]>(`/memory/contexts/${kind}/${id}/doors`, { subjectIds });
}

/** Kotak tinjauan (P2): catatan baru yang menunggu persetujuan pemilik. */
export function listMemoryReview(query: { page: number; pageSize: number }, agentId?: string | null) {
  return apiGetPaged<MemoryEntryDto>(`${base(agentId)}/review`, query);
}

export function reviewMemoryEntries(
  decision: MemoryReviewDecision,
  entryIds: string[] = [],
  agentId?: string | null,
): Promise<{ affected: number }> {
  return apiPost<{ affected: number }>(`${base(agentId)}/review`, {
    decision,
    ...(entryIds.length > 0 ? { entryIds } : {}),
  });
}

/** Susun ulang ringkasan profil (P3) sekarang. */
export function refreshMemorySummary(agentId?: string | null): Promise<MemoryBookSummaryDto> {
  return apiPost<MemoryBookSummaryDto>(`${base(agentId)}/summary/refresh`);
}

/** Ringkasan tim dari pintu yang diizinkan (P3). */
export function memoryDigest(subjectIds: string[], days: MemoryDigestPeriod): Promise<MemoryDigestDto> {
  return apiPost<MemoryDigestDto>('/memory/digest', { subjectIds, days });
}

/** Tema memori untuk Peta Pikiran (P3). */
export function memoryThemes(): Promise<MemoryThemeSubjectDto[]> {
  return apiGet<MemoryThemeSubjectDto[]>('/memory/themes');
}
