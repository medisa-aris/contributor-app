import {
  CLEARED_TOOL_RESULT,
  clearOldToolResults,
  compactionCut,
  estimateTokens,
} from '../../src/modules/ai/context-budget';
import type { ChatMessage } from '../../src/modules/ai/providers/types';

function toolTurn(i: number): ChatMessage[] {
  return [
    { role: 'assistant', content: '', toolCalls: [{ id: `c${i}`, name: 'cari', input: {} }] },
    { role: 'tool', toolCallId: `c${i}`, toolName: 'cari', content: `hasil ${i} ${'x'.repeat(100)}` },
  ];
}

describe('pengelolaan konteks kerja panjang', () => {
  it('estimasi ~4 karakter per token termasuk system prompt dan panggilan tool', () => {
    expect(estimateTokens([{ role: 'user', content: 'a'.repeat(400) }], 'b'.repeat(400))).toBe(200);
    expect(estimateTokens(toolTurn(1))).toBeGreaterThan(25);
  });

  it('membersihkan hasil tool lama, menyisakan yang terbaru', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'mulai' }];
    for (let i = 0; i < 10; i += 1) messages.push(...toolTurn(i));
    const cleared = clearOldToolResults(messages, 8);
    const tools = cleared.filter((m) => m.role === 'tool');
    expect(tools.filter((m) => m.content === CLEARED_TOOL_RESULT)).toHaveLength(2);
    expect(tools.at(-1)!.content).toContain('hasil 9');
    // Transkrip asli tidak berubah.
    expect(messages.filter((m) => m.content === CLEARED_TOOL_RESULT)).toHaveLength(0);
  });

  it('titik potong ringkasan selalu di awal pesan pengguna (pasangan tool tidak terbelah)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'tugas 1' },
      ...toolTurn(1),
      { role: 'assistant', content: 'selesai 1' },
      { role: 'user', content: 'tugas 2' },
      ...toolTurn(2),
      ...toolTurn(3),
      { role: 'assistant', content: 'selesai 2' },
    ];
    const cut = compactionCut(messages, 4);
    expect(messages[cut]!.role).toBe('user');
    expect(cut).toBe(4);
    expect(compactionCut([{ role: 'user', content: 'satu' }], 6)).toBe(0);
  });
});
