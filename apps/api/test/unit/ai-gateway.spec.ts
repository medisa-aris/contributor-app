import { AppError, ERROR_CODES } from '../../src/common/errors/app-error';
import {
  AI_LIMITS,
  validateChatMessages,
  validatePrompt,
  validateTaskInstruction,
} from '../../src/modules/ai/limits';
import { buildSystemPrompt } from '../../src/modules/ai/prompts';
import {
  resolveProviderConfig,
  type AiProviderSettings,
} from '../../src/modules/ai/provider-resolver';
import { AnthropicProvider } from '../../src/modules/ai/providers/anthropic.provider';
import { OpenAiCompatibleProvider } from '../../src/modules/ai/providers/openai-compatible.provider';

const settings = (over: Partial<AiProviderSettings> = {}): AiProviderSettings => ({
  aiProvider: 'openrouter',
  aiModel: 'gemini/gemini-3.1-flash-lite',
  aiBaseUrl: 'https://openrouter.ai/api/v1',
  aiTimeoutMs: 60000,
  openrouterApiKey: 'kunci-openrouter',
  openaiApiKey: null,
  anthropicApiKey: null,
  ollamaBaseUrl: null,
  ...over,
});

describe('buildSystemPrompt', () => {
  it('mode second_brain memakai persona Multi Brain', () => {
    const prompt = buildSystemPrompt('second_brain');
    expect(prompt).toContain('Multi Brain');
    expect(prompt).toContain('Bahasa Indonesia');
  });

  it('mode counterpart menyesuaikan gaya interaksi', () => {
    const challenger = buildSystemPrompt('counterpart', 'challenger');
    const analyst = buildSystemPrompt('counterpart', 'analyst');
    expect(challenger).toContain('Partner');
    expect(challenger).toContain('penantang asumsi');
    expect(challenger).not.toBe(analyst);
  });

  it('gaya counterpart yang tidak dikenal jatuh ke gaya analis', () => {
    const fallback = buildSystemPrompt('counterpart', 'gaya-aneh');
    expect(fallback).toContain(buildSystemPrompt('counterpart', 'analyst'));
  });

  it('mode subordinate memakai persona Subordinate', () => {
    const prompt = buildSystemPrompt('subordinate');
    expect(prompt).toContain('Subordinate');
    expect(prompt).toContain('klarifikasi');
  });
});

describe('resolveProviderConfig', () => {
  it('openrouter dengan kunci menghasilkan adapter openai-compatible', () => {
    const resolved = resolveProviderConfig(settings());
    expect(resolved.adapter).toBe('openai-compatible');
    expect(resolved.provider).toBe('openrouter');
    expect(resolved.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(resolved.apiKey).toBe('kunci-openrouter');
    expect(resolved.model).toBe('gemini/gemini-3.1-flash-lite');
  });

  it('openrouter tanpa kunci ditolak dengan kode AI_PROVIDER_NOT_CONFIGURED', () => {
    try {
      resolveProviderConfig(settings({ openrouterApiKey: null }));
      fail('seharusnya melempar AppError');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ERROR_CODES.aiProviderNotConfigured);
      expect((error as AppError).status).toBe(503);
    }
  });

  it('openai dan anthropic menolak tanpa kunci masing-masing', () => {
    expect(() => resolveProviderConfig(settings({ aiProvider: 'openai' }))).toThrow(AppError);
    expect(() =>
      resolveProviderConfig(settings({ aiProvider: 'anthropic', anthropicApiKey: 'k' })),
    ).not.toThrow();
  });

  it('ollama tidak butuh kunci dan memakai base url lokal', () => {
    const resolved = resolveProviderConfig(settings({ aiProvider: 'ollama' }));
    expect(resolved.adapter).toBe('openai-compatible');
    expect(resolved.apiKey).toBeNull();
    expect(resolved.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('ollama menghormati OLLAMA_BASE_URL', () => {
    const resolved = resolveProviderConfig(
      settings({ aiProvider: 'ollama', ollamaBaseUrl: 'http://192.168.0.62:11434/v1' }),
    );
    expect(resolved.baseUrl).toBe('http://192.168.0.62:11434/v1');
  });

  it('anthropic memakai adapter anthropic dan base url bawaannya', () => {
    const resolved = resolveProviderConfig(
      settings({ aiProvider: 'anthropic', anthropicApiKey: 'kunci-anthropic', aiBaseUrl: '' }),
    );
    expect(resolved.adapter).toBe('anthropic');
    expect(resolved.baseUrl).toBe('https://api.anthropic.com');
    expect(resolved.apiKey).toBe('kunci-anthropic');
  });

  it('AI_BASE_URL menimpa base url bawaan penyedia manapun', () => {
    const resolved = resolveProviderConfig(
      settings({ aiProvider: 'anthropic', anthropicApiKey: 'kunci-anthropic' }),
    );
    expect(resolved.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('penyedia tidak dikenal ditolak', () => {
    expect(() => resolveProviderConfig(settings({ aiProvider: 'penyedia-x' }))).toThrow(AppError);
  });

  it('timeout tidak valid kembali ke 60000 ms', () => {
    const resolved = resolveProviderConfig(settings({ aiTimeoutMs: 0 }));
    expect(resolved.timeoutMs).toBe(60000);
  });
});

describe('validasi pesan', () => {
  const pesan = (content: string, role: 'user' | 'assistant' = 'user') => ({ role, content });

  it('menerima riwayat pesan wajar', () => {
    expect(() => validateChatMessages([pesan('Halo')])).not.toThrow();
  });

  it('menolak daftar kosong dan konten kosong', () => {
    expect(() => validateChatMessages([])).toThrow(AppError);
    expect(() => validateChatMessages([pesan('   ')])).toThrow(AppError);
  });

  it('menolak riwayat melebihi batas jumlah pesan', () => {
    const banyak = Array.from({ length: AI_LIMITS.maxHistoryMessages + 1 }, () => pesan('isi'));
    expect(() => validateChatMessages(banyak)).toThrow(AppError);
  });

  it('menolak konten melebihi batas karakter', () => {
    expect(() => validateChatMessages([pesan('x'.repeat(AI_LIMITS.maxContentLength + 1))])).toThrow(
      AppError,
    );
  });

  it('validatePrompt membersihkan spasi dan menjaga batas', () => {
    expect(validatePrompt('  halo  ')).toBe('halo');
    expect(() => validatePrompt('')).toThrow(AppError);
    expect(() => validatePrompt('x'.repeat(AI_LIMITS.maxPromptLength + 1))).toThrow(AppError);
  });

  it('validateTaskInstruction menjaga batas instruksi', () => {
    expect(validateTaskInstruction('  susun ringkasan  ')).toBe('susun ringkasan');
    expect(() =>
      validateTaskInstruction('x'.repeat(AI_LIMITS.maxTaskInstructionLength + 1)),
    ).toThrow(AppError);
  });
});

describe('OpenAiCompatibleProvider', () => {
  const options = {
    model: 'gemini/gemini-3.1-flash-lite',
    systemPrompt: 'Kamu pembantu.',
    messages: [{ role: 'user' as const, content: 'Halo' }],
    maxTokens: 100,
  };

  it('chat() memetakan konten, model, dan pemakaian token', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'gemini/gemini-3.1-flash-lite',
          choices: [{ message: { role: 'assistant', content: 'Halo juga.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'kunci',
      fetchImpl: fetchMock,
    });
    const result = await provider.chat(options);
    expect(result.content).toBe('Halo juga.');
    expect(result.tokensIn).toBe(10);
    expect(result.tokensOut).toBe(5);

    const request = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(request.headers.Authorization).toBe('Bearer kunci');
  });

  it('chat() melempar AI_UPSTREAM_ERROR saat penyedia gagal', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('error hulu', { status: 500 }));
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'kunci',
      fetchImpl: fetchMock,
    });
    await expect(provider.chat(options)).rejects.toMatchObject({
      code: ERROR_CODES.aiUpstreamError,
      status: 502,
    });
  });

  it('stream() menggabungkan delta SSE dan mengembalikan statistik', async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Halo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" dunia"}}]}\n\n',
      'data: {"model":"gemini/gemini-3.1-flash-lite","choices":[{"delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetchMock = jest.fn().mockResolvedValue(new Response(sseBody, { status: 200 }));
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'kunci',
      fetchImpl: fetchMock,
    });

    let text = '';
    const result = await (async () => {
      const generator = provider.stream(options);
      for (;;) {
        const next = await generator.next();
        if (next.done) return next.value;
        text += next.value;
      }
    })();

    expect(text).toBe('Halo dunia');
    expect(result).toMatchObject({
      content: 'Halo dunia',
      model: 'gemini/gemini-3.1-flash-lite',
      tokensIn: 7,
      tokensOut: 3,
    });

    const request = fetchMock.mock.calls[0]![1] as { body: string };
    expect(JSON.parse(request.body)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });
});

describe('AnthropicProvider', () => {
  it('chat() memetakan blok teks dan pemakaian token', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'claude-sonnet',
          content: [{ type: 'text', text: 'Hasil kerja.' }],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
        { status: 200 },
      ),
    );
    const provider = new AnthropicProvider({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'kunci',
      fetchImpl: fetchMock,
    });
    const result = await provider.chat({
      model: 'claude-sonnet',
      systemPrompt: 'Kamu pembantu.',
      messages: [{ role: 'user', content: 'Kerjakan' }],
      maxTokens: 100,
    });
    expect(result.content).toBe('Hasil kerja.');
    expect(result.tokensIn).toBe(12);
    expect(result.tokensOut).toBe(4);

    const request = fetchMock.mock.calls[0]![1] as {
      headers: Record<string, string>;
      body: string;
    };
    expect(request.headers['x-api-key']).toBe('kunci');
    expect(JSON.parse(request.body)).toMatchObject({ system: 'Kamu pembantu.' });
  });

  it('stream() membaca usage dari message_start dan message_delta', async () => {
    const sseBody = [
      'event: message_start\n',
      'data: {"type":"message_start","message":{"model":"claude-sonnet","usage":{"input_tokens":9,"output_tokens":1}}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Halo"}}\n\n',
      'event: message_delta\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
      'event: message_stop\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');
    const fetchMock = jest.fn().mockResolvedValue(new Response(sseBody, { status: 200 }));
    const provider = new AnthropicProvider({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'kunci',
      fetchImpl: fetchMock,
    });

    let text = '';
    const result = await (async () => {
      const generator = provider.stream({
        model: 'claude-sonnet',
        systemPrompt: 'Kamu pembantu.',
        messages: [{ role: 'user', content: 'Kerjakan' }],
        maxTokens: 100,
      });
      for (;;) {
        const next = await generator.next();
        if (next.done) return next.value;
        text += next.value;
      }
    })();

    expect(text).toBe('Halo');
    expect(result).toMatchObject({
      content: 'Halo',
      model: 'claude-sonnet',
      tokensIn: 9,
      tokensOut: 4,
    });

    const request = fetchMock.mock.calls[0]![1] as { body: string };
    expect(JSON.parse(request.body)).toMatchObject({ stream: true });
  });
});
