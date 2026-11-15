/** Memori terpusat: buku memori per subjek (orang/agent) dan pintu yang dapat dibuka atasan. */
export const MEMORY_ENTRY_TYPES = ['profile', 'preference', 'fact', 'decision', 'episode', 'skill'] as const;
export type MemoryEntryType = (typeof MEMORY_ENTRY_TYPES)[number];

export type MemorySubjectKind = 'user' | 'agent';
export type MemorySensitivity = 'shareable' | 'private';
export type MemoryEntryStatus = 'active' | 'superseded' | 'archived';
export type MemorySourceKind = 'conversation' | 'task' | 'manual' | 'agent_profile';
export type MemoryContextKind = 'conversation' | 'task';
/** Konteks log akses: percakapan/tugas, ringkasan tim (P3), atau tema di Peta Pikiran (P3). */
export type MemoryAccessContextKind = MemoryContextKind | 'digest' | 'mind_map';
export type MemoryAccessAction = 'door_opened' | 'door_closed' | 'entries_read' | 'digest_read' | 'themes_read';

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
  /** Menunggu tinjauan pemilik; belum dapat dibaca lewat pintu. */
  needsReview: boolean;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryDoorDto {
  enabled: boolean;
  exposedTypes: MemoryEntryType[];
  /** Atasan juga dapat membuka pintu agent pribadi milik pemilik buku ini (R6). */
  exposeAgents: boolean;
  /** Catatan baru hasil ekstraksi ditahan di kotak tinjauan sebelum dapat dibagikan. */
  reviewRequired: boolean;
  updatedAt: string | null;
}

/** Ringkasan profil subjek (P3); hanya untuk pemilik buku. */
export interface MemoryProfileSummaryDto {
  content: string;
  generatedAt: string;
  entryCount: number;
}

export interface MemoryBookSummaryDto {
  door: MemoryDoorDto;
  counts: Record<MemoryEntryType, number>;
  total: number;
  pendingReview: number;
  profile: MemoryProfileSummaryDto | null;
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
  /** Untuk agent milik bawahan: nama pemiliknya. */
  ownerName: string | null;
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
  action: MemoryAccessAction;
  contextKind: MemoryAccessContextKind;
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

export type MemoryReviewDecision = 'approve' | 'private' | 'delete';

export const MEMORY_DIGEST_PERIODS = [7, 30, 90] as const;
export type MemoryDigestPeriod = (typeof MEMORY_DIGEST_PERIODS)[number];

/** Ringkasan tim untuk atasan (P3): disusun hanya dari pintu yang diizinkan. Tidak disimpan. */
export interface MemoryDigestDto {
  content: string;
  refs: MemoryRefDto[];
  days: MemoryDigestPeriod;
  subjects: { subjectId: string; name: string; entries: number }[];
  generatedAt: string;
}

/** Tema memori per subjek untuk Peta Pikiran (P3); kata kunci dan jumlah, tanpa isi catatan. */
export interface MemoryThemeSubjectDto {
  subjectId: string;
  kind: MemorySubjectKind;
  name: string;
  departmentName: string | null;
  own: boolean;
  total: number;
  counts: Partial<Record<MemoryEntryType, number>>;
  themes: { term: string; weight: number }[];
}
