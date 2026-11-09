import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures } from './helpers/reset-db';
import { createMockAiGateway, createTestApp, type MockAiGateway } from './helpers/test-app';

const TEST_UPLOAD_DIR = join(process.cwd(), 'var', 'ai-uploads-test-documents');

describe('Dokumen hasil percakapan (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let mockAi: MockAiGateway;
  let manager: AuthedClient;
  let admin: AuthedClient;
  let staf: AuthedClient;
  let uploadDir: string;

  beforeAll(async () => {
    process.env.AI_UPLOAD_DIR = TEST_UPLOAD_DIR;
    mockAi = createMockAiGateway();
    const ctx = await createTestApp({ mockAi });
    app = ctx.app;
    dataSource = ctx.dataSource;
    uploadDir = app.get(ConfigService).get<string>('app.aiUploadDir')!;
    await resetDatabase(dataSource);
    await seedTestFixtures(dataSource);
    manager = await loginAs(app, 'manager@test.local');
    admin = await loginAs(app, 'admin@test.local');
    staf = await loginAs(app, 'staf@test.local');
  });

  afterAll(async () => {
    await app.close();
    await rm(uploadDir, { recursive: true, force: true });
    delete process.env.AI_UPLOAD_DIR;
  });

  beforeEach(() => {
    mockAi.chat.mockReset();
  });

  function toolResult(input: Record<string, unknown>, content = 'Berikut laporannya.') {
    return {
      content,
      model: 'model-uji',
      tokensIn: 10,
      tokensOut: 20,
      toolCalls: [{ id: 'tool-1', name: 'create_document', input }],
    };
  }

  async function createMarkdownDocument(client: AuthedClient) {
    mockAi.chat.mockResolvedValue(
      toolResult({ format: 'md', title: 'Laporan Cuti', content: '# Cuti\n\n12 hari kerja.' }),
    );
    const res = await asClient(app, client).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Buatkan laporan cuti dalam markdown',
    });
    expect(res.status).toBe(200);
    return res.body.data as {
      conversation: { id: string; messages: Array<{ role: string; documents?: unknown[] }> };
      assistant: { id: string; content: string; documents: Array<{ id: string; format: string }> };
    };
  }

  it('chat sinkron: tool create_document menyimpan dokumen dan menautkannya ke pesan', async () => {
    const data = await createMarkdownDocument(manager);
    expect(data.assistant.content).toBe('Berikut laporannya.');
    expect(data.assistant.documents).toHaveLength(1);
    expect(mockAi.chat.mock.calls[0]![0]).toMatchObject({ documents: true });

    const message = data.conversation.messages.find((m) => m.role === 'assistant');
    expect(message?.documents).toHaveLength(1);
  });

  it('daftar, pratinjau, dan unduh dokumen milik sendiri', async () => {
    const list = await asClient(app, manager).get('/api/documents');
    expect(list.status).toBe(200);
    const doc = (list.body.data as Array<{ id: string; title: string; format: string }>)[0]!;
    expect(doc).toMatchObject({ title: 'Laporan Cuti', format: 'md' });

    const preview = await asClient(app, manager).get(`/api/documents/${doc.id}/preview`);
    expect(preview.body.data.text).toContain('12 hari kerja');

    const download = await asClient(app, manager).get(`/api/documents/${doc.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['content-disposition']).toContain('Laporan-Cuti.md');
    expect(download.headers['content-security-policy']).toContain('sandbox');
    expect(download.text).toContain('# Cuti');
  });

  it('pengguna lain tidak dapat melihat, mengunduh, atau menghapus dokumen', async () => {
    const list = await asClient(app, manager).get('/api/documents');
    const id = (list.body.data as Array<{ id: string }>)[0]!.id;

    expect((await asClient(app, admin).get('/api/documents')).body.data).toHaveLength(0);
    expect((await asClient(app, admin).get(`/api/documents/${id}/preview`)).status).toBe(404);
    expect((await asClient(app, admin).get(`/api/documents/${id}/download`)).status).toBe(404);
    expect((await asClient(app, admin).delete(`/api/documents/${id}`)).status).toBe(404);
  });

  it('staf tanpa izin ditolak', async () => {
    const res = await asClient(app, staf).get('/api/documents');
    expect(res.status).toBe(403);
  });

  it('format biner (xlsx, docx, pptx, pdf) dibuat dan dapat diunduh', async () => {
    const specs: Array<[string, Record<string, unknown>, string]> = [
      [
        'xlsx',
        {
          sheets: [
            {
              name: 'Data',
              rows: [
                ['Nama', 'Nilai'],
                ['A', '1'],
              ],
            },
          ],
        },
        'PK',
      ],
      ['docx', { content: '# Judul\n\n- satu\n- dua' }, 'PK'],
      ['pptx', { slides: [{ title: 'Satu', bullets: ['a'] }] }, 'PK'],
      ['pdf', { content: '# Judul\n\nIsi.' }, '%PDF'],
    ];
    for (const [format, extra, magic] of specs) {
      mockAi.chat.mockResolvedValue(toolResult({ format, title: `Berkas ${format}`, ...extra }));
      const res = await asClient(app, manager).post('/api/ai/chat', {
        mode: 'second_brain',
        prompt: `Buat ${format}`,
      });
      const id = res.body.data.assistant.documents[0].id as string;
      const file = await request(app.getHttpServer())
        .get(`/api/documents/${id}/download`)
        .set('Cookie', manager.cookies)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect((file.body as Buffer).subarray(0, magic.length).toString('latin1')).toBe(magic);
    }
  });

  it('spec tidak valid tidak menggagalkan giliran; alasannya ditambahkan ke jawaban', async () => {
    mockAi.chat.mockResolvedValue(
      toolResult({ format: 'json', title: 'Rusak', content: '{bad' }, ''),
    );
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Buat json',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.assistant.documents).toHaveLength(0);
    expect(res.body.data.assistant.content).toContain('gagal dibuat');
  });

  it('streaming SSE: event done membawa dokumen yang dibuat', async () => {
    async function* potongan() {
      yield 'Membuat dokumen. ';
      return toolResult(
        { format: 'html', title: 'Halaman', content: '<h1>Halo</h1>' },
        'Membuat dokumen.',
      );
    }
    mockAi.stream.mockReturnValue(potongan());
    const body = await new Promise<string>((resolve, reject) => {
      request(app.getHttpServer())
        .post('/api/ai/chat/stream')
        .set('Cookie', manager.cookies)
        .set('X-CSRF-Token', manager.csrfToken)
        .send({ mode: 'counterpart', prompt: 'Buat halaman html' })
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString('utf-8')));
          res.on('end', () => callback(null, data));
        })
        .end((err, res) => (err ? reject(err) : resolve(res.body as string)));
    });
    expect(body).toContain('event: done');
    expect(body).toContain('"documents":[{');
    expect(body).toContain('"format":"html"');
  });

  it('menghapus dokumen menghapus baris dan berkas', async () => {
    const list = await asClient(app, manager).get('/api/documents');
    const id = (list.body.data as Array<{ id: string }>)[0]!.id;
    const del = await asClient(app, manager).delete(`/api/documents/${id}`);
    expect(del.status).toBe(204);
    expect((await asClient(app, manager).get(`/api/documents/${id}/preview`)).status).toBe(404);
  });
});
