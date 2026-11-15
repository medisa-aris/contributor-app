import {
  quotaWindow,
  resolveAccess,
  resolveAgentAccess,
  type GrantRow,
} from '../../src/modules/ai/models/model-access';
import { scrubSecrets } from '../../src/modules/ai/models/model-catalog.service';

const subject = { userId: 'u1', departmentChain: ['d-child', 'd-parent'] };

function row(partial: Partial<GrantRow>): GrantRow {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    targetType: 'user',
    targetId: 'u1',
    includeSubDepartments: true,
    modelId: 'm1',
    tokenLimit: 1000,
    period: 'day',
    grantedScope: 'admin',
    createdBy: 'admin',
    label: 'uji',
    ...partial,
  };
}

describe('resolusi izin model', () => {
  it('izin pribadi > departemen terdekat > departemen induk > semua orang', () => {
    const rows = [
      row({ id: 'everyone', targetType: 'everyone', targetId: null, tokenLimit: 10 }),
      row({ id: 'parent', targetType: 'department', targetId: 'd-parent', tokenLimit: 20 }),
      row({ id: 'child', targetType: 'department', targetId: 'd-child', tokenLimit: 30 }),
    ];
    expect(resolveAccess(rows, subject, null).models.get('m1')!.get('day')!.grantId).toBe('child');
    rows.push(row({ id: 'personal', tokenLimit: 40 }));
    expect(resolveAccess(rows, subject, null).models.get('m1')!.get('day')!.grantId).toBe('personal');
  });

  it('setingkat: batas terendah menang dan angka mana pun mengalahkan tanpa batas', () => {
    const rows = [
      row({ id: 'unlimited', tokenLimit: null }),
      row({ id: 'leader', tokenLimit: 3000, grantedScope: 'leader', createdBy: 'leader' }),
      row({ id: 'admin', tokenLimit: 2000 }),
    ];
    expect(resolveAccess(rows, subject, null).models.get('m1')!.get('day')).toMatchObject({ grantId: 'admin', limit: 2000 });
  });

  it('sub-departemen hanya bila includeSubDepartments; izin leader tidak berlaku bagi pembuatnya', () => {
    const noSub = [row({ targetType: 'department', targetId: 'd-parent', includeSubDepartments: false })];
    expect(resolveAccess(noSub, subject, null).models.size).toBe(0);
    const own = [row({ targetType: 'department', targetId: 'd-child', grantedScope: 'leader', createdBy: 'u1' })];
    expect(resolveAccess(own, subject, null).models.size).toBe(0);
  });

  it('harian dan mingguan disimpan terpisah; model bawaan diabaikan', () => {
    const rows = [row({ period: 'day', tokenLimit: 100 }), row({ period: 'week', tokenLimit: 500 }), row({ modelId: 'def' })];
    const access = resolveAccess(rows, subject, 'def');
    expect([...access.models.get('m1')!.keys()].sort()).toEqual(['day', 'week']);
    expect(access.models.has('def')).toBe(false);
  });

  it('izin agent hanya untuk agent itu, terendah per periode', () => {
    const rows = [
      row({ targetType: 'agent', targetId: 'ag1', tokenLimit: 500 }),
      row({ targetType: 'agent', targetId: 'ag1', tokenLimit: 200 }),
      row({ targetType: 'agent', targetId: 'ag2', tokenLimit: 1 }),
    ];
    expect(resolveAgentAccess(rows, 'ag1', null)!.models.get('m1')!.get('day')!.limit).toBe(200);
    expect(resolveAgentAccess(rows, 'ag3', null)).toBeNull();
  });
});

describe('jendela kuota (Asia/Jakarta, UTC+7)', () => {
  it('hari mulai 00:00 WIB', () => {
    // 2026-11-15 16:59 UTC = 23:59 WIB tanggal 15.
    const late = quotaWindow('day', new Date('2026-11-15T16:59:00Z'), 'Asia/Jakarta');
    expect(late.start.toISOString()).toBe('2026-11-14T17:00:00.000Z');
    expect(late.end.toISOString()).toBe('2026-11-15T17:00:00.000Z');
    // 17:00 UTC = 00:00 WIB tanggal 16: jendela baru.
    const next = quotaWindow('day', new Date('2026-11-15T17:00:00Z'), 'Asia/Jakarta');
    expect(next.start.toISOString()).toBe('2026-11-15T17:00:00.000Z');
  });

  it('minggu mulai Senin 00:00 WIB', () => {
    // Minggu 15 Nov 2026 siang WIB → minggu dimulai Senin 9 Nov 00:00 WIB.
    const sunday = quotaWindow('week', new Date('2026-11-15T05:00:00Z'), 'Asia/Jakarta');
    expect(sunday.start.toISOString()).toBe('2026-11-08T17:00:00.000Z');
    expect(sunday.end.toISOString()).toBe('2026-11-15T17:00:00.000Z');
    const monday = quotaWindow('week', new Date('2026-11-15T17:30:00Z'), 'Asia/Jakarta');
    expect(monday.start.toISOString()).toBe('2026-11-15T17:00:00.000Z');
  });
});

describe('penyamaran kredensial pada galat penyedia', () => {
  it('menyamarkan kunci API dan bearer token', () => {
    const text = scrubSecrets('invalid x-api-key: sk-ant-abc123456789 Bearer abcdefghijkl');
    expect(text).not.toContain('abc123456789');
    expect(text).not.toContain('abcdefghijkl');
  });
});

describe('pencarian model dari penyedia', () => {
  async function discover(code: 'openrouter' | 'anthropic' | 'ollama', responses: Record<string, unknown>) {
    const { ModelCatalogService } = await import('../../src/modules/ai/models/model-catalog.service');
    const registry = { listHeaders: () => ({}) };
    const service = new ModelCatalogService({} as never, {} as never, registry as never);
    const fetchImpl = ((url: string) => {
      const body = Object.entries(responses).find(([suffix]) => url.endsWith(suffix))?.[1];
      return Promise.resolve(
        body === undefined
          ? new Response('tidak ada', { status: 404 })
          : new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    }) as typeof fetch;
    return (service as unknown as { fetchModelList: (c: string, b: string, f: typeof fetch) => Promise<unknown[]> }).fetchModelList(
      code,
      code === 'ollama' ? 'http://ollama.local/v1' : 'https://x/v1',
      fetchImpl,
    );
  }

  it('OpenRouter: konteks, keluaran, tools, dan gambar dari metadata', async () => {
    const items = await discover('openrouter', {
      '/models': {
        data: [
          {
            id: 'a/b',
            name: 'Model B',
            context_length: 1000,
            top_provider: { max_completion_tokens: 200 },
            supported_parameters: ['tools'],
            architecture: { input_modalities: ['text', 'image'] },
          },
        ],
      },
    });
    expect(items).toEqual([
      { modelKey: 'a/b', displayName: 'Model B', contextWindow: 1000, maxOutputTokens: 200, supportsTools: true, supportsVision: true },
    ]);
  });

  it('Anthropic: display_name dan batas token', async () => {
    const items = await discover('anthropic', {
      '/models': { data: [{ id: 'claude-x', display_name: 'Claude X', max_input_tokens: 1_000_000, max_tokens: 128_000 }] },
    });
    expect(items[0]).toMatchObject({ modelKey: 'claude-x', displayName: 'Claude X', contextWindow: 1_000_000, maxOutputTokens: 128_000 });
  });

  it('Ollama: jatuh ke /api/tags bila endpoint kompatibel OpenAI tidak ada', async () => {
    const items = await discover('ollama', { '/api/tags': { models: [{ name: 'qwen2.5:3b' }] } });
    expect(items).toEqual([
      { modelKey: 'qwen2.5:3b', displayName: 'qwen2.5:3b', contextWindow: null, maxOutputTokens: null, supportsTools: null, supportsVision: null },
    ]);
  });
});
