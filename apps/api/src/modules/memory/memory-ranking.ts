import type { MemoryEntryType, MemoryRefDto } from '@bara/shared';

/** Konstanta Reciprocal Rank Fusion (nilai umum dari literatur). */
export const RRF_K = 60;
export const MAX_ENTRIES_PER_SUBJECT = 8;
export const MAX_ENTRIES_TOTAL = 20;

const LONG_LIVED: ReadonlySet<MemoryEntryType> = new Set(['decision', 'profile']);

export interface RankCandidate {
  id: string;
  subjectId: string;
  subjectName: string;
  own: boolean;
  type: MemoryEntryType;
  content: string;
  importance: number;
  createdAt: Date;
  /** Peringkat 1-based dari pencarian vektor / teks penuh; null bila tidak muncul. */
  vectorRank: number | null;
  textRank: number | null;
}

export interface RankedEntry extends RankCandidate {
  score: number;
}

/** Peluruhan: catatan keputusan/profil bertahan lebih lama dari peristiwa sehari-hari. */
export function recency(type: MemoryEntryType, createdAt: Date, now: Date = new Date()): number {
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / 86_400_000);
  return Math.exp(-ageDays / (LONG_LIVED.has(type) ? 365 : 180));
}

export function rrf(...ranks: (number | null)[]): number {
  return ranks.reduce<number>((sum, rank) => (rank ? sum + 1 / (RRF_K + rank) : sum), 0);
}

/** Gabungkan hasil vektor + teks penuh, beri bobot kebaruan dan kepentingan, batasi per subjek. */
export function rankCandidates(candidates: RankCandidate[], now: Date = new Date()): RankedEntry[] {
  const scored = candidates
    .map((c) => ({
      ...c,
      score:
        rrf(c.vectorRank, c.textRank) *
        (0.6 + 0.4 * recency(c.type, c.createdAt, now)) *
        (0.8 + 0.05 * c.importance),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  const perSubject = new Map<string, number>();
  const picked: RankedEntry[] = [];
  for (const entry of scored) {
    const used = perSubject.get(entry.subjectId) ?? 0;
    if (used >= MAX_ENTRIES_PER_SUBJECT) continue;
    perSubject.set(entry.subjectId, used + 1);
    picked.push(entry);
    if (picked.length >= MAX_ENTRIES_TOTAL) break;
  }
  return picked;
}

/** Perkiraan token kasar (≈4 karakter per token) untuk menjaga anggaran konteks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const TYPE_LABEL: Record<MemoryEntryType, string> = {
  profile: 'profil',
  preference: 'preferensi',
  fact: 'fakta',
  decision: 'keputusan',
  episode: 'peristiwa',
  skill: 'keahlian',
};

/**
 * Susun blok "Memori yang relevan" untuk system prompt, dikelompokkan per subjek dan dibatasi
 * anggaran token. Entri berperingkat rendah dibuang lebih dulu.
 */
export function buildMemoryBlock(
  ranked: RankedEntry[],
  maxTokens: number,
): { block: string; refs: MemoryRefDto[] } {
  const header = [
    '## Memori yang relevan',
    'Catatan berikut berasal dari memori terpusat ContributorAI (bukan dari pengguna pada giliran ini).',
  ].join('\n');
  const footer = [
    'Gunakan memori hanya jika relevan dengan pertanyaan. Saat memakai memori orang lain, sebutkan sumbernya,',
    'mis. "menurut memori Budi". Jangan menyimpulkan hal pribadi di luar yang tertulis, dan jangan menampilkan',
    'kode [m1], [m2] kepada pengguna.',
  ].join(' ');
  let budget = maxTokens - estimateTokens(header) - estimateTokens(footer);
  const kept: RankedEntry[] = [];
  for (const entry of ranked) {
    const cost = estimateTokens(entry.content) + 8;
    if (cost > budget) continue;
    budget -= cost;
    kept.push(entry);
  }
  if (kept.length === 0) return { block: '', refs: [] };

  const refs: MemoryRefDto[] = kept.map((entry, index) => ({
    ref: `m${index + 1}`,
    entryId: entry.id,
    subjectName: entry.subjectName,
    own: entry.own,
    type: entry.type,
    content: entry.content,
  }));
  const groups = new Map<string, { title: string; lines: string[] }>();
  kept.forEach((entry, index) => {
    const title = entry.own
      ? '### Dari memori Anda'
      : `### Dari memori ${entry.subjectName} (dibuka melalui pintu)`;
    const group = groups.get(entry.subjectId) ?? { title, lines: [] };
    group.lines.push(`- [m${index + 1}] (${TYPE_LABEL[entry.type]}) ${entry.content}`);
    groups.set(entry.subjectId, group);
  });
  const ordered = [...groups.values()].sort((a, b) =>
    a.title === '### Dari memori Anda' ? -1 : b.title === '### Dari memori Anda' ? 1 : 0,
  );
  const body = ordered.map((g) => `${g.title}\n${g.lines.join('\n')}`).join('\n');
  return { block: `${header}\n${body}\n\n${footer}`, refs };
}
