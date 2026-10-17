import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { ERROR_CODES } from '../../src/common/errors/app-error';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures } from './helpers/reset-db';
import { createMockAiGateway, createTestApp, type MockAiGateway } from './helpers/test-app';

async function readSseText(
  server: unknown,
  client: AuthedClient,
  body: Record<string, unknown>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    request(server as Parameters<typeof request>[0])
      .post('/api/ai/chat/stream')
      .set('Cookie', client.cookies)
      .set('X-CSRF-Token', client.csrfToken)
      .send(body)
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf-8');
        });
        res.on('end', () => callback(null, data));
      })
      .expect(200)
      .end((err, res) => {
        if (err) reject(err);
        else resolve(res.body as string);
      });
  });
}

describe('AI Workspace (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let mockAi: MockAiGateway;
  let manager: AuthedClient;
  let staf: AuthedClient;
  let admin: AuthedClient;

  beforeAll(async () => {
    mockAi = createMockAiGateway();
    const ctx = await createTestApp({ mockAi });
    app = ctx.app;
    dataSource = ctx.dataSource;
    await resetDatabase(dataSource);
    await seedTestFixtures(dataSource);
    manager = await loginAs(app, 'manager@test.local');
    staf = await loginAs(app, 'staf@test.local');
    admin = await loginAs(app, 'admin@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockAi.chat.mockReset();
    mockAi.stream.mockReset();
    mockAi.chat.mockResolvedValue({
      content: 'Jawaban uji dari penyedia AI.',
      model: 'model-uji',
      tokensIn: 11,
      tokensOut: 7,
    });
  });

  it('tanpa sesi ditolak 401', async () => {
    const res = await request(app.getHttpServer()).post('/api/ai/chat').send({
      mode: 'second_brain',
      prompt: 'Apa itu cuti tahunan?',
    });
    expect(res.status).toBe(401);
  });

  it('staf tanpa izin secondbrain ditolak 403', async () => {
    const res = await asClient(app, staf).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Apa itu cuti tahunan?',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.forbidden);
    expect(res.body.error.details.missing).toContain('ai.secondbrain.query');
  });

  it('manajer dapat chat second_brain: percakapan baru, pesan tersimpan, tercatat audit', async () => {
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Apa kebijakan cuti tahunan?',
    });
    expect(res.status).toBe(200);
    expect(mockAi.chat).toHaveBeenCalledTimes(1);
    const { conversation, assistant } = res.body.data;
    expect(conversation.mode).toBe('second_brain');
    expect(conversation.title).toContain('kebijakan cuti');
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0]).toMatchObject({ role: 'user' });
    expect(conversation.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Jawaban uji dari penyedia AI.',
      model: 'model-uji',
      tokens_in: 11,
      tokens_out: 7,
    });
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: 'Jawaban uji dari penyedia AI.',
      model: 'model-uji',
      tokens_in: 11,
      tokens_out: 7,
    });

    const audits = (await dataSource.query(
      `SELECT event_key FROM audit_events WHERE event_key = 'ai.conversation.created' AND actor_user_id = $1`,
      [manager.userId],
    )) as { event_key: string }[];
    expect(audits.length).toBe(1);
  });

  it('lanjutan chat memakai conversationId dan menumpuk pesan', async () => {
    const pertama = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Pertanyaan pertama',
    });
    const conversationId = pertama.body.data.conversation.id as string;

    const lanjut = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Pertanyaan lanjutan',
      conversationId,
    });
    expect(lanjut.status).toBe(200);
    expect(lanjut.body.data.conversation.messages).toHaveLength(4);
    expect(mockAi.chat).toHaveBeenCalledTimes(2);
    const riwayatDikirim = mockAi.chat.mock.calls[1]![0].messages as Array<{ content: string }>;
    expect(riwayatDikirim.map((m) => m.content)).toEqual([
      'Pertanyaan pertama',
      'Jawaban uji dari penyedia AI.',
      'Pertanyaan lanjutan',
    ]);
  });

  it('mode counterpart menerima gaya interaksi dan menolak gaya asing', async () => {
    const ok = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'counterpart',
      counterpartStyle: 'challenger',
      prompt: 'Bagaimana kalau kita migrasi ke cloud?',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.conversation.mode).toBe('counterpart');
    expect(ok.body.data.conversation.counterpart_style).toBe('challenger');

    const gagal = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'counterpart',
      counterpartStyle: 'gaya-gaib',
      prompt: 'Tes',
    });
    expect(gagal.status).toBe(400);
  });

  it('percakapan orang lain tidak dapat dibaca (404) meski punya izin history', async () => {
    const milikManager = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Rahasia internal',
    });
    const id = milikManager.body.data.conversation.id as string;
    const res = await asClient(app, admin).get(`/api/ai/conversations/${id}`);
    expect(res.status).toBe(404);
  });

  it('manajer tanpa izin history.read ditolak 403; pemilik dapat melihat daftar miliknya', async () => {
    const resManager = await asClient(app, manager).get('/api/ai/conversations');
    expect(resManager.status).toBe(403);
    expect(resManager.body.error.details.missing).toContain('ai.workspace.history.read');

    // Admin punya izin history; daftar bersifat ruang lingkup milik-sendiri,
    // jadi admin hanya melihat percakapan yang ia buat sendiri.
    await asClient(app, admin).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Percakapan milik admin',
    });
    const resAdmin = await asClient(app, admin).get('/api/ai/conversations');
    expect(resAdmin.status).toBe(200);
    expect(Array.isArray(resAdmin.body.data)).toBe(true);
    expect(resAdmin.body.meta.total).toBe(1);
    expect(resAdmin.body.data[0].title).toContain('Percakapan milik admin');
  });

  it('daftar percakapan menerima filter mode persis seperti kiriman UI', async () => {
    await asClient(app, admin).post('/api/ai/chat', {
      mode: 'counterpart',
      counterpartStyle: 'challenger',
      prompt: 'Uji mitra berpikir admin',
    });

    // Query string ini yang dikirim ChatWorkspace saat memuat riwayat.
    const otakKedua = await asClient(app, admin).get(
      '/api/ai/conversations?mode=second_brain&page=1&pageSize=50',
    );
    expect(otakKedua.status).toBe(200);
    expect(otakKedua.body.meta.total).toBe(1);
    expect(otakKedua.body.data.map((row: { mode: string }) => row.mode)).toEqual(['second_brain']);

    const mitra = await asClient(app, admin).get(
      '/api/ai/conversations?mode=counterpart&page=1&pageSize=50',
    );
    expect(mitra.status).toBe(200);
    expect(mitra.body.meta.total).toBe(1);
    expect(mitra.body.data[0]).toMatchObject({
      mode: 'counterpart',
      counterpart_style: 'challenger',
    });

    const modeAsing = await asClient(app, admin).get('/api/ai/conversations?mode=third_brain');
    expect(modeAsing.status).toBe(400);
    expect(modeAsing.body.error.code).toBe(ERROR_CODES.validation);
  });

  it('pemilik dapat mengganti judul, membintangi, dan mencari percakapannya', async () => {
    const created = await asClient(app, admin).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Percakapan untuk dikelola',
    });
    const id = created.body.data.conversation.id as string;

    const renamed = await asClient(app, admin)
      .patch(`/api/ai/conversations/${id}`)
      .send({ title: 'Judul Baru dari Pengguna' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ id, title: 'Judul Baru dari Pengguna' });

    const starred = await asClient(app, admin)
      .patch(`/api/ai/conversations/${id}`)
      .send({ starred: true });
    expect(starred.status).toBe(200);
    expect(starred.body.data.starred_at).not.toBeNull();

    const byTitle = await asClient(app, admin).get(
      '/api/ai/conversations?search=Judul%20Baru&page=1&pageSize=50',
    );
    expect(byTitle.status).toBe(200);
    expect(byTitle.body.meta.total).toBe(1);
    expect(byTitle.body.data[0].id).toBe(id);

    const byContent = await asClient(app, admin).get(
      '/api/ai/conversations?search=Percakapan%20untuk%20dikelola&page=1&pageSize=50',
    );
    expect(byContent.status).toBe(200);
    expect(byContent.body.data.map((row: { id: string }) => row.id)).toContain(id);

    const empty = await asClient(app, admin).get(
      '/api/ai/conversations?search=tidak-ada-yang-cocok-xyz&page=1&pageSize=50',
    );
    expect(empty.status).toBe(200);
    expect(empty.body.meta.total).toBe(0);

    // Manajer tidak memegang ai.workspace.history.read, jadi ditolak guard sebelum scope dicek.
    const foreign = await asClient(app, manager)
      .patch(`/api/ai/conversations/${id}`)
      .send({ title: 'Coba ubah milik orang' });
    expect(foreign.status).toBe(403);

    const missing = await asClient(app, admin)
      .patch('/api/ai/conversations/00000000-0000-4000-8000-000000000000')
      .send({ title: 'Tidak ada' });
    expect(missing.status).toBe(404);
  });

  it('membuat ulang jawaban asisten terakhir menggantikan jawaban lama', async () => {
    const created = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Pertanyaan untuk regenerate',
    });
    const id = created.body.data.conversation.id as string;
    expect(created.body.data.conversation.messages).toHaveLength(2);

    mockAi.chat.mockResolvedValueOnce({
      content: 'Jawaban versi kedua.',
      model: 'model-uji-2',
      tokensIn: 3,
      tokensOut: 4,
    });
    const regen = await asClient(app, manager).post(`/api/ai/conversations/${id}/regenerate`);
    expect(regen.status).toBe(200);
    const { conversation, assistant } = regen.body.data;
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0].content).toBe('Pertanyaan untuk regenerate');
    expect(conversation.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Jawaban versi kedua.',
      model: 'model-uji-2',
      tokens_in: 3,
      tokens_out: 4,
    });
    expect(assistant.content).toBe('Jawaban versi kedua.');
    expect(assistant).toMatchObject({ tokens_in: 3, tokens_out: 4 });

    const foreign = await asClient(app, admin).post(`/api/ai/conversations/${id}/regenerate`);
    expect(foreign.status).toBe(404);
  });

  it('streaming SSE mengirim ready, delta, dan done; pesan asisten tersimpan', async () => {
    async function* potongan() {
      yield 'Potongan satu. ';
      yield 'Potongan dua.';
      return {
        content: 'Potongan satu. Potongan dua.',
        model: 'model-uji',
        tokensIn: 5,
        tokensOut: 6,
      };
    }
    mockAi.stream.mockReturnValue(potongan());

    const body = await readSseText(app.getHttpServer(), manager, {
      mode: 'second_brain',
      prompt: 'Jawab dengan streaming',
    });
    expect(body).toContain('event: ready');
    expect(body).toContain('event: delta');
    expect(body).toContain('Potongan satu. ');
    expect(body).toContain('event: done');
    expect(body).toContain('"tokens_in":5');
    expect(body).toContain('"tokens_out":6');

    const tersimpan = (await dataSource.query(
      `SELECT content, tokens_in, tokens_out FROM conversation_messages WHERE role = 'assistant' ORDER BY id DESC LIMIT 1`,
    )) as { content: string; tokens_in: number; tokens_out: number }[];
    expect(tersimpan[0]).toMatchObject({
      content: 'Potongan satu. Potongan dua.',
      tokens_in: 5,
      tokens_out: 6,
    });
  });

  it('staf tanpa izin subordinate.execute ditolak membuat tugas', async () => {
    const res = await asClient(app, staf).post('/api/ai/tasks', {
      title: 'Ringkas data',
      instruction: 'Ringkas data penjualan kuartal ini.',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.details.missing).toContain('ai.subordinate.execute');
  });

  it('siklus tugas lengkap: created → validating → running → completed', async () => {
    const dibuat = await asClient(app, manager).post('/api/ai/tasks', {
      title: 'Susun ringkasan',
      instruction: 'Susun ringkasan singkat tentang tata kelola TI.',
    });
    expect(dibuat.status).toBe(201);
    expect(dibuat.body.data.status).toBe('created');
    const taskId = dibuat.body.data.id as string;

    const dijalankan = await asClient(app, manager).post(`/api/ai/tasks/${taskId}/run`);
    expect(dijalankan.status).toBe(200);
    expect(dijalankan.body.data.status).toBe('completed');
    expect(dijalankan.body.data.result).toBe('Jawaban uji dari penyedia AI.');
    expect(dijalankan.body.data.duration_ms).not.toBeNull();

    const detail = await asClient(app, manager).get(`/api/ai/tasks/${taskId}`);
    expect(detail.status).toBe(200);
    const urutan = detail.body.data.events.map((e: { event_type: string }) => e.event_type);
    expect(urutan).toEqual(['created', 'validating', 'running', 'completed']);

    const audits = (await dataSource.query(
      `SELECT event_key FROM audit_events
        WHERE entity_type = 'ai_task' AND entity_id = $1
        ORDER BY id`,
      [taskId],
    )) as { event_key: string }[];
    expect(audits.map((a) => a.event_key)).toEqual(['ai.task.created', 'ai.task.completed']);
  });

  it('kegagalan penyedia AI menandai tugas failed dan tercatat audit', async () => {
    mockAi.chat.mockRejectedValueOnce(new Error('penyedia sedang down'));
    const dibuat = await asClient(app, manager).post('/api/ai/tasks', {
      title: 'Tugas gagal',
      instruction: 'Instruksi yang akan gagal dijalankan.',
    });
    const taskId = dibuat.body.data.id as string;

    const dijalankan = await asClient(app, manager).post(`/api/ai/tasks/${taskId}/run`);
    expect(dijalankan.status).toBe(200);
    expect(dijalankan.body.data.status).toBe('failed');
    expect(dijalankan.body.data.error_message).toContain('penyedia sedang down');

    const audits = (await dataSource.query(
      `SELECT event_key FROM audit_events
        WHERE entity_type = 'ai_task' AND entity_id = $1 AND event_key = 'ai.task.failed'`,
      [taskId],
    )) as { event_key: string }[];
    expect(audits.length).toBe(1);
  });

  it('tugas completed tidak dapat dijalankan ulang (409)', async () => {
    const dibuat = await asClient(app, manager).post('/api/ai/tasks', {
      title: 'Jalankan sekali',
      instruction: 'Eksekusi satu kali saja.',
    });
    const taskId = dibuat.body.data.id as string;
    await asClient(app, manager).post(`/api/ai/tasks/${taskId}/run`);
    const ulang = await asClient(app, manager).post(`/api/ai/tasks/${taskId}/run`);
    expect(ulang.status).toBe(409);
  });

  it('tugas created dapat dibatalkan, tercatat audit', async () => {
    const dibuat = await asClient(app, manager).post('/api/ai/tasks', {
      title: 'Tugas dibatalkan',
      instruction: 'Instruksi yang tidak jadi dijalankan.',
    });
    const taskId = dibuat.body.data.id as string;
    const batal = await asClient(app, manager).post(`/api/ai/tasks/${taskId}/cancel`);
    expect(batal.status).toBe(200);
    expect(batal.body.data.status).toBe('cancelled');

    const detail = await asClient(app, manager).get(`/api/ai/tasks/${taskId}`);
    const urutan = detail.body.data.events.map((e: { event_type: string }) => e.event_type);
    expect(urutan).toEqual(['created', 'cancelled']);
  });

  it('tugas milik orang lain tidak dapat dijalankan (404)', async () => {
    const dibuat = await asClient(app, manager).post('/api/ai/tasks', {
      title: 'Tugas privat',
      instruction: 'Instruksi rahasia milik manajer.',
    });
    const taskId = dibuat.body.data.id as string;
    const res = await asClient(app, admin).post(`/api/ai/tasks/${taskId}/run`);
    expect(res.status).toBe(404);
  });
});
