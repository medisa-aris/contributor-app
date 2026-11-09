import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures } from './helpers/reset-db';
import { createMockAiGateway, createTestApp, type MockAiGateway } from './helpers/test-app';

describe('Pencarian web (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let mockAi: MockAiGateway;
  let manager: AuthedClient;
  let admin: AuthedClient;

  beforeAll(async () => {
    mockAi = createMockAiGateway();
    const ctx = await createTestApp({ mockAi });
    app = ctx.app;
    dataSource = ctx.dataSource;
    // Tes ini mengasumsikan tanpa key penyedia, walau .env lokal berisi key sungguhan.
    const config = app.get(ConfigService);
    const get = config.get.bind(config) as (key: string, fallback?: unknown) => unknown;
    jest
      .spyOn(config, 'get')
      .mockImplementation((key: string, fallback?: unknown) =>
        /^app\.(tavily|firecrawl|braveSearch)ApiKey$/.test(key) ? null : get(key, fallback),
      );
    await resetDatabase(dataSource);
    await seedTestFixtures(dataSource);
    manager = await loginAs(app, 'manager@test.local');
    admin = await loginAs(app, 'admin@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockAi.chat.mockReset();
    mockAi.chat.mockResolvedValue({
      content: 'Jawaban.',
      model: 'model-uji',
      tokensIn: 1,
      tokensOut: 1,
    });
  });

  it('menolak webSearch:true tanpa izin, tanpa memanggil AI', async () => {
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Halo',
      webSearch: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.details.missing).toEqual(['ai.websearch.use']);
    expect(mockAi.chat).not.toHaveBeenCalled();
  });

  it('menolak webSearch:true pada endpoint streaming sebelum SSE dibuka', async () => {
    const res = await asClient(app, manager).post('/api/ai/chat/stream', {
      mode: 'second_brain',
      prompt: 'Halo',
      webSearch: true,
    });
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('webSearch:false tetap boleh tanpa izin', async () => {
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Halo',
      webSearch: false,
    });
    expect(res.status).toBe(200);
  });

  it('bawaan nonaktif dan opsi tersimpan per percakapan', async () => {
    const client = asClient(app, admin);
    const first = await client.post('/api/ai/chat', { mode: 'second_brain', prompt: 'Satu' });
    expect(first.status).toBe(200);
    expect(first.body.data.conversation.web_search).toBe(false);

    const id = first.body.data.conversation.id as string;
    const second = await client.post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Dua',
      conversationId: id,
      webSearch: true,
    });
    expect(second.body.data.conversation.web_search).toBe(true);

    const detail = await client.get(`/api/ai/conversations/${id}`);
    expect(detail.body.data.web_search).toBe(true);
  });

  it('status hanya untuk pemegang izin dan tidak membuka nama penyedia', async () => {
    expect((await asClient(app, manager).get('/api/ai/web-search/status')).status).toBe(403);
    const res = await asClient(app, admin).get('/api/ai/web-search/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ available: false });
  });

  it('tugas: webSearch butuh izin dan tersimpan', async () => {
    const payload = { title: 'Riset', instruction: 'Cari tren terbaru', webSearch: true };
    expect((await asClient(app, manager).post('/api/ai/tasks', payload)).status).toBe(403);
    const created = await asClient(app, admin).post('/api/ai/tasks', payload);
    expect(created.status).toBe(201);
    expect(created.body.data.web_search).toBe(true);
    const plain = await asClient(app, admin).post('/api/ai/tasks', {
      title: 'Biasa',
      instruction: 'Tanpa web',
    });
    expect(plain.body.data.web_search).toBe(false);
  });

  describe('prioritas penyedia', () => {
    it('daftar berisi status boolean saja, bukan nilai key', async () => {
      const res = await asClient(app, admin).get('/api/admin/web-search/providers');
      expect(res.status).toBe(200);
      expect(res.body.data.map((p: { id: string }) => p.id).sort()).toEqual([
        'brave',
        'firecrawl',
        'tavily',
      ]);
      for (const provider of res.body.data) {
        expect(Object.keys(provider).sort()).toEqual(['configured', 'id', 'name']);
      }
    });

    it('butuh config.manage', async () => {
      const res = await asClient(app, manager).put('/api/admin/web-search/priority', {
        order: ['brave', 'tavily', 'firecrawl'],
      });
      expect(res.status).toBe(403);
    });

    it.each([
      [['brave', 'tavily']],
      [['brave', 'brave', 'tavily']],
      [['brave', 'tavily', 'google']],
      ['brave'],
    ])('menolak daftar yang tidak lengkap: %j', async (order) => {
      const res = await asClient(app, admin).put('/api/admin/web-search/priority', { order });
      expect(res.status).toBe(400);
    });

    it('menyimpan urutan baru', async () => {
      const client = asClient(app, admin);
      const order = ['brave', 'tavily', 'firecrawl'];
      expect((await client.put('/api/admin/web-search/priority', { order })).status).toBe(200);
      const res = await client.get('/api/admin/web-search/providers');
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual(order);
    });
  });
});
