import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ERROR_CODES } from '../../src/common/errors/app-error';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures } from './helpers/reset-db';
import { createMockAiGateway, createTestApp, type MockAiGateway } from './helpers/test-app';

describe('Knowledge Center (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: AuthedClient;
  let manager: AuthedClient;
  let staf: AuthedClient;
  let publicSourceId: string;
  let restrictedSourceId: string;

  beforeAll(async () => {
    const ctx = await createTestApp({ mockAi: createMockAiGateway() });
    app = ctx.app;
    dataSource = ctx.dataSource;
    await resetDatabase(dataSource);
    await seedTestFixtures(dataSource);
    admin = await loginAs(app, 'admin@test.local');
    manager = await loginAs(app, 'manager@test.local');
    staf = await loginAs(app, 'staf@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  it('staf dapat melihat daftar dokumen (knowledge.documents.read)', async () => {
    const res = await asClient(app, staf).get('/api/knowledge/documents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('manajer dapat melihat daftar dokumen (knowledge.documents.read)', async () => {
    const res = await asClient(app, manager).get('/api/knowledge/documents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('staf tanpa izin kelola ditolak membuat sumber (403)', async () => {
    const res = await asClient(app, staf).post('/api/knowledge/sources', {
      code: 'sop-umum',
      name: 'SOP Umum',
      origin: 'manual',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.forbidden);
  });

  it('admin membuat sumber publik dan sumber terbatas peran administrator', async () => {
    const publik = await asClient(app, admin).post('/api/knowledge/sources', {
      code: 'sop-umum',
      name: 'SOP Umum',
      description: 'SOP untuk seluruh karyawan',
      origin: 'manual',
      acl: {},
    });
    expect(publik.status).toBe(201);
    publicSourceId = publik.body.data.id;

    const terbatas = await asClient(app, admin).post('/api/knowledge/sources', {
      code: 'kebijakan-internal-it',
      name: 'Kebijakan Internal IT',
      origin: 'manual',
      acl: { roles: ['administrator'] },
    });
    expect(terbatas.status).toBe(201);
    restrictedSourceId = terbatas.body.data.id;

    const duplikat = await asClient(app, admin).post('/api/knowledge/sources', {
      code: 'sop-umum',
      name: 'SOP Umum Lagi',
      origin: 'manual',
    });
    expect(duplikat.status).toBe(409);
  });

  it('staf tidak melihat sumber terbatas pada daftar sumber', async () => {
    const res = await asClient(app, staf).get('/api/knowledge/sources?pageSize=100');
    expect(res.status).toBe(200);
    const codes = (res.body.data as { code: string }[]).map((s) => s.code);
    expect(codes).toContain('sop-umum');
    expect(codes).not.toContain('kebijakan-internal-it');
  });

  it('admin menambah dokumen dan pencarian mengembalikan cuplikan sitasi', async () => {
    const create = await asClient(app, admin).post('/api/knowledge/documents', {
      sourceId: publicSourceId,
      title: 'SOP Penanganan Klaim Jasa Raharja',
      locator: 'sop/klaim-jr.pdf',
      content:
        'Setiap klaim Jasa Raharja wajib diverifikasi dalam 3 hari kerja. ' +
        'Verifikasi mencakup kelengkapan dokumen korban, nomor polisi, dan surat keterangan kecelakaan. ' +
        'Bila dokumen lengkap, pembayaran dana kehilangan disetujui manajer klaim.',
    });
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe('indexed');

    const res = await asClient(app, staf).post('/api/knowledge/search', {
      query: 'verifikasi klaim',
    });
    expect(res.status).toBe(200);
    const hits = res.body.data.hits as {
      document_id: string;
      title: string;
      snippet: string;
      source_code: string;
    }[];
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits.find((h) => h.document_id === create.body.data.id);
    expect(hit).toBeDefined();
    expect(hit!.source_code).toBe('sop-umum');
    expect(hit!.snippet.length).toBeGreaterThan(0);

    const audits = (await dataSource.query(
      `SELECT event_key FROM audit_events WHERE event_key = 'knowledge.search.performed' AND actor_user_id = $1`,
      [staf.userId],
    )) as { event_key: string }[];
    expect(audits.length).toBe(1);
  });

  it('pencarian staf tidak menembus dokumen sumber terbatas', async () => {
    await asClient(app, admin).post('/api/knowledge/documents', {
      sourceId: restrictedSourceId,
      title: 'Rahasia: Kredensial Sandbox',
      content: 'Kata sandi sandbox internal hanya untuk administrator IT.',
    });

    const resStaf = await asClient(app, staf).post('/api/knowledge/search', {
      query: 'kata sandi sandbox',
    });
    expect(resStaf.status).toBe(200);
    expect(
      (resStaf.body.data.hits as { source_code: string }[]).map((h) => h.source_code),
    ).not.toContain('kebijakan-internal-it');

    const resAdmin = await asClient(app, admin).post('/api/knowledge/search', {
      query: 'kata sandi sandbox',
    });
    expect(
      (resAdmin.body.data.hits as { source_code: string }[]).map((h) => h.source_code),
    ).toContain('kebijakan-internal-it');
  });

  it('staf dengan izin dapat mencari pengetahuan', async () => {
    const res = await asClient(app, staf).post('/api/knowledge/search', { query: 'klaim' });
    expect(res.status).toBe(200);
  });

  it('koleksi: CRUD + atur sumber + pencarian terfilter koleksi', async () => {
    const koleksi = await asClient(app, admin).post('/api/knowledge/collections', {
      code: 'klaim-asuransi',
      name: 'Klaim Asuransi',
      description: 'Kumpulan referensi proses klaim',
    });
    expect(koleksi.status).toBe(201);
    const collectionId = koleksi.body.data.id as string;

    const set = await asClient(app, admin).put(
      `/api/knowledge/collections/${collectionId}/sources`,
      {
        sourceIds: [publicSourceId],
      },
    );
    expect(set.status).toBe(200);
    expect(set.body.data.source_ids).toEqual([publicSourceId]);

    const dalam = await asClient(app, staf).post('/api/knowledge/search', {
      query: 'verifikasi klaim',
      collectionId,
    });
    expect((dalam.body.data.hits as unknown[]).length).toBeGreaterThan(0);

    const kosong = await asClient(app, admin).post('/api/knowledge/collections', {
      code: 'koleksi-kosong',
      name: 'Koleksi Kosong',
    });
    const diLuar = await asClient(app, staf).post('/api/knowledge/search', {
      query: 'verifikasi klaim',
      collectionId: kosong.body.data.id,
    });
    expect((diLuar.body.data.hits as unknown[]).length).toBe(0);

    const hapus = await asClient(app, admin).delete(`/api/knowledge/collections/${collectionId}`);
    expect(hapus.status).toBe(200);
  });

  it('staf tanpa izin kelola koleksi ditolak 403', async () => {
    const res = await asClient(app, staf).post('/api/knowledge/collections', {
      code: 'koleksi-ilegal',
      name: 'Koleksi Ilegal',
    });
    expect(res.status).toBe(403);
  });
});

describe('Agent Center (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let mockAi: MockAiGateway;
  let admin: AuthedClient;
  let manager: AuthedClient;
  let staf: AuthedClient;
  let agentBebasId: string;
  let agentPersetujuanId: string;

  beforeAll(async () => {
    mockAi = createMockAiGateway();
    const ctx = await createTestApp({ mockAi });
    app = ctx.app;
    dataSource = ctx.dataSource;
    await resetDatabase(dataSource);
    await seedTestFixtures(dataSource);
    admin = await loginAs(app, 'admin@test.local');
    manager = await loginAs(app, 'manager@test.local');
    staf = await loginAs(app, 'staf@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockAi.chat.mockReset();
    mockAi.chat.mockResolvedValue({
      content: 'Hasil kerja agen.',
      model: 'model-uji',
      tokensIn: 5,
      tokensOut: 4,
    });
  });

  it('admin membuat dua agen: satu langsung jalan, satu wajib persetujuan', async () => {
    const bebas = await asClient(app, admin).post('/api/agents', {
      code: 'penulis-laporan',
      name: 'Penulis Laporan',
      instruction: 'Anda menyusun laporan ringkas berbahasa Indonesia yang rapi.',
      toolAllowlist: ['knowledge.search'],
      requireApproval: false,
    });
    expect(bebas.status).toBe(201);
    agentBebasId = bebas.body.data.id;

    const butuh = await asClient(app, admin).post('/api/agents', {
      code: 'pengirim-email',
      name: 'Pengirim Email',
      instruction: 'Anda mengirim email eksternal atas nama perusahaan.',
      toolAllowlist: ['email.send'],
      requireApproval: true,
    });
    expect(butuh.status).toBe(201);
    expect(butuh.body.data.require_approval).toBe(true);
    agentPersetujuanId = butuh.body.data.id;
  });

  it('manajer menjalankan agen tanpa persetujuan → tugas selesai', async () => {
    const res = await asClient(app, manager).post(`/api/agents/${agentBebasId}/execute`, {
      instruction: 'Buatkan ringkasan klaim minggu ini.',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.task.status).toBe('completed');
    expect(res.body.data.task.agent_id).toBe(agentBebasId);
    expect(res.body.data.approvalId).toBeNull();
    expect(mockAi.chat).toHaveBeenCalledTimes(1);

    const detail = await asClient(app, admin).get(`/api/agents/tasks/${res.body.data.task.id}`);
    expect(detail.status).toBe(200);
    expect(
      (detail.body.data.events as { event_type: string }[]).map((e) => e.event_type),
    ).toContain('completed');
  });

  it('agen wajib persetujuan: tugas berhenti di awaiting_approval dan masuk kotak masuk', async () => {
    const res = await asClient(app, manager).post(`/api/agents/${agentPersetujuanId}/execute`, {
      instruction: 'Kirim email pengingat ke mitra vendor.',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.task.status).toBe('awaiting_approval');
    expect(res.body.data.approvalId).toBeTruthy();
    expect(mockAi.chat).not.toHaveBeenCalled();

    const inbox = await asClient(app, admin).get('/api/agents/approvals?status=pending');
    expect(inbox.status).toBe(200);
    const match = (inbox.body.data as { id: string; task_id: string }[]).find(
      (a) => a.id === res.body.data.approvalId,
    );
    expect(match).toBeDefined();
    expect(match!.task_id).toBe(res.body.data.task.id);
  });

  it('peminta tanpa izin approve ditolak 403', async () => {
    const inbox = await asClient(app, admin).get('/api/agents/approvals?status=pending');
    const approvalId = (inbox.body.data as { id: string }[])[0]!.id;
    const res = await asClient(app, manager).post(`/api/agents/approvals/${approvalId}/decide`, {
      decision: 'approved',
    });
    expect(res.status).toBe(403);
  });

  it('admin menyetujui → tugas dijalankan; putusan ganda ditolak 409', async () => {
    const inbox = await asClient(app, admin).get('/api/agents/approvals?status=pending');
    const approvalId = (inbox.body.data as { id: string }[])[0]!.id;

    const res = await asClient(app, admin).post(`/api/agents/approvals/${approvalId}/decide`, {
      decision: 'approved',
      note: 'Silakan kirim.',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.task.status).toBe('completed');
    expect(mockAi.chat).toHaveBeenCalledTimes(1);

    const lagi = await asClient(app, admin).post(`/api/agents/approvals/${approvalId}/decide`, {
      decision: 'rejected',
    });
    expect(lagi.status).toBe(409);
  });

  it('penolakan mengubah tugas menjadi cancelled', async () => {
    const eksekusi = await asClient(app, manager).post(
      `/api/agents/${agentPersetujuanId}/execute`,
      { instruction: 'Kirim email penawaran harga.' },
    );
    expect(eksekusi.status).toBe(200);

    const res = await asClient(app, admin).post(
      `/api/agents/approvals/${eksekusi.body.data.approvalId}/decide`,
      { decision: 'rejected', note: 'Terlalu sensitif untuk otomasi.' },
    );
    expect(res.status).toBe(200);

    const task = await asClient(app, admin).get(`/api/agents/tasks/${eksekusi.body.data.task.id}`);
    expect(task.body.data.status).toBe('cancelled');
    expect(task.body.data.approval.status).toBe('rejected');
  });

  it('putusan dibatalkan bila peminta kehilangan izin menjalankan agen', async () => {
    const eksekusi = await asClient(app, manager).post(
      `/api/agents/${agentPersetujuanId}/execute`,
      { instruction: 'Kirim email undangan rapat.' },
    );
    const approvalId = eksekusi.body.data.approvalId as string;

    // Admin mencabut izin agents.execute dari peran manajer lewat API RBAC.
    const roles = await asClient(app, admin).get('/api/admin/roles');
    const managerRole = (roles.body.data as { id: string; code: string }[]).find(
      (r) => r.code === 'manager',
    );
    const current = await asClient(app, admin).get(
      `/api/admin/roles/${managerRole!.id}/permissions`,
    );
    const sisa = (current.body.data as string[]).filter((id) => id !== 'agents.execute');
    const cabut = await asClient(app, admin).put(
      `/api/admin/roles/${managerRole!.id}/permissions`,
      {
        permissions: sisa,
      },
    );
    expect(cabut.status).toBe(200);

    const res = await asClient(app, admin).post(`/api/agents/approvals/${approvalId}/decide`, {
      decision: 'approved',
    });
    expect(res.status).toBe(403);

    const inbox = await asClient(app, admin).get('/api/agents/approvals?status=pending');
    const match = (inbox.body.data as { id: string }[]).find((a) => a.id === approvalId);
    expect(match).toBeDefined();
  });

  it('staf tanpa izin eksekusi agen ditolak 403', async () => {
    const res = await asClient(app, staf).post(`/api/agents/${agentBebasId}/execute`, {
      instruction: 'Coba jalankan.',
    });
    expect(res.status).toBe(403);
  });
});

describe('Integration Center (e2e)', () => {
  let app: INestApplication;
  let admin: AuthedClient;
  let staf: AuthedClient;

  beforeAll(async () => {
    const ctx = await createTestApp({ mockAi: createMockAiGateway() });
    app = ctx.app;
    const dataSource = ctx.dataSource;
    await resetDatabase(dataSource);
    await seedTestFixtures(dataSource);
    admin = await loginAs(app, 'admin@test.local');
    staf = await loginAs(app, 'staf@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  it('staf tanpa integrations.view ditolak 403', async () => {
    const res = await asClient(app, staf).get('/api/integrations/providers');
    expect(res.status).toBe(403);
  });

  it('status provider tidak membocorkan nilai kredensial', async () => {
    const providers = await asClient(app, admin).get('/api/integrations/providers');
    expect(providers.status).toBe(200);
    expect(providers.body.data.provider).toBeTruthy();
    expect(JSON.stringify(providers.body.data)).not.toContain('sk-');

    const credentials = await asClient(app, admin).get('/api/integrations/credentials');
    expect(credentials.status).toBe(200);
    expect(Array.isArray(credentials.body.data)).toBe(true);
    for (const item of credentials.body.data as { env: string; configured: boolean }[]) {
      expect(typeof item.configured).toBe('boolean');
    }
  });

  it('CRUD MCP server + health check tercatat', async () => {
    const created = await asClient(app, admin).post('/api/integrations/mcp-servers', {
      code: 'server-dokumen',
      name: 'Server Dokumen',
      baseUrl: 'http://127.0.0.1:9/',
      authType: 'none',
    });
    expect(created.status).toBe(201);

    const health = await asClient(app, admin).post(
      `/api/integrations/mcp-servers/${created.body.data.id}/health-check`,
    );
    expect(health.status).toBe(200);
    expect(health.body.data.last_health_ok).toBe(false);
    expect(health.body.data.last_health_detail).toBeTruthy();

    const list = await asClient(app, admin).get('/api/integrations/mcp-servers');
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);

    const hapus = await asClient(app, admin).delete(
      `/api/integrations/mcp-servers/${created.body.data.id}`,
    );
    expect(hapus.status).toBe(200);
  });

  it('CRUD REST connector + health check', async () => {
    const created = await asClient(app, admin).post('/api/integrations/rest-connectors', {
      code: 'konektor-klaim',
      name: 'Konektor Klaim',
      baseUrl: 'http://127.0.0.1:9/',
      toolEndpoints: [{ name: 'cari-klaim', method: 'GET', path: '/claims' }],
      authType: 'none',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.tool_endpoints).toHaveLength(1);

    const health = await asClient(app, admin).post(
      `/api/integrations/rest-connectors/${created.body.data.id}/health-check`,
    );
    expect(health.status).toBe(200);
    expect(health.body.data.last_health_ok).toBe(false);

    const list = await asClient(app, admin).get('/api/integrations/rest-connectors');
    expect(list.body.meta.total).toBe(1);
  });

  it('kode duplikat MCP server ditolak 409', async () => {
    await asClient(app, admin).post('/api/integrations/mcp-servers', {
      code: 'server-satu',
      name: 'Server Satu',
      baseUrl: 'http://127.0.0.1:9/',
      authType: 'none',
    });
    const duplikat = await asClient(app, admin).post('/api/integrations/mcp-servers', {
      code: 'server-satu',
      name: 'Server Satu Lagi',
      baseUrl: 'http://127.0.0.1:9/',
      authType: 'none',
    });
    expect(duplikat.status).toBe(409);
  });
});
