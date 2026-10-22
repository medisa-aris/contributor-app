import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures } from './helpers/reset-db';
import {
  createMockAiGateway,
  createMockWebSource,
  createTestApp,
  type MockAiGateway,
  type MockWebSource,
} from './helpers/test-app';

const TEST_UPLOAD_DIR = join(process.cwd(), 'var', 'ai-uploads-test');

function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('AI chat attachments (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let mockAi: MockAiGateway;
  let mockWeb: MockWebSource;
  let uploadDir: string;
  let manager: AuthedClient;
  let admin: AuthedClient;
  let staf: AuthedClient;

  beforeAll(async () => {
    process.env.AI_UPLOAD_DIR = TEST_UPLOAD_DIR;
    mockAi = createMockAiGateway();
    mockWeb = createMockWebSource();
    const ctx = await createTestApp({ mockAi, webSource: mockWeb });
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
    mockAi.chat.mockResolvedValue({
      content: 'Jawaban uji dari penyedia AI.',
      model: 'model-uji',
      tokensIn: 11,
      tokensOut: 7,
    });
    mockWeb.fetch.mockClear();
  });

  async function createDraft(client: AuthedClient): Promise<string> {
    const res = await asClient(app, client).post('/api/ai/conversations').send({
      mode: 'second_brain',
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  function upload(
    client: AuthedClient,
    conversationId: string,
    file: Buffer,
    filename: string,
    contentType: string,
  ) {
    return request(app.getHttpServer())
      .post(`/api/ai/conversations/${conversationId}/attachments`)
      .set('Cookie', client.cookies)
      .set('X-CSRF-Token', client.csrfToken)
      .attach('file', file, { filename, contentType });
  }

  function addUrl(client: AuthedClient, conversationId: string, url: string) {
    return asClient(app, client)
      .post(`/api/ai/conversations/${conversationId}/attachments/url`)
      .send({ url });
  }

  it('staf tanpa izin secondbrain tidak dapat membuat draf atau mengunggah', async () => {
    const created = await asClient(app, staf).post('/api/ai/conversations').send({
      mode: 'second_brain',
    });
    expect(created.status).toBe(403);

    const list = await asClient(app, staf).get(
      '/api/ai/conversations/00000000-0000-4000-8000-000000000000/attachments',
    );
    expect(list.status).toBe(403);
  });

  it('membuat draf, mengunggah PDF, mengekstrak teks, dan draf muncul di riwayat', async () => {
    const conversationId = await createDraft(admin);
    const res = await upload(
      admin,
      conversationId,
      makePdf('Kebijakan Cuti Tahunan 12 hari kerja'),
      'kebijakan-cuti.pdf',
      'application/pdf',
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      conversation_id: conversationId,
      file_name: 'kebijakan-cuti.pdf',
      extension: '.pdf',
      kind: 'document',
      extraction_status: 'ready',
      enabled: true,
    });
    expect(res.body.data.extracted_chars).toBeGreaterThan(0);

    const rows = (await dataSource.query(
      `SELECT storage_path, extracted_text FROM conversation_attachments WHERE id = $1`,
      [res.body.data.id],
    )) as { storage_path: string; extracted_text: string }[];
    expect(rows[0]!.extracted_text).toContain('Kebijakan Cuti Tahunan');
    await expect(access(join(uploadDir, rows[0]!.storage_path))).resolves.toBeUndefined();

    const list = await asClient(app, admin).get(
      '/api/ai/conversations?mode=second_brain&page=1&pageSize=50',
    );
    expect(list.status).toBe(200);
    expect(list.body.data.map((row: { id: string }) => row.id)).toContain(conversationId);
  });

  it('draf tanpa pesan dan tanpa lampiran tidak tampil di riwayat', async () => {
    const conversationId = await createDraft(admin);
    const list = await asClient(app, admin).get(
      '/api/ai/conversations?mode=second_brain&page=1&pageSize=50',
    );
    expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(conversationId);
  });

  it('lampiran hanya dapat diakses oleh pemilik thread', async () => {
    const conversationId = await createDraft(manager);
    const uploaded = await upload(
      manager,
      conversationId,
      makePdf('Rahasia manajer'),
      'rahasia.pdf',
      'application/pdf',
    );
    expect(uploaded.status).toBe(201);

    const foreignList = await asClient(app, admin).get(
      `/api/ai/conversations/${conversationId}/attachments`,
    );
    expect(foreignList.status).toBe(404);

    const foreignUpload = await upload(
      admin,
      conversationId,
      makePdf('Penyusup'),
      'penyusup.pdf',
      'application/pdf',
    );
    expect(foreignUpload.status).toBe(404);

    const foreignToggle = await asClient(app, admin)
      .patch(`/api/ai/conversations/${conversationId}/attachments/${uploaded.body.data.id}`)
      .send({ enabled: false });
    expect(foreignToggle.status).toBe(404);

    const foreignDelete = await asClient(app, admin).delete(
      `/api/ai/conversations/${conversationId}/attachments/${uploaded.body.data.id}`,
    );
    expect(foreignDelete.status).toBe(404);

    const ownList = await asClient(app, manager).get(
      `/api/ai/conversations/${conversationId}/attachments`,
    );
    expect(ownList.status).toBe(200);
    expect(ownList.body.data).toHaveLength(1);
  });

  it('percakapan counterpart menolak lampiran', async () => {
    const created = await asClient(app, manager).post('/api/ai/chat').send({
      mode: 'counterpart',
      counterpartStyle: 'analyst',
      prompt: 'Diskusi tanpa lampiran',
    });
    expect(created.status).toBe(200);
    const conversationId = created.body.data.conversation.id as string;

    const res = await upload(
      manager,
      conversationId,
      makePdf('Tidak boleh'),
      'tidak-boleh.pdf',
      'application/pdf',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Multi Brain');
  });

  it('isi dokumen aktif dikirim sebagai konteks dan draf diberi judul dari pesan pertama', async () => {
    const conversationId = await createDraft(manager);
    await upload(
      manager,
      conversationId,
      makePdf('Kebijakan Cuti Tahunan 12 hari kerja'),
      'kebijakan-cuti.pdf',
      'application/pdf',
    );

    const chat = await asClient(app, manager).post('/api/ai/chat').send({
      mode: 'second_brain',
      conversationId,
      prompt: 'Berapa hari cuti tahunan menurut dokumen?',
    });
    expect(chat.status).toBe(200);
    expect(chat.body.data.conversation.title).toBe('Berapa hari cuti tahunan menurut dokumen?');

    const sent = mockAi.chat.mock.calls[0]![0] as { extraContext?: string; images?: unknown[] };
    expect(sent.extraContext).toContain('KONTEKS LAMPIRAN PENGGUNA');
    expect(sent.extraContext).toContain('Kebijakan Cuti Tahunan 12 hari kerja');
    expect(sent.extraContext).toContain('kebijakan-cuti.pdf');
    expect(sent.images).toBeUndefined();
  });

  it('lampiran nonaktif tidak dikirim sebagai konteks dan dapat diaktifkan kembali', async () => {
    const conversationId = await createDraft(manager);
    const uploaded = await upload(
      manager,
      conversationId,
      makePdf('Isi yang dinonaktifkan'),
      'nonaktif.pdf',
      'application/pdf',
    );
    const attachmentId = uploaded.body.data.id as string;

    const disabled = await asClient(app, manager)
      .patch(`/api/ai/conversations/${conversationId}/attachments/${attachmentId}`)
      .send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.enabled).toBe(false);

    await asClient(app, manager).post('/api/ai/chat').send({
      mode: 'second_brain',
      conversationId,
      prompt: 'Apakah dokumen ini aktif?',
    });
    const sentWhileDisabled = mockAi.chat.mock.calls[0]![0] as { extraContext?: string };
    expect(sentWhileDisabled.extraContext).toBeUndefined();

    mockAi.chat.mockClear();
    await asClient(app, manager)
      .patch(`/api/ai/conversations/${conversationId}/attachments/${attachmentId}`)
      .send({ enabled: true });
    await asClient(app, manager).post('/api/ai/chat').send({
      mode: 'second_brain',
      conversationId,
      prompt: 'Sekarang aktif?',
    });
    const sentWhileEnabled = mockAi.chat.mock.calls[0]![0] as { extraContext?: string };
    expect(sentWhileEnabled.extraContext).toContain('Isi yang dinonaktifkan');
  });

  it('menghapus lampiran menghapus baris dan berkas disk', async () => {
    const conversationId = await createDraft(manager);
    const uploaded = await upload(
      manager,
      conversationId,
      makePdf('Akan dihapus'),
      'hapus.pdf',
      'application/pdf',
    );
    const attachmentId = uploaded.body.data.id as string;
    const rows = (await dataSource.query(
      `SELECT storage_path FROM conversation_attachments WHERE id = $1`,
      [attachmentId],
    )) as { storage_path: string }[];

    const deleted = await asClient(app, manager).delete(
      `/api/ai/conversations/${conversationId}/attachments/${attachmentId}`,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);

    await expect(access(join(uploadDir, rows[0]!.storage_path))).rejects.toThrow();
    const list = await asClient(app, manager).get(
      `/api/ai/conversations/${conversationId}/attachments`,
    );
    expect(list.body.data).toHaveLength(0);
  });

  it('mengunggah gambar: disimpan sebagai image dan dikirim sebagai input visual', async () => {
    const conversationId = await createDraft(manager);
    const uploaded = await upload(manager, conversationId, PNG_1X1, 'diagram.png', 'image/png');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data).toMatchObject({
      kind: 'image',
      extraction_status: 'image',
      extracted_chars: 0,
      mime_type: 'image/png',
    });

    await asClient(app, manager).post('/api/ai/chat').send({
      mode: 'second_brain',
      conversationId,
      prompt: 'Jelaskan gambar ini.',
    });
    const sent = mockAi.chat.mock.calls[0]![0] as {
      extraContext?: string;
      images?: { name: string; mimeType: string; dataBase64: string }[];
    };
    expect(sent.extraContext).toContain('GAMBAR: diagram.png');
    expect(sent.images).toHaveLength(1);
    expect(sent.images![0]).toMatchObject({ name: 'diagram.png', mimeType: 'image/png' });
    expect(sent.images![0]!.dataBase64).toBe(PNG_1X1.toString('base64'));
  });

  it('format tidak didukung ditolak dengan pesan yang jelas', async () => {
    const conversationId = await createDraft(manager);
    const res = await upload(
      manager,
      conversationId,
      Buffer.from('teks biasa'),
      'catatan.txt',
      'text/plain',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('.docx');
    expect(res.body.error.message).toContain('PDF');
  });

  it('menambahkan sumber URL: crawl, ringkasan AI, dan baris lampiran', async () => {
    const conversationId = await createDraft(admin);
    const res = await addUrl(admin, conversationId, 'https://93.184.216.34/kebijakan-cuti');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      conversation_id: conversationId,
      file_name: 'Artikel Uji',
      extension: '.url',
      kind: 'document',
      extraction_status: 'ready',
      source_type: 'url',
      source_url: 'https://93.184.216.34/kebijakan-cuti',
      summary: 'Jawaban uji dari penyedia AI.',
      enabled: true,
    });
    expect(mockWeb.fetch).toHaveBeenCalledWith('https://93.184.216.34/kebijakan-cuti');
    expect(res.body.data.extracted_chars).toBeGreaterThan(0);

    const rows = (await dataSource.query(
      `SELECT storage_path, source_type, source_url, summary, extracted_text
         FROM conversation_attachments WHERE id = $1`,
      [res.body.data.id],
    )) as {
      storage_path: string | null;
      source_type: string;
      source_url: string;
      summary: string;
      extracted_text: string;
    }[];
    expect(rows[0]!.storage_path).toBeNull();
    expect(rows[0]!.source_type).toBe('url');
    expect(rows[0]!.summary).toContain('Jawaban uji');
    expect(rows[0]!.extracted_text).toContain('cuti tahunan 12 hari kerja');

    const list = await asClient(app, admin).get(
      '/api/ai/conversations?mode=second_brain&page=1&pageSize=50',
    );
    expect(list.body.data.map((row: { id: string }) => row.id)).toContain(conversationId);
  });

  it('sumber URL aktif dikirim sebagai konteks chat dan dapat dinonaktifkan', async () => {
    const conversationId = await createDraft(manager);
    const added = await addUrl(manager, conversationId, 'https://93.184.216.34/artikel-cuti');
    expect(added.status).toBe(201);
    mockAi.chat.mockClear();

    const chat = await asClient(app, manager).post('/api/ai/chat').send({
      mode: 'second_brain',
      conversationId,
      prompt: 'Berapa hari cuti tahunan menurut sumber web?',
    });
    expect(chat.status).toBe(200);
    const sent = mockAi.chat.mock.calls[0]![0] as { extraContext?: string };
    expect(sent.extraContext).toContain('SUMBER WEB');
    expect(sent.extraContext).toContain('https://93.184.216.34/artikel-cuti');
    expect(sent.extraContext).toContain('RINGKASAN:');
    expect(sent.extraContext).toContain('cuti tahunan 12 hari kerja');

    const disabled = await asClient(app, manager)
      .patch(`/api/ai/conversations/${conversationId}/attachments/${added.body.data.id}`)
      .send({ enabled: false });
    expect(disabled.status).toBe(200);

    mockAi.chat.mockClear();
    await asClient(app, manager).post('/api/ai/chat').send({
      mode: 'second_brain',
      conversationId,
      prompt: 'Apakah sumber web masih aktif?',
    });
    const sentWhileDisabled = mockAi.chat.mock.calls[0]![0] as { extraContext?: string };
    expect(sentWhileDisabled.extraContext).toBeUndefined();
  });

  it('menolak URL internal, privat, dan skema yang tidak didukung', async () => {
    const conversationId = await createDraft(admin);
    for (const url of [
      'http://127.0.0.1:3000/rahasia',
      'http://localhost/rahasia',
      'http://10.0.0.5/internal',
      'http://192.168.0.62:8000/admin',
      'file:///etc/passwd',
    ]) {
      const res = await addUrl(admin, conversationId, url);
      expect(res.status).toBe(400);
    }
    expect(mockWeb.fetch).toHaveBeenCalledTimes(5);
  });

  it('menolak sumber URL duplikat pada percakapan yang sama', async () => {
    const conversationId = await createDraft(manager);
    const first = await addUrl(manager, conversationId, 'https://93.184.216.34/sama');
    expect(first.status).toBe(201);
    const second = await addUrl(manager, conversationId, 'https://93.184.216.34/sama');
    expect(second.status).toBe(409);
  });

  it('menghapus sumber URL tanpa menyentuh berkas disk', async () => {
    const conversationId = await createDraft(admin);
    const added = await addUrl(admin, conversationId, 'https://93.184.216.34/hapus');
    expect(added.status).toBe(201);

    const deleted = await asClient(app, admin).delete(
      `/api/ai/conversations/${conversationId}/attachments/${added.body.data.id}`,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);

    const list = await asClient(app, admin).get(
      `/api/ai/conversations/${conversationId}/attachments`,
    );
    expect(list.body.data).toHaveLength(0);
  });

  it('percakapan counterpart menolak sumber URL', async () => {
    const created = await asClient(app, manager).post('/api/ai/chat').send({
      mode: 'counterpart',
      counterpartStyle: 'analyst',
      prompt: 'Diskusi tanpa sumber web',
    });
    expect(created.status).toBe(200);
    const conversationId = created.body.data.conversation.id as string;

    const res = await addUrl(manager, conversationId, 'https://93.184.216.34/artikel');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Multi Brain');
  });

  it('staf tanpa izin secondbrain tidak dapat menambahkan sumber URL', async () => {
    const res = await addUrl(
      staf,
      '00000000-0000-4000-8000-000000000000',
      'https://93.184.216.34/artikel',
    );
    expect(res.status).toBe(403);
  });

  it('menghapus percakapan membersihkan folder lampiran di disk', async () => {
    const conversationId = await createDraft(admin);
    await upload(admin, conversationId, PNG_1X1, 'foto.png', 'image/png');
    await expect(access(join(uploadDir, conversationId))).resolves.toBeUndefined();

    const deleted = await asClient(app, admin).delete(`/api/ai/conversations/${conversationId}`);
    expect(deleted.status).toBe(200);
    await expect(access(join(uploadDir, conversationId))).rejects.toThrow();
  });
});
