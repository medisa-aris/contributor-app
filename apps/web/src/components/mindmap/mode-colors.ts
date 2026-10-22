import type { MindMapMode } from '@/api/mindmap/types';

export const MODE_ORDER: readonly MindMapMode[] = ['second_brain', 'counterpart', 'subordinate'];

/** Warna penanda mode; cukup kontras di tema terang maupun gelap. */
export const MODE_COLORS: Record<MindMapMode, string> = {
  second_brain: '#3b82f6',
  counterpart: '#f59e0b',
  subordinate: '#a855f7',
};

export function dominantMode(counts: Record<MindMapMode, number>): MindMapMode {
  return MODE_ORDER.reduce((best, mode) => (counts[mode] > counts[best] ? mode : best), MODE_ORDER[0]!);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
