import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DATA_SOURCE } from '../../src/database/database.module';
import { AiGatewayService } from '../../src/modules/ai/gateway.service';
import type {
  AiProviderAdapter,
  ChatRequestOptions,
  ChatResult,
} from '../../src/modules/ai/providers/types';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures, type TestFixtures } from './helpers/reset-db';

/**
 * Konektor database ber-RBAC end-to-end: grant admin → pasang di percakapan → loop tool
 * dengan penyedia AI tiruan → query baca, query tulis dengan persetujuan, dan pencabutan.
 * Konektor menunjuk ke database tes itu sendiri (tabel `connector_demo_items`).
 */
describe('Konektor data dan loop tool (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixtures: TestFixtures;
  let admin: AuthedClient;
  let manager: AuthedClient;
  let managerHr: AuthedClient;
  let staf: AuthedClient;
  let connectorId: string;
  const replies: ChatResult[] = [];
  const requests: ChatRequestOptions[] = [];

  const adapter: AiProviderAdapter = {
    id: 'tiruan',
    chat: (options) => {
      requests.push({ ...options, messages: [...options.messages] });
      const next = replies.shift();
      if (!next) return Promise.reject(new Error('Balasan tiruan habis'));
      return Promise.resolve(next);
    },
    // eslint-disable-next-line require-yield
    stream: async function* () {
      throw new Error('stream tidak dipakai di tes ini');
    },
  };

  const reply = (content: string, toolCalls?: ChatResult['toolCalls']): ChatResult => ({
    content,
    model: 'model-uji',
    tokensIn: 5,
    tokensOut: 7,
    ...(toolCalls ? { toolCalls } : {}),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiGatewayService)
      .useFactory({
        factory: (config: ConfigService) => {
          const gateway = new AiGatewayService(config);
          (gateway as unknown as { adapter: AiProviderAdapter }).adapter = adapter;
          return gateway;
        },
        inject: [ConfigService],
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get<DataSource>(DATA_SOURCE);
    await resetDatabase(dataSource);
    fixtures = await seedTestFixtures(dataSource);
    await dataSource.query(`DROP TABLE IF EXISTS connector_demo_items`);
    await dataSource.query(
      `CREATE TABLE connector_demo_items (id int PRIMARY KEY, name text NOT NULL, status text NOT NULL)`,
    );
    await dataSource.query(
      `INSERT INTO connector_demo_items VALUES (1, 'APAR pos 1', 'Open'), (2, 'Rambu KM 12', 'Open'), (3, 'P3K', 'Closed')`,
    );
    admin = await loginAs(app, 'admin@test.local');
    manager = await loginAs(app, 'manager@test.local');
    managerHr = await loginAs(app, 'managerhr@test.local');
    staf = await loginAs(app, 'staf@test.local');
  });

  afterAll(async () => {
    await dataSource.query(`DROP TABLE IF EXISTS connector_demo_items`);
    await app.close();
  });

  beforeEach(() => {
    replies.length = 0;
    requests.length = 0;
  });

  it('admin mendaftarkan konektor; password tidak pernah dikembalikan', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const res = await asClient(app, admin).post('/api/integrations/db-connectors', {
      code: 'uji-db',
      name: 'Database Uji',
      engine: 'postgres',
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      allowWrite: true,
      rowLimit: 50,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.has_password).toBe(true);
    expect(JSON.stringify(res.body.data)).not.toContain(decodeURIComponent(url.password));
    connectorId = res.body.data.id as string;

    const test = await asClient(app, admin).post(
      `/api/integrations/db-connectors/${connectorId}/test`,
    );
    expect(test.status).toBe(201);
    expect(test.body.data.last_health_ok).toBe(true);
  });

  it('manajer tanpa izin integrasi tidak dapat mengelola konektor', async () => {
    const res = await asClient(app, staf).get('/api/integrations/db-connectors');
    expect(res.status).toBe(403);
  });

  it('grant departemen berlaku untuk departemen itu dan sub-departemennya saja', async () => {
    const grant = await asClient(app, admin).post(
      `/api/integrations/connectors/database/${connectorId}/grants`,
      {
        subjectType: 'department',
        subjectId: fixtures.departments.it,
        access: 'read_write',
      },
    );
    expect(grant.status).toBe(201);

    const mine = await asClient(app, manager).get('/api/connectors/available');
    expect(mine.status).toBe(200);
    expect(mine.body.data).toEqual([
      expect.objectContaining({ connectorId, access: 'read_write', allowWrite: true }),
    ]);

    const hr = await asClient(app, managerHr).get('/api/connectors/available');
    expect(hr.body.data).toEqual([]);

    // Staf tidak punya izin connectors.use sama sekali.
    const stafRes = await asClient(app, staf).get('/api/connectors/available');
    expect(stafRes.status).toBe(403);
  });

  let conversationId: string;

  it('konektor tanpa grant tidak dapat dipasang ke percakapan', async () => {
    const draft = await asClient(app, managerHr).post('/api/ai/conversations', {
      mode: 'second_brain',
    });
    const res = await asClient(app, managerHr).put(
      `/api/ai/conversations/${draft.body.data.id}/connectors`,
      {
        connectors: [{ connectorType: 'database', connectorId, access: 'read' }],
      },
    );
    expect(res.status).toBe(403);
  });

  it('query baca dijalankan lewat loop tool dan dicatat sebagai jejak', async () => {
    const draft = await asClient(app, manager).post('/api/ai/conversations', {
      mode: 'second_brain',
    });
    conversationId = draft.body.data.id as string;
    const attach = await asClient(app, manager).put(
      `/api/ai/conversations/${conversationId}/connectors`,
      {
        connectors: [{ connectorType: 'database', connectorId, access: 'read_write' }],
      },
    );
    expect(attach.status).toBe(200);
    expect(attach.body.data[0]).toMatchObject({ granted: true, access: 'read_write' });

    replies.push(
      reply('Saya cek datanya.', [
        {
          id: 'c1',
          name: 'db_uji_db__run_query',
          input: { sql: "SELECT name FROM connector_demo_items WHERE status = 'Open' ORDER BY id" },
        },
      ]),
      reply('Ada 2 temuan terbuka: APAR pos 1 dan Rambu KM 12.'),
    );
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Temuan apa yang masih terbuka?',
      conversationId,
    });
    expect(res.status).toBe(200);
    const assistant = res.body.data.assistant;
    expect(assistant.content).toContain('Ada 2 temuan terbuka');
    expect(assistant.tool_trace.steps).toEqual([
      expect.objectContaining({
        id: 'c1',
        status: 'ok',
        summary: '2 baris',
        source: 'Database Uji',
      }),
    ]);
    // Hasil tool diumpankan kembali ke model sebagai data.
    const toolMessage = requests[1]!.messages.at(-1)!;
    expect(toolMessage).toMatchObject({ role: 'tool', toolCallId: 'c1' });
    expect(toolMessage.content).toContain('APAR pos 1');
    expect(requests[0]!.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'db_uji_db__list_tables',
        'db_uji_db__describe_table',
        'db_uji_db__run_query',
      ]),
    );

    const logs = (await dataSource.query(
      `SELECT kind, status, row_count FROM connector_tool_calls WHERE conversation_id = $1`,
      [conversationId],
    )) as Array<{ kind: string; status: string; row_count: number }>;
    expect(logs).toEqual([{ kind: 'read', status: 'ok', row_count: 2 }]);

    // Detail percakapan memuat jejak tanpa transkrip internal.
    const saved = res.body.data.conversation.messages.find(
      (m: { role: string }) => m.role === 'assistant',
    );
    expect(saved.tool_trace.steps).toHaveLength(1);
    expect(saved.tool_trace.transcript).toBeUndefined();
  });

  it('query terlarang diblokir tanpa menyentuh database', async () => {
    replies.push(
      reply('', [
        {
          id: 'c2',
          name: 'db_uji_db__run_query',
          input: { sql: 'DROP TABLE connector_demo_items' },
        },
      ]),
      reply('Perintah itu tidak diizinkan.'),
    );
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Hapus tabelnya',
      conversationId,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.assistant.tool_trace.steps[0]).toMatchObject({ status: 'error' });
    const exists = (await dataSource.query(
      `SELECT count(*)::int AS n FROM connector_demo_items`,
    )) as { n: number }[];
    expect(exists[0]!.n).toBe(3);
  });

  let approvalId: string;

  it('query tulis berhenti menunggu persetujuan', async () => {
    replies.push(
      reply('Saya akan menutup temuan APAR.', [
        {
          id: 'w1',
          name: 'db_uji_db__run_query',
          input: {
            sql: "UPDATE connector_demo_items SET status = 'Closed' WHERE id = 1",
            purpose: 'Tutup temuan APAR',
          },
        },
      ]),
    );
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Tutup temuan APAR pos 1',
      conversationId,
    });
    expect(res.status).toBe(200);
    const step = res.body.data.assistant.tool_trace.steps[0];
    expect(step).toMatchObject({ status: 'pending_approval' });
    approvalId = step.approvalId as string;
    const row = (await dataSource.query(
      `SELECT status FROM connector_demo_items WHERE id = 1`,
    )) as { status: string }[];
    expect(row[0]!.status).toBe('Open');

    const mine = await asClient(app, manager).get('/api/ai/tool-approvals?status=pending');
    expect(mine.body.data).toEqual([
      expect.objectContaining({
        id: approvalId,
        summary: 'Tutup temuan APAR',
        conversation_id: conversationId,
      }),
    ]);
    // Persetujuan tool tidak muncul di kotak persetujuan Agent Center.
    const inbox = await asClient(app, admin).get('/api/agents/approvals');
    expect(JSON.stringify(inbox.body)).not.toContain(approvalId);
  });

  it('pengguna lain tidak dapat memutuskan persetujuan', async () => {
    const res = await asClient(app, managerHr).post(
      `/api/ai/conversations/${conversationId}/tool-approvals/${approvalId}/decide`,
      { decision: 'approved' },
    );
    expect(res.status).toBe(404);
  });

  it('setelah disetujui, query dijalankan dan jawaban dilanjutkan pada pesan yang sama', async () => {
    replies.push(reply('Temuan APAR pos 1 sudah ditutup.'));
    const res = await asClient(app, manager).post(
      `/api/ai/conversations/${conversationId}/tool-approvals/${approvalId}/decide`,
      { decision: 'approved' },
    );
    expect(res.status).toBe(200);
    const row = (await dataSource.query(
      `SELECT status FROM connector_demo_items WHERE id = 1`,
    )) as { status: string }[];
    expect(row[0]!.status).toBe('Closed');
    const last = res.body.data.messages.at(-1);
    expect(last.content).toContain('sudah ditutup');
    expect(last.tool_trace.steps[0]).toMatchObject({ status: 'approved' });
    // Model menerima hasil tool tulis sebelum menjawab.
    expect(requests[0]!.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'w1' });

    const again = await asClient(app, manager).post(
      `/api/ai/conversations/${conversationId}/tool-approvals/${approvalId}/decide`,
      { decision: 'approved' },
    );
    expect(again.status).toBe(409);
  });

  it('grant diturunkan ke baca: query tulis ditolak tanpa approval', async () => {
    await asClient(app, admin).post(`/api/integrations/connectors/database/${connectorId}/grants`, {
      subjectType: 'department',
      subjectId: fixtures.departments.it,
      access: 'read',
    });
    replies.push(
      reply('', [
        {
          id: 'w2',
          name: 'db_uji_db__run_query',
          input: { sql: "UPDATE connector_demo_items SET status = 'Open'" },
        },
      ]),
      reply('Akses saya hanya baca.'),
    );
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Buka lagi semua temuan',
      conversationId,
    });
    expect(res.body.data.assistant.tool_trace.steps[0]).toMatchObject({ status: 'error' });
    const pending = (await dataSource.query(
      `SELECT count(*)::int AS n FROM approvals WHERE status = 'pending'`,
    )) as {
      n: number;
    }[];
    expect(pending[0]!.n).toBe(0);
  });

  it('grant dicabut: konektor tidak lagi ditawarkan ke model', async () => {
    const grants = await asClient(app, admin).get(
      `/api/integrations/connectors/database/${connectorId}/grants`,
    );
    for (const grant of grants.body.data as Array<{ id: string }>) {
      const del = await asClient(app, admin).delete(
        `/api/integrations/connectors/database/${connectorId}/grants/${grant.id}`,
      );
      expect(del.status).toBe(204);
    }
    replies.push(reply('Tanpa akses data.'));
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Ada berapa temuan?',
      conversationId,
    });
    expect(res.status).toBe(200);
    expect(requests[0]!.tools?.map((t) => t.name) ?? []).not.toContain('db_uji_db__run_query');
    const list = await asClient(app, manager).get(
      `/api/ai/conversations/${conversationId}/connectors`,
    );
    expect(list.body.data[0]).toMatchObject({ granted: false });
  });
});
