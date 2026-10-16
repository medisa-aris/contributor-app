/** Mode percakapan di Ruang Kerja AI. */
export type ConversationMode = 'second_brain' | 'counterpart';

/** Status siklus hidup tugas Asisten Eksekusi. */
export type AiTaskStatus =
  | 'created'
  | 'validating'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const AI_TASK_STATUSES: readonly AiTaskStatus[] = [
  'created',
  'validating',
  'awaiting_approval',
  'running',
  'completed',
  'failed',
  'cancelled',
];

/** Gaya interaksi untuk mode Mitra Berpikir. */
export interface CounterpartStyle {
  id: string;
  name: string;
  description: string;
}

export const COUNTERPART_STYLES: readonly CounterpartStyle[] = [
  {
    id: 'supportive',
    name: 'Pendamping Suportif',
    description: 'Menggali ide bersama, memperkuat yang sudah ada, dan menambah variasi.',
  },
  {
    id: 'challenger',
    name: 'Penantang Asumsi',
    description: 'Sengaja menantang asumsi, mencari celah argumen, dan menguji keputusan.',
  },
  {
    id: 'analyst',
    name: 'Analis Terstruktur',
    description: 'Membedah masalah secara runtut: faktor, sebab-akibat, risiko, dan opsi.',
  },
  {
    id: 'pragmatist',
    name: 'Pragmatis',
    description: 'Fokus langkah konkret, biaya-manfaat, dan apa yang bisa dieksekusi besok.',
  },
];

export function isCounterpartStyle(value: string): value is string {
  return COUNTERPART_STYLES.some((style) => style.id === value);
}
