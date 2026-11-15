/** Memori terpusat: buku memori per subjek (orang/agent) dan pintu yang dapat dibuka atasan. */
export const MEMORY_ENTRY_TYPES = ['profile', 'preference', 'fact', 'decision', 'episode', 'skill'] as const;
export type MemoryEntryType = (typeof MEMORY_ENTRY_TYPES)[number];

export type MemorySubjectKind = 'user' | 'agent';
export type MemorySensitivity = 'shareable' | 'private';
export type MemoryEntryStatus = 'active' | 'superseded' | 'archived';
export type MemorySourceKind = 'conversation' | 'task' | 'manual' | 'agent_profile';
export type MemoryContextKind = 'conversation' | 'task';

/** Jenis yang dibuka pintu secara bawaan; preferensi dan peristiwa paling pribadi. */
export const DEFAULT_EXPOSED_MEMORY_TYPES: readonly MemoryEntryType[] = ['profile', 'fact', 'decision', 'skill'];

export const MEMORY_LIMITS = {
  maxContentLength: 1000,
  maxOpenDoors: 20,
} as const;

export interface MemoryEntryDto {
  id: string;
  type: MemoryEntryType;
  content: string;
  importance: number;
  confidence: number;
  sensitivity: MemorySensitivity;
  status: MemoryEntryStatus;
  sourceKind: MemorySourceKind;
  /** Hanya untuk pemilik: tautan ke percakapan/tugas asal. */
  sourceId: string | null;
  editedByOwner: boolean;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryDoorDto {
  enabled: boolean;
  exposedTypes: MemoryEntryType[];
  updatedAt: string | null;
}

export interface MemoryBookSummaryDto {
  door: MemoryDoorDto;
  counts: Record<MemoryEntryType, number>;
  total: number;
}

/** Subjek dalam jangkauan atasan; tanpa isi memori. */
export interface MemoryReachSubjectDto {
  subjectId: string;
  kind: MemorySubjectKind;
  /** userId atau agentId. */
  refId: string;
  name: string;
  /** Jabatan (orang) atau deskripsi singkat (agent). */
  caption: string | null;
  departmentName: string | null;
  granted: boolean;
  /** Jumlah catatan yang terlihat lewat pintu (sesuai jenis yang dibuka). */
  visibleEntries: number;
}

export interface MemoryContextDoorDto extends MemoryReachSubjectDto {
  /** false bila pintu tercatat terbuka tetapi izin dicabut/di luar jangkauan. */
  effective: boolean;
}

export interface MemoryAccessLogDto {
  id: string;
  actorName: string;
  action: 'door_opened' | 'door_closed' | 'entries_read';
  contextKind: MemoryContextKind;
  entryCount: number;
  createdAt: string;
}

/** Catatan memori yang disisipkan ke satu jawaban asisten (untuk sitasi). */
export interface MemoryRefDto {
  ref: string;
  entryId: string;
  subjectName: string;
  /** true bila milik penanya sendiri. */
  own: boolean;
  type: MemoryEntryType;
  content: string;
}

export interface MemoryStatusDto {
  enabled: boolean;
  /** Pencarian semantik aktif (pgvector + model embedding). */
  semantic: boolean;
}
