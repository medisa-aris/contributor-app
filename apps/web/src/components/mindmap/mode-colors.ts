import type { MindMapMode } from '@/api/mindmap/types';

export const MODE_ORDER: readonly MindMapMode[] = ['second_brain', 'counterpart', 'subordinate'];

/** Warna penanda mode dari seri grafik Fluent Green (berbeda di tema terang dan gelap). */
export const MODE_COLORS: Record<MindMapMode, string> = {
  second_brain: 'var(--ca-chart-1)',
  counterpart: 'var(--ca-chart-2)',
  subordinate: 'var(--ca-chart-3)',
};

/** Pola garis per mode agar seri tetap terbedakan tanpa mengandalkan warna. */
export const MODE_DASH: Record<MindMapMode, 'solid' | 'dashed' | 'dotted'> = {
  second_brain: 'solid',
  counterpart: 'dashed',
  subordinate: 'dotted',
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
