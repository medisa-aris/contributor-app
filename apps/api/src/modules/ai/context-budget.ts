import type { ChatMessage } from './providers/types';

/**
 * Pengelolaan konteks netral-penyedia untuk kerja panjang (docs/LLM-MultiModel-requirement.md §14.6).
 * Konteks diukur dalam token terhadap jendela konteks model, lalu dijaga dengan:
 *   1. membersihkan hasil tool lama (> 50% jendela), lalu
 *   2. meringkas bagian awal percakapan (> 75% jendela).
 * Transkrip lengkap tidak diubah; yang dipangkas hanya isi permintaan ke penyedia.
 */

export const CONTEXT_LIMITS = {
  /** Jendela konteks bawaan bila katalog tidak mengisinya. */
  defaultWindow: 128_000,
  clearToolResultsAt: 0.5,
  compactAt: 0.75,
  keepToolResults: 8,
  /** Pesan terbaru yang tidak pernah diringkas. */
  keepTail: 6,
} as const;

export const CLEARED_TOOL_RESULT = '[hasil tool lama dihapus untuk menghemat konteks]';

/** Estimasi kasar: ~4 karakter per token (sama dengan estimasi buku besar). */
export function estimateTokens(messages: ChatMessage[], systemPrompt = ''): number {
  let chars = systemPrompt.length;
  for (const message of messages) {
    chars += message.content?.length ?? 0;
    if (message.toolCalls) chars += JSON.stringify(message.toolCalls).length;
  }
  return Math.ceil(chars / 4);
}

/** Kosongkan isi hasil tool lama; `keep` hasil terakhir dipertahankan utuh. */
export function clearOldToolResults(messages: ChatMessage[], keep: number = CONTEXT_LIMITS.keepToolResults): ChatMessage[] {
  const toolIndexes = messages.flatMap((m, i) => (m.role === 'tool' ? [i] : []));
  const clear = new Set(toolIndexes.slice(0, Math.max(0, toolIndexes.length - keep)));
  if (clear.size === 0) return messages;
  return messages.map((m, i) => (clear.has(i) && m.content !== CLEARED_TOOL_RESULT ? { ...m, content: CLEARED_TOOL_RESULT } : m));
}

/**
 * Titik potong untuk peringkasan: awal sebuah pesan `user` sehingga pasangan
 * tool_use/tool_result tidak terbelah. 0 = tidak ada yang bisa diringkas.
 */
export function compactionCut(messages: ChatMessage[], keepTail: number = CONTEXT_LIMITS.keepTail): number {
  for (let i = Math.max(0, messages.length - keepTail); i > 0; i -= 1) {
    if (messages[i]!.role === 'user') return i;
  }
  return 0;
}

export function transcriptText(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === 'tool') return `[hasil ${m.toolName ?? 'tool'}] ${m.content}`;
      const calls = m.toolCalls?.length ? ` [memanggil: ${m.toolCalls.map((c) => c.name).join(', ')}]` : '';
      return `${m.role === 'user' ? 'Pengguna' : 'Asisten'}: ${m.content}${calls}`;
    })
    .join('\n\n');
}

export const COMPACTION_PROMPT =
  'Ringkas pekerjaan berikut menjadi "ringkasan kerja" untuk melanjutkan tugas yang sama. ' +
  'Wajib memuat: tujuan pengguna, keputusan yang sudah diambil, fakta/angka penting dari hasil tool, ' +
  'dokumen atau berkas yang sudah dibuat, dan hal yang belum selesai. Tulis padat dalam Bahasa Indonesia, ' +
  'tanpa pembuka atau penutup.';

/** Cache ringkasan per loop agar peringkasan tidak diulang setiap iterasi. */
export interface ContextCache {
  cut?: number;
  summary?: string;
  compactions: number;
}
