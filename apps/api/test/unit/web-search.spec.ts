import { ConfigService } from '@nestjs/config';
import { PERMISSIONS } from '@bara/shared';
import type { DataSource } from 'typeorm';
import { AppError } from '../../src/common/errors/app-error';
import type { AuthContext } from '../../src/common/types/auth-context';
import type { AuditService } from '../../src/modules/audit/audit.service';
import type { EffectivePermissionsService } from '../../src/modules/rbac/effective-permissions.service';
import { braveAdapter } from '../../src/modules/ai/web-search/brave.adapter';
import { firecrawlAdapter } from '../../src/modules/ai/web-search/firecrawl.adapter';
import { classifyError } from '../../src/modules/ai/web-search/http';
import { tavilyAdapter } from '../../src/modules/ai/web-search/tavily.adapter';
import type { WebRequestContext } from '../../src/modules/ai/web-search/types';
import {
  normalizePriority,
  WEB_READ_TOOL,
  WEB_SEARCH_TOOL,
  WebSearchService,
  WebSearchUnavailableError,
} from '../../src/modules/ai/web-search/web-search.service';
import type { WebSourceService } from '../../src/modules/ai/web-source.service';

type Keys = Partial<Record<'tavily' | 'firecrawl' | 'brave', string>>;

const TAVILY_OK = { results: [{ title: 'T', url: 'https://t.example', content: 'isi tavily' }] };
const FIRECRAWL_OK = {
  success: true,
  data: { web: [{ title: 'F', url: 'https://f.example', description: 'isi firecrawl' }] },
};
const BRAVE_OK = {
  web: { results: [{ title: 'B', url: 'https://b.example', description: 'isi' }] },
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const fetchMock = jest.spyOn(global, 'fetch');

/** Antrean respons per penyedia, dipilih dari host URL. */
function respondWith(
  queues: Partial<Record<'tavily' | 'firecrawl' | 'brave', Array<() => Response>>>,
) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    const id = url.includes('tavily')
      ? 'tavily'
      : url.includes('firecrawl')
        ? 'firecrawl'
        : 'brave';
    const next = queues[id]?.shift();
    if (!next) throw new Error(`panggilan tak terduga ke ${id}`);
    return next();
  });
}

function callsTo(host: string): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(host)).length;
}

function build(keys: Keys, stored: unknown = ['tavily', 'firecrawl', 'brave']) {
  const values: Record<string, unknown> = {
    'app.tavilyApiKey': keys.tavily ?? null,
    'app.firecrawlApiKey': keys.firecrawl ?? null,
    'app.braveSearchApiKey': keys.brave ?? null,
    'app.webSearchMaxAttempts': 3,
    'app.webSearchTimeoutMs': 1000,
    'app.webSearchMaxResults': 5,
    'app.webSearchMaxCallsPerTurn': 2,
  };
  const config = {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
  } as unknown as ConfigService;
  const dataSource = { query: jest.fn().mockResolvedValue([{ value: stored }]) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const permissions = { can: jest.fn().mockResolvedValue({ allowed: true }) };
  const webSource = {
    fetch: jest
      .fn()
      .mockResolvedValue({ finalUrl: 'https://8.8.8.8/', title: 'Bawaan', text: 'isi' }),
  };
  const service = new WebSearchService(
    dataSource as unknown as DataSource,
    config,
    webSource as unknown as WebSourceService,
    audit as unknown as AuditService,
    permissions as unknown as EffectivePermissionsService,
  );
  const wait = jest
    .spyOn(service as unknown as { wait: (ms: number) => Promise<void> }, 'wait')
    .mockResolvedValue(undefined);
  return { service, audit, permissions, webSource, wait };
}

const ctx: WebRequestContext = { apiKey: 'k', maxResults: 3, signal: new AbortController().signal };

afterEach(() => fetchMock.mockReset());
afterAll(() => fetchMock.mockRestore());

describe('web search: klasifikasi kesalahan', () => {
  it.each([401, 402, 403, 432, 433])('HTTP %i masalah akun', (status) => {
    expect(classifyError(status)).toBe('account');
  });

  it.each([408, 429, 434, 500, 502, 503])('HTTP %i gangguan teknis', (status) => {
    expect(classifyError(status)).toBe('technical');
  });

  it.each([400, 404, 422])('HTTP %i permintaan ditolak', (status) => {
    expect(classifyError(status)).toBe('bad_request');
  });

  it('kode badan respons mengalahkan status HTTP', () => {
    expect(classifyError(422, 'SUBSCRIPTION_TOKEN_INVALID')).toBe('account');
    expect(classifyError(429, 'QUOTA_LIMITED')).toBe('account');
    expect(classifyError(429, 'RATE_LIMITED')).toBe('technical');
  });
});

describe('web search: adapter', () => {
  it('Tavily memetakan hasil dan mengirim Bearer', async () => {
    respondWith({ tavily: [() => json(200, TAVILY_OK)] });
    await expect(tavilyAdapter.search('q', ctx)).resolves.toEqual([
      { title: 'T', url: 'https://t.example', snippet: 'isi tavily' },
    ]);
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('Tavily extract gagal bila HTTP 200 hanya berisi failed_results', async () => {
    respondWith({ tavily: [() => json(200, { results: [], failed_results: [{ url: 'x' }] })] });
    await expect(tavilyAdapter.extract!('https://a.example', ctx)).rejects.toMatchObject({
      kind: 'technical',
    });
  });

  it('Firecrawl membaca data.web dan menganggap success:false sebagai gangguan', async () => {
    respondWith({
      firecrawl: [() => json(200, FIRECRAWL_OK), () => json(200, { success: false })],
    });
    await expect(firecrawlAdapter.search('q', ctx)).resolves.toEqual([
      { title: 'F', url: 'https://f.example', snippet: 'isi firecrawl' },
    ]);
    await expect(firecrawlAdapter.search('q', ctx)).rejects.toMatchObject({ kind: 'technical' });
  });

  it('Brave membersihkan tag, menggabungkan cuplikan, dan memakai header token', async () => {
    respondWith({
      brave: [
        () =>
          json(200, {
            web: {
              results: [
                {
                  title: 'B &amp; C',
                  url: 'https://b.example',
                  description: '<strong>cuti</strong> tahunan',
                  extra_snippets: ['tambahan'],
                },
              ],
            },
          }),
      ],
    });
    await expect(braveAdapter.search('q', ctx)).resolves.toEqual([
      { title: 'B & C', url: 'https://b.example', snippet: 'cuti tahunan … tambahan' },
    ]);
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('k');
  });

  it('tidak membawa isi respons penyedia ke pesan kesalahan', async () => {
    respondWith({ tavily: [() => json(500, { detail: 'rahasia internal' })] });
    await expect(tavilyAdapter.search('q', ctx)).rejects.toThrow('HTTP 500');
  });
});

describe('web search: rantai prioritas', () => {
  const all: Keys = { tavily: 'a', firecrawl: 'b', brave: 'c' };

  it('gangguan teknis diulang 3 kali lalu pindah ke penyedia berikutnya', async () => {
    const down = () => json(503, {});
    respondWith({ tavily: [down, down, down], firecrawl: [() => json(200, FIRECRAWL_OK)] });
    const { service, wait } = build(all);
    const result = await service.search('q');
    expect(result.provider).toBe('firecrawl');
    expect(callsTo('tavily')).toBe(3);
    expect(result.skipped).toEqual([{ provider: 'tavily', reason: 'technical', attempts: 3 }]);
    expect(wait.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it('berhasil pada percobaan kedua tanpa berpindah penyedia', async () => {
    respondWith({ tavily: [() => json(500, {}), () => json(200, TAVILY_OK)] });
    const result = await build(all).service.search('q');
    expect(result).toMatchObject({ provider: 'tavily', attempts: 2, skipped: [] });
  });

  it.each([401, 432, 433])(
    'masalah akun (HTTP %i) langsung pindah tanpa diulang',
    async (status) => {
      respondWith({ tavily: [() => json(status, {})], firecrawl: [() => json(200, FIRECRAWL_OK)] });
      const result = await build(all).service.search('q');
      expect(result.provider).toBe('firecrawl');
      expect(callsTo('tavily')).toBe(1);
      expect(result.skipped[0]).toEqual({ provider: 'tavily', reason: 'account', attempts: 1 });
    },
  );

  it('token Brave tidak valid dengan HTTP 422 tetap masalah akun', async () => {
    respondWith({
      brave: [() => json(422, { error: { code: 'SUBSCRIPTION_TOKEN_INVALID' } })],
      tavily: [() => json(200, TAVILY_OK)],
    });
    const result = await build(all, ['brave', 'tavily', 'firecrawl']).service.search('q');
    expect(result.provider).toBe('tavily');
    expect(callsTo('brave')).toBe(1);
  });

  it('penyedia tanpa key dilewati tanpa panggilan jaringan', async () => {
    respondWith({ brave: [() => json(200, BRAVE_OK)] });
    const result = await build({ brave: 'c' }).service.search('q');
    expect(result.provider).toBe('brave');
    expect(callsTo('tavily') + callsTo('firecrawl')).toBe(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(['no_key', 'no_key']);
  });

  it('mengikuti urutan tersimpan', async () => {
    respondWith({ brave: [() => json(200, BRAVE_OK)] });
    const result = await build(all, ['brave', 'firecrawl', 'tavily']).service.search('q');
    expect(result.provider).toBe('brave');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('nol hasil dianggap berhasil', async () => {
    respondWith({ tavily: [() => json(200, { results: [] })] });
    const result = await build(all).service.search('q');
    expect(result).toMatchObject({ provider: 'tavily', value: [] });
  });

  it('jeda mengikuti Retry-After dengan batas 5 detik', async () => {
    respondWith({
      tavily: [() => json(429, {}, { 'retry-after': '60' }), () => json(200, TAVILY_OK)],
    });
    const { service, wait } = build(all);
    await service.search('q');
    expect(wait.mock.calls[0]![0]).toBe(5000);
  });

  it('tombol Stop menghentikan rantai tanpa berpindah penyedia', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(build(all).service.search('q', controller.signal)).rejects.toThrow('Aborted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('semua gagal menghasilkan kesalahan generik', async () => {
    respondWith({
      tavily: [() => json(401, { detail: 'kunci tvly-rahasia salah' })],
      firecrawl: [() => json(402, {})],
      brave: [() => json(403, {})],
    });
    const error = await build(all)
      .service.search('q')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebSearchUnavailableError);
    expect((error as Error).message).not.toContain('rahasia');
  });
});

describe('web search: urutan tersimpan', () => {
  it('membuang nilai asing/ganda dan melengkapi yang hilang', () => {
    expect(normalizePriority(['brave', 'brave', 'google', 7])).toEqual([
      'brave',
      'tavily',
      'firecrawl',
    ]);
    expect(normalizePriority('rusak')).toEqual(['tavily', 'firecrawl', 'brave']);
    expect(normalizePriority(null)).toEqual(['tavily', 'firecrawl', 'brave']);
  });
});

describe('web search: baca halaman', () => {
  it('menolak URL internal sebelum memanggil penyedia', async () => {
    await expect(
      build({ tavily: 'a' }).service.read('http://127.0.0.1/admin'),
    ).rejects.toBeInstanceOf(AppError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('jatuh ke crawler bawaan bila hanya Brave yang dikonfigurasi', async () => {
    const { service, webSource } = build({ brave: 'c' });
    const result = await service.read('https://8.8.8.8/');
    expect(result.provider).toBe('Crawler bawaan');
    expect(webSource.fetch).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('web search: tool dan izin', () => {
  const toolCall = { id: 'c1', name: WEB_SEARCH_TOOL, input: {} };

  it('membatasi pemanggilan per giliran untuk kedua tool', async () => {
    respondWith({ tavily: [() => json(200, TAVILY_OK), () => json(200, TAVILY_OK)] });
    const handlers = build({ tavily: 'a' }).service.handlers({ userId: 'u' });
    const search = handlers.find((h) => h.tool.name === WEB_SEARCH_TOOL)!;
    const read = handlers.find((h) => h.tool.name === WEB_READ_TOOL)!;
    expect((await search.execute({ query: 'a' }, toolCall)).status).toBe('ok');
    expect((await search.execute({ query: 'b' }, toolCall)).status).toBe('ok');
    const third = await read.execute({ url: 'https://8.8.8.8/' }, toolCall);
    expect(third).toMatchObject({ status: 'error' });
    expect((third as { content: string }).content).toContain('Batas 2');
  });

  it('hasil web ditandai tidak tepercaya dan menyertakan penyedia di data', async () => {
    respondWith({ tavily: [() => json(200, TAVILY_OK)] });
    const [search] = build({ tavily: 'a' }).service.handlers({ userId: 'u' });
    const outcome = await search!.execute({ query: 'q' }, toolCall);
    expect(outcome).toMatchObject({
      status: 'ok',
      data: { source: 'Tavily', summary: '1 hasil' },
    });
    expect((outcome as { content: string }).content).toContain('tidak tepercaya');
  });

  it('audit hanya mencatat metadata, bukan kata kunci', async () => {
    respondWith({ tavily: [() => json(200, TAVILY_OK)] });
    const { service, audit } = build({ tavily: 'a' });
    await service
      .handlers({ userId: 'u', conversationId: 'c' })[0]!
      .execute({ query: 'gaji direktur' }, toolCall);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('gaji');
    expect(audit.record.mock.calls[0]![0].payload).toMatchObject({
      provider: 'tavily',
      attempts: 1,
      resultCount: 1,
    });
  });

  it('assertAllowed menolak permintaan tanpa izin', () => {
    const { service } = build({ tavily: 'a' });
    const denied = { effective: { allowed: new Set<string>() } } as unknown as AuthContext;
    const granted = {
      effective: { allowed: new Set<string>([PERMISSIONS.webSearchUse]) },
    } as unknown as AuthContext;
    expect(() => service.assertAllowed(denied, true)).toThrow(AppError);
    expect(() => service.assertAllowed(denied, false)).not.toThrow();
    expect(() => service.assertAllowed(denied, undefined)).not.toThrow();
    expect(() => service.assertAllowed(granted, true)).not.toThrow();
  });

  it('tugas memeriksa ulang izin pemilik saat dijalankan', async () => {
    const { service, permissions } = build({ tavily: 'a' });
    permissions.can.mockResolvedValueOnce({ allowed: false });
    await expect(service.taskHandlers(true, { userId: 'u' })).resolves.toEqual([]);
    await expect(service.taskHandlers(true, { userId: 'u' })).resolves.toHaveLength(2);
    await expect(service.taskHandlers(false, { userId: 'u' })).resolves.toEqual([]);
    expect(permissions.can).toHaveBeenCalledTimes(2);
  });

  it('tidak tersedia tanpa satu pun key', async () => {
    const { service } = build({});
    expect(service.isAvailable()).toBe(false);
    await expect(service.taskHandlers(true, { userId: 'u' })).resolves.toEqual([]);
  });
});
