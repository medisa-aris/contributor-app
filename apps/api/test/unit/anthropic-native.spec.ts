import { ANTHROPIC_BETAS, AnthropicProvider, BlockAssembler, toAnthropicMessages } from '../../src/modules/ai/providers/anthropic.provider';
import { storableProviderContent } from '../../src/modules/ai/gateway.service';
import type { ChatRequestOptions } from '../../src/modules/ai/providers/types';

function sse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function capture(response: () => Response) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return Promise.resolve(response());
  }) as typeof fetch;
  return { calls, provider: new AnthropicProvider({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k', fetchImpl }) };
}

const base: ChatRequestOptions = {
  model: 'claude-uji',
  systemPrompt: 'sistem',
  messages: [{ role: 'user', content: 'halo' }],
  maxTokens: 1000,
};

describe('adapter Anthropic: fitur bawaan kerja panjang', () => {
  it('memetakan effort, thinking, kompaksi, task budget, cache, dan fallback ke body + header beta', async () => {
    const { calls, provider } = capture(() =>
      new Response(JSON.stringify({ model: 'claude-uji', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 90 } }), { status: 200 }),
    );
    const result = await provider.chat({
      ...base,
      native: { effort: 'high', thinking: true, compaction: true, contextEditing: true, taskBudget: 50_000, promptCache: true, fallbackModels: ['claude-lain'] },
    });
    const { body, headers } = calls[0]!;
    expect(body.output_config).toEqual({ effort: 'high', task_budget: { type: 'tokens', total: 50_000 } });
    expect(body.thinking).toEqual({ type: 'adaptive' });
    // Kompaksi dipilih bila didukung; context editing tidak dikirim bersamaan.
    expect(body.context_management).toEqual({ edits: [{ type: 'compact_20260112' }] });
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system).toEqual([{ type: 'text', text: 'sistem', cache_control: { type: 'ephemeral' } }]);
    expect(body.fallbacks).toEqual([{ model: 'claude-lain' }]);
    expect(body.temperature).toBeUndefined();
    expect(headers['anthropic-beta']!.split(',').sort()).toEqual(
      [ANTHROPIC_BETAS.compaction, ANTHROPIC_BETAS.taskBudget, ANTHROPIC_BETAS.fallback].sort(),
    );
    // Token cache ikut dihitung sebagai input (kuota menghitung semua input).
    expect(result).toMatchObject({ tokensIn: 100, cacheReadTokens: 90, providerContent: [{ type: 'text', text: 'ok' }] });
  });

  it('tanpa opsi bawaan: tidak ada header beta dan body seperti biasa', async () => {
    const { calls, provider } = capture(() =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 }),
    );
    await provider.chat(base);
    expect(calls[0]!.headers['anthropic-beta']).toBeUndefined();
    expect(calls[0]!.body.system).toBe('sistem');
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('stream: blok thinking, signature, teks, dan tool_use dirakit utuh untuk diputar ulang', async () => {
    const { provider } = capture(() =>
      sse([
        { type: 'message_start', message: { model: 'claude-uji', usage: { input_tokens: 5 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'menimbang ' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'opsi' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Saya cek.' } },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'cari', input: {} } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"x"}' } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
      ]),
    );
    const gen = provider.stream(base);
    let step = await gen.next();
    const deltas: string[] = [];
    while (!step.done) {
      deltas.push(step.value);
      step = await gen.next();
    }
    expect(deltas).toEqual(['Saya cek.']);
    expect(step.value.providerContent).toEqual([
      { type: 'thinking', thinking: 'menimbang opsi', signature: 'sig123' },
      { type: 'text', text: 'Saya cek.' },
      { type: 'tool_use', id: 't1', name: 'cari', input: { q: 'x' } },
    ]);
    expect(step.value.toolCalls).toEqual([{ id: 't1', name: 'cari', input: { q: 'x' } }]);
    expect(step.value).toMatchObject({ tokensIn: 5, tokensOut: 7, stopReason: 'tool_use' });
  });

  it('riwayat dengan providerContent dikirim balik apa adanya (append-only)', () => {
    const raw = [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'text', text: 'jawab' }];
    const mapped = toAnthropicMessages([
      { role: 'user', content: 'tanya' },
      { role: 'assistant', content: 'jawab', providerContent: raw },
    ]);
    expect(mapped[1]).toEqual({ role: 'assistant', content: raw });
  });

  it('penolakan model menjadi galat AI_REFUSED dengan kategori', async () => {
    const { provider } = capture(() =>
      new Response(JSON.stringify({ content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' } }), { status: 200 }),
    );
    await expect(provider.chat(base)).rejects.toMatchObject({ code: 'AI_REFUSED', details: { category: 'cyber' } });
  });

  it('blok berisi tool_use tidak disimpan untuk diputar ulang', () => {
    expect(storableProviderContent([{ type: 'text', text: 'a' }, { type: 'tool_use', id: '1' }])).toBeUndefined();
    expect(storableProviderContent([{ type: 'thinking' }, { type: 'text' }])).toHaveLength(2);
  });

  it('perakit blok menangani tipe delta baru secara generik', () => {
    const assembler = new BlockAssembler();
    assembler.start(0, { type: 'compaction', content: '' });
    assembler.delta(0, { type: 'compaction_delta', content: 'ringkasan ' });
    assembler.delta(0, { type: 'compaction_delta', content: 'kerja' });
    expect(assembler.result()).toEqual([{ type: 'compaction', content: 'ringkasan kerja' }]);
  });
});
