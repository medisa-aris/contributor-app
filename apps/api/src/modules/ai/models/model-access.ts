import type { GrantTarget, QuotaPeriod } from '@bara/shared';

/**
 * Fungsi murni resolusi izin model dan jendela kuota (docs/LLM-MultiModel-requirement.md §6.2–§6.3).
 * Tidak menyentuh DB agar aturan dapat diuji unit.
 */

export interface GrantRow {
  id: string;
  targetType: GrantTarget;
  targetId: string | null;
  includeSubDepartments: boolean;
  modelId: string;
  tokenLimit: number | null;
  period: QuotaPeriod;
  grantedScope: 'admin' | 'leader';
  createdBy: string;
  label: string;
}

export interface Subject {
  userId: string;
  /** Departemen pengguna lalu leluhurnya: index 0 = departemen sendiri. */
  departmentChain: string[];
}

export interface ResolvedLimit {
  /** null = tanpa batas. */
  limit: number | null;
  grantId: string;
  label: string;
}

export interface ResolvedAccess {
  /** Model non-bawaan yang diizinkan beserta batas per periode. */
  models: Map<string, Map<QuotaPeriod, ResolvedLimit>>;
}

/** Peringkat kekhususan: makin kecil makin spesifik. null = baris tidak berlaku. */
export function specificity(row: GrantRow, subject: Subject): number | null {
  if (row.grantedScope === 'leader' && row.createdBy === subject.userId) return null;
  switch (row.targetType) {
    case 'user':
      return row.targetId === subject.userId ? 0 : null;
    case 'department': {
      const depth = row.targetId ? subject.departmentChain.indexOf(row.targetId) : -1;
      if (depth < 0) return null;
      if (depth > 0 && !row.includeSubDepartments) return null;
      return 1 + depth;
    }
    case 'everyone':
      return 1000;
    default:
      return null;
  }
}

/**
 * Model yang diizinkan dan batasnya. Per (model, periode): ambil kelompok paling spesifik,
 * lalu batas TERENDAH di dalamnya (null = tanpa batas, jadi angka mana pun mengalahkan null).
 */
export function resolveAccess(rows: GrantRow[], subject: Subject, defaultModelId: string | null): ResolvedAccess {
  const best = new Map<string, Map<QuotaPeriod, { rank: number; resolved: ResolvedLimit }>>();
  for (const row of rows) {
    if (row.modelId === defaultModelId) continue; // model bawaan diatur batas model bawaan
    const rank = specificity(row, subject);
    if (rank === null) continue;
    const perModel = best.get(row.modelId) ?? new Map();
    const current = perModel.get(row.period);
    const candidate = { rank, resolved: { limit: row.tokenLimit, grantId: row.id, label: row.label } };
    if (!current || rank < current.rank) {
      perModel.set(row.period, candidate);
    } else if (rank === current.rank && lower(row.tokenLimit, current.resolved.limit)) {
      perModel.set(row.period, candidate);
    }
    best.set(row.modelId, perModel);
  }
  const models = new Map<string, Map<QuotaPeriod, ResolvedLimit>>();
  for (const [modelId, periods] of best) {
    models.set(modelId, new Map([...periods].map(([p, v]) => [p, v.resolved])));
  }
  return { models };
}

/** Batas izin agent (target agent): hanya penyempit, tanpa peringkat. Terendah per periode. */
export function resolveAgentAccess(rows: GrantRow[], agentId: string, defaultModelId: string | null): ResolvedAccess | null {
  const own = rows.filter((r) => r.targetType === 'agent' && r.targetId === agentId && r.modelId !== defaultModelId);
  if (own.length === 0) return null;
  const models = new Map<string, Map<QuotaPeriod, ResolvedLimit>>();
  for (const row of own) {
    const perModel = models.get(row.modelId) ?? new Map<QuotaPeriod, ResolvedLimit>();
    const current = perModel.get(row.period);
    if (!current || lower(row.tokenLimit, current.limit)) {
      perModel.set(row.period, { limit: row.tokenLimit, grantId: row.id, label: row.label });
    }
    models.set(row.modelId, perModel);
  }
  return { models };
}

function lower(candidate: number | null, current: number | null): boolean {
  if (candidate === null) return false;
  if (current === null) return true;
  return candidate < current;
}

/** Selisih zona waktu (ms) pada saat `at`, positif untuk zona di timur UTC. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Awal dan akhir jendela kuota yang memuat `now`: hari mulai 00:00, minggu mulai Senin 00:00. */
export function quotaWindow(period: QuotaPeriod, now: Date, timeZone: string): { start: Date; end: Date } {
  const offset = zoneOffsetMs(now, timeZone);
  const local = new Date(now.getTime() + offset);
  const dayStartLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const daysBack = period === 'week' ? (local.getUTCDay() + 6) % 7 : 0;
  const startLocal = dayStartLocal - daysBack * 86_400_000;
  const length = (period === 'week' ? 7 : 1) * 86_400_000;
  return { start: new Date(startLocal - offset), end: new Date(startLocal + length - offset) };
}
