import type { ConfigService } from '@nestjs/config';
import {
  AiGatewayService,
  clampToolResult,
  type ToolHandler,
} from '../../src/modules/ai/gateway.service';
import { toAnthropicMessages } from '../../src/modules/ai/providers/anthropic.provider';
import { toOpenAiMessages } from '../../src/modules/ai/providers/openai-compatible.provider';
import type {
  AiProviderAdapter,
  ChatMessage,
  ChatRequestOptions,
  ChatResult,
} from '../../src/modules/ai/providers/types';

const transcript: ChatMessage[] = [
  { role: 'user', content: 'Berapa insiden bulan ini?' },
  {
    role: 'assistant',
    content: 'Saya cek dulu.',
    toolCalls: [
      { id: 't1', name: 'db_hse__run_query', input: { sql: 'SELECT 1' } },
      { id: 't2', name: 'db_hse__list_tables', input: {} },
    ],
  },
  { role: 'tool', toolCallId: 't1', toolName: 'db_hse__run_query', content: '[{"n":4}]' },
  {
    role: 'tool',
    toolCallId: 't2',
    toolName: 'db_hse__list_tables',
    content: 'gagal',
    isError: true,
  },
];

describe('pemetaan pesan tool', () => {
  it('Anthropic: tool_use di asisten dan tool_result digabung dalam satu pesan user', () => {
    const mapped = toAnthropicMessages(transcript);
    expect(mapped).toHaveLength(3);
    expect(mapped[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Saya cek dulu.' },
        { type: 'tool_use', id: 't1', name: 'db_hse__run_query', input: { sql: 'SELECT 1' } },
        { type: 'tool_use', id: 't2', name: 'db_hse__list_tables', input: {} },
      ],
    });
    expect(mapped[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: '[{"n":4}]' },
        { type: 'tool_result', tool_use_id: 't2', content: 'gagal', is_error: true },
      ],
    });
  });

  it('OpenAI: tool_calls dengan argumen JSON string dan role tool', () => {
    const mapped = toOpenAiMessages(transcript);
    expect(mapped).toHaveLength(4);
    expect(mapped[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 't1',
          type: 'function',
          function: { name: 'db_hse__run_query', arguments: '{"sql":"SELECT 1"}' },
        },
        { id: 't2', type: 'function', function: { name: 'db_hse__list_tables', arguments: '{}' } },
      ],
    });
    expect(mapped[2]).toEqual({ role: 'tool', tool_call_id: 't1', content: '[{"n":4}]' });
  });
});

function gatewayWith(replies: ChatResult[]): {
  gateway: AiGatewayService;
  requests: ChatRequestOptions[];
} {
  const requests: ChatRequestOptions[] = [];
  const adapter: AiProviderAdapter = {
    id: 'palsu',
    chat: (options) => {
      requests.push({ ...options, messages: [...options.messages] });
      const next = replies.shift();
      if (!next) throw new Error('balasan habis');
      return Promise.resolve(next);
    },
    // eslint-disable-next-line require-yield
    stream: async function* () {
      throw new Error('tidak dipakai');
    },
  };
  const config = {
    get: (_key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService;
  const gateway = new AiGatewayService(config);
  (gateway as unknown as { adapter: AiProviderAdapter }).adapter = adapter;
  return { gateway, requests };
}

const echoTool = (name: string, execute: ToolHandler['execute']): ToolHandler => ({
  tool: { name, description: name, inputSchema: { type: 'object', properties: {} } },
  execute,
});

const reply = (content: string, toolCalls?: ChatResult['toolCalls']): ChatResult => ({
  content,
  model: 'palsu-1',
  tokensIn: 10,
  tokensOut: 5,
  ...(toolCalls ? { toolCalls } : {}),
});

describe('AiGatewayService.runToolLoop', () => {
  it('menjalankan tool, mengumpankan hasil, lalu selesai', async () => {
    const { gateway, requests } = gatewayWith([
      reply('', [{ id: 'a', name: 'hitung', input: { x: 2 } }]),
      reply('Hasilnya 4.'),
    ]);
    const result = await gateway.drainToolLoop({
      mode: 'subordinate',
      messages: [{ role: 'user', content: 'Hitung' }],
      handlers: [
        echoTool('hitung', (input) =>
          Promise.resolve({ status: 'ok', content: String(Number(input.x) * 2) }),
        ),
      ],
    });
    expect(result.stop).toBe('completed');
    expect(result.content).toBe('Hasilnya 4.');
    expect(result.tokensIn).toBe(20);
    expect(result.appended).toHaveLength(2);
    expect(requests[1]!.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'a',
      content: '4',
    });
    expect(requests[0]!.tools?.map((t) => t.name)).toEqual(['hitung']);
  });

  it('error tool dikirim sebagai isError dan loop berlanjut', async () => {
    const { gateway, requests } = gatewayWith([
      reply('', [{ id: 'a', name: 'rusak', input: {} }]),
      reply('Maaf, tool gagal.'),
    ]);
    const result = await gateway.drainToolLoop({
      mode: 'subordinate',
      messages: [{ role: 'user', content: 'Coba' }],
      handlers: [echoTool('rusak', () => Promise.reject(new Error('koneksi putus')))],
    });
    expect(result.stop).toBe('completed');
    expect(requests[1]!.messages.at(-1)).toMatchObject({ isError: true, content: 'koneksi putus' });
  });

  it('berhenti saat tool butuh persetujuan; panggilan berikutnya ditandai tidak dijalankan', async () => {
    const { gateway } = gatewayWith([
      reply('Perlu update.', [
        { id: 'w', name: 'tulis', input: {} },
        { id: 'r', name: 'baca', input: {} },
      ]),
    ]);
    const baca = jest.fn(() => Promise.resolve({ status: 'ok' as const, content: 'x' }));
    const result = await gateway.drainToolLoop({
      mode: 'subordinate',
      messages: [{ role: 'user', content: 'Update' }],
      handlers: [
        echoTool('tulis', () =>
          Promise.resolve({ status: 'pending_approval', content: 'menunggu', approvalId: 'ap-1' }),
        ),
        echoTool('baca', baca),
      ],
    });
    expect(result.stop).toBe('pending_approval');
    expect(result.pending).toMatchObject({ approvalId: 'ap-1', call: { id: 'w' } });
    expect(baca).not.toHaveBeenCalled();
    // asisten + hasil "tidak dijalankan" untuk panggilan kedua; hasil yang tertunda ditambahkan kemudian.
    expect(result.appended).toHaveLength(2);
    expect(result.appended[1]).toMatchObject({ toolCallId: 'r', isError: true });
  });

  it('berhenti pada batas iterasi', async () => {
    const loopReply = () => reply('', [{ id: '', name: 'ulang', input: {} }]);
    const { gateway } = gatewayWith([loopReply(), loopReply(), loopReply()]);
    const result = await gateway.drainToolLoop({
      mode: 'subordinate',
      messages: [{ role: 'user', content: 'x' }],
      maxIterations: 3,
      handlers: [echoTool('ulang', () => Promise.resolve({ status: 'ok', content: 'lagi' }))],
    });
    expect(result.stop).toBe('max_iterations');
    // id kosong dinormalisasi.
    expect(result.appended[0]!.toolCalls![0]!.id).toBe('call_1_0');
  });

  it('tool tanpa handler dikembalikan sebagai unhandledToolCalls', async () => {
    const { gateway } = gatewayWith([
      reply('Ini dokumennya.', [{ id: 'd', name: 'create_document', input: {} }]),
    ]);
    const result = await gateway.drainToolLoop({
      mode: 'second_brain',
      messages: [{ role: 'user', content: 'Buat dokumen' }],
      documents: true,
      handlers: [],
    });
    expect(result.stop).toBe('completed');
    expect(result.unhandledToolCalls.map((c) => c.name)).toEqual(['create_document']);
  });
});

describe('clampToolResult', () => {
  it('memotong hasil yang terlalu panjang', () => {
    const out = clampToolResult('a'.repeat(50), 10);
    expect(out.startsWith('aaaaaaaaaa\n')).toBe(true);
    expect(out).toContain('40 karakter');
  });
});
