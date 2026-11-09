import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DATA_SOURCE } from '../../src/database/database.module';
import { TaskRunnerService } from '../../src/modules/ai/agents/task-runner.service';
import { AiGatewayService } from '../../src/modules/ai/gateway.service';
import type {
  AiProviderAdapter,
  ChatRequestOptions,
  ChatResult,
} from '../../src/modules/ai/providers/types';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures, type TestFixtures } from './helpers/reset-db';

/**
 * Agent pribadi Subordinate end-to-end dengan penyedia AI tiruan:
 * skill + konektor masuk ke prompt/tool, runner asinkron, klarifikasi, persetujuan tulis,
 * grup delegasi (Leader → anggota) dan grup diskusi bergiliran.
 */
describe('Agent pribadi, skill, grup (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let runner: TaskRunnerService;
  let fixtures: TestFixtures;
  let admin: AuthedClient;
  let manager: AuthedClient;
  let managerHr: AuthedClient;
  let staf: AuthedClient;
  let connectorId: string;
  let skillId: string;
  let analystId: string;
  let writerId: string;
  /** Balasan tiruan dipilih berdasarkan system prompt (nama agent) agar urutan paralel aman. */
  let respond: (options: ChatRequestOptions) => ChatResult;
  const requests: ChatRequestOptions[] = [];

  const adapter: AiProviderAdapter = {
    id: 'tiruan',
    chat: (options) => {
      requests.push({ ...options, messages: [...options.messages] });
      try {
        return Promise.resolve(respond(options));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    // eslint-disable-next-line require-yield
    stream: async function* () {
      throw new Error('tidak dipakai');
    },
  };
  const reply = (content: string, toolCalls?: ChatResult['toolCalls']): ChatResult => ({
    content,
    model: 'model-uji',
    tokensIn: 3,
    tokensOut: 4,
    ...(toolCalls ? { toolCalls } : {}),
  });
  const lastIsTool = (options: ChatRequestOptions) => options.messages.at(-1)?.role === 'tool';

  async function waitTask(client: AuthedClient, id: string) {
    await runner.idle();
    const res = await asClient(app, client).get(`/api/ai/agent-tasks/${id}`);
    return res.body.data as {
      status: string;
      result: string | null;
      events: Array<{ id: string; event_type: string; message: string; payload: Record<string, unknown> }>;
      children: Array<{ id: string; status: string; agent_name: string }>;
    };
  }

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
    runner = app.get(TaskRunnerService);
    await resetDatabase(dataSource);
    fixtures = await seedTestFixtures(dataSource);
    await dataSource.query(`DROP TABLE IF EXISTS agent_demo_findings`);
    await dataSource.query(
      `CREATE TABLE agent_demo_findings (id int PRIMARY KEY, title text NOT NULL, status text NOT NULL)`,
    );
    await dataSource.query(
      `INSERT INTO agent_demo_findings VALUES (1, 'APAR kedaluwarsa', 'Open'), (2, 'Rambu rusak', 'Closed')`,
    );
    // Template admin dari Agent Center.
    await dataSource.query(
      `INSERT INTO agents (code, name, description, instruction, is_template)
       VALUES ('tpl-analis', 'Analis Data HSE', 'Menganalisis data K3', 'Analisis data K3 secara teliti dan ringkas.', true)`,
    );
    admin = await loginAs(app, 'admin@test.local');
    manager = await loginAs(app, 'manager@test.local');
    managerHr = await loginAs(app, 'managerhr@test.local');
    staf = await loginAs(app, 'staf@test.local');

    const url = new URL(process.env.DATABASE_URL!);
    const created = await asClient(app, admin).post('/api/integrations/db-connectors', {
      code: 'temuan',
      name: 'DB Temuan',
      engine: 'postgres',
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      allowWrite: true,
    });
    connectorId = created.body.data.id as string;
    await asClient(app, admin).post(`/api/integrations/connectors/database/${connectorId}/grants`, {
      subjectType: 'user',
      subjectId: fixtures.users.manager,
      access: 'read_write',
    });
  });

  afterAll(async () => {
    await runner.idle().catch(() => undefined);
    await dataSource.query(`DROP TABLE IF EXISTS agent_demo_findings`);
    await app.close();
  });

  beforeEach(() => {
    requests.length = 0;
  });

  it('staf tanpa izin tidak dapat mengelola agent', async () => {
    expect((await asClient(app, staf).get('/api/ai/agents')).status).toBe(403);
  });

  it('membuat skill dan agent dari template, lalu memasang skill dan konektor', async () => {
    const skill = await asClient(app, manager).post('/api/ai/skills', {
      name: 'Klasifikasi risiko',
      description: 'Menilai tingkat risiko temuan',
      instructions: 'Gunakan matriks 5x5: kemungkinan × keparahan. Sebutkan level Rendah/Sedang/Tinggi/Kritis.',
    });
    expect(skill.status).toBe(201);
    skillId = skill.body.data.id as string;

    const templates = await asClient(app, manager).get('/api/ai/agent-templates');
    const template = (templates.body.data as Array<{ id: string; name: string }>).find(
      (t) => t.name === 'Analis Data HSE',
    )!;
    const fromTemplate = await asClient(app, manager).post('/api/ai/agents/from-template', {
      templateId: template.id,
      name: 'Analis Temuan',
    });
    expect(fromTemplate.status).toBe(201);
    analystId = fromTemplate.body.data.id as string;
    expect(fromTemplate.body.data.template_name).toBe('Analis Data HSE');

    const updated = await asClient(app, manager).patch(`/api/ai/agents/${analystId}`, {
      skillIds: [skillId],
      connectors: [{ connectorType: 'database', connectorId, access: 'read_write' }],
      boundaries: 'Jangan menghapus data.',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.skills).toEqual([{ id: skillId, name: 'Klasifikasi risiko' }]);
    expect(updated.body.data.connectors[0]).toMatchObject({ granted: true, access: 'read_write' });

    // Template tidak muncul sebagai agent pribadi, dan agent pribadi tidak muncul di Agent Center.
    const mine = await asClient(app, manager).get('/api/ai/agents');
    expect((mine.body.data as unknown[]).length).toBe(1);
    const center = await asClient(app, admin).get('/api/agents');
    expect(JSON.stringify(center.body)).not.toContain('Analis Temuan');
  });

  it('agent pengguna lain tidak terlihat dan konektor tanpa grant ditolak', async () => {
    expect((await asClient(app, managerHr).get(`/api/ai/agents/${analystId}`)).status).toBe(404);
    const res = await asClient(app, managerHr).post('/api/ai/agents', {
      name: 'Coba',
      instruction: 'Instruksi panjang untuk agent coba.',
      connectors: [{ connectorType: 'database', connectorId, access: 'read' }],
    });
    expect(res.status).toBe(403);
  });

  it('tugas agent berjalan asinkron memakai skill dan konektor', async () => {
    respond = (options) =>
      lastIsTool(options)
        ? reply('## Ringkasan\n1 temuan terbuka: APAR kedaluwarsa (risiko Sedang).')
        : reply('Saya cek data temuan.', [
            {
              id: 'q1',
              name: 'db_temuan__run_query',
              input: { sql: "SELECT title FROM agent_demo_findings WHERE status = 'Open'" },
            },
          ]);
    const created = await asClient(app, manager).post('/api/ai/agent-tasks', {
      agentId: analystId,
      instruction: 'Rekap temuan yang masih terbuka beserta tingkat risikonya.',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('created');

    const task = await waitTask(manager, created.body.data.id as string);
    expect(task.status).toBe('completed');
    expect(task.result).toContain('APAR kedaluwarsa');
    const types = task.events.map((e) => e.event_type);
    expect(types).toEqual(
      expect.arrayContaining(['created', 'running', 'message', 'tool_call', 'tool_result', 'completed']),
    );
    expect(requests[0]!.systemPrompt).toContain('Analis Temuan');
    expect(requests[0]!.systemPrompt).toContain('Klasifikasi risiko');
    expect(requests[0]!.systemPrompt).toContain('Jangan menghapus data.');
    expect(requests[0]!.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(['db_temuan__run_query', 'minta_klarifikasi']),
    );
  });

  it('klarifikasi: tugas berhenti needs_input lalu lanjut setelah dibalas', async () => {
    respond = (options) =>
      lastIsTool(options)
        ? reply('Laporan bulan Oktober siap.')
        : reply('', [{ id: 'k1', name: 'minta_klarifikasi', input: { pertanyaan: 'Bulan apa?' } }]);
    const created = await asClient(app, manager).post('/api/ai/agent-tasks', {
      agentId: analystId,
      instruction: 'Buat laporan bulanan.',
    });
    let task = await waitTask(manager, created.body.data.id as string);
    expect(task.status).toBe('needs_input');
    expect(task.events.at(-1)).toMatchObject({ event_type: 'needs_input', message: 'Bulan apa?' });

    const answered = await asClient(app, manager).post(`/api/ai/agent-tasks/${created.body.data.id}/reply`, {
      message: 'Oktober 2026',
    });
    expect(answered.status).toBe(200);
    task = await waitTask(manager, created.body.data.id as string);
    expect(task.status).toBe('completed');
    expect(requests.at(-1)!.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'k1' });
    expect(requests.at(-1)!.messages.at(-1)!.content).toContain('Oktober 2026');
  });

  it('query tulis: tugas menunggu persetujuan, lalu dilanjutkan setelah disetujui', async () => {
    respond = (options) =>
      lastIsTool(options)
        ? reply('Temuan APAR ditutup.')
        : reply('Menutup temuan.', [
            {
              id: 'w1',
              name: 'db_temuan__run_query',
              input: { sql: "UPDATE agent_demo_findings SET status = 'Closed' WHERE id = 1", purpose: 'Tutup APAR' },
            },
          ]);
    const created = await asClient(app, manager).post('/api/ai/agent-tasks', {
      agentId: analystId,
      instruction: 'Tutup temuan APAR.',
    });
    const taskId = created.body.data.id as string;
    let task = await waitTask(manager, taskId);
    expect(task.status).toBe('awaiting_approval');
    const approvalEvent = task.events.find((e) => e.event_type === 'approval_required')!;
    expect(approvalEvent.payload).toMatchObject({ connector: 'DB Temuan', purpose: 'Tutup APAR' });

    const decided = await asClient(app, manager).post(
      `/api/ai/agent-tasks/${taskId}/tool-approvals/${approvalEvent.payload.approvalId as string}/decide`,
      { decision: 'approved' },
    );
    expect(decided.status).toBe(200);
    task = await waitTask(manager, taskId);
    expect(task.status).toBe('completed');
    const row = (await dataSource.query(`SELECT status FROM agent_demo_findings WHERE id = 1`)) as {
      status: string;
    }[];
    expect(row[0]!.status).toBe('Closed');

    // Pengguna lain tidak dapat melihat tugas ini.
    expect((await asClient(app, managerHr).get(`/api/ai/agent-tasks/${taskId}`)).status).toBe(404);
  });

  let delegateGroupId: string;

  it('grup delegasi: Leader mendelegasikan ke anggota lalu merangkum', async () => {
    const writer = await asClient(app, manager).post('/api/ai/agents', {
      name: 'Penulis Laporan',
      instruction: 'Menulis laporan K3 yang rapi dalam Markdown.',
    });
    writerId = writer.body.data.id as string;
    const group = await asClient(app, manager).post('/api/ai/agent-groups', {
      name: 'Tim Laporan K3',
      mode: 'delegate',
      leaderAgentId: analystId,
      memberAgentIds: [writerId],
    });
    expect(group.status).toBe(201);
    delegateGroupId = group.body.data.id as string;
    expect(group.body.data.members).toHaveLength(2);

    respond = (options) => {
      const isWriter = options.systemPrompt.includes('"Penulis Laporan"');
      if (isWriter) return reply('# Laporan\nIsi laporan dari penulis.');
      return lastIsTool(options)
        ? reply('Hasil akhir tim: laporan sudah disusun penulis.')
        : reply('Saya bagi tugas.', [
            { id: 'd1', name: 'delegasikan', input: { anggota: 'Penulis Laporan', instruksi: 'Tulis laporan K3.' } },
          ]);
    };
    const created = await asClient(app, manager).post('/api/ai/agent-tasks', {
      groupId: delegateGroupId,
      instruction: 'Susun laporan K3 minggu ini.',
    });
    const task = await waitTask(manager, created.body.data.id as string);
    expect(task.status).toBe('completed');
    expect(task.result).toContain('Hasil akhir tim');
    expect(task.children).toEqual([expect.objectContaining({ status: 'completed', agent_name: 'Penulis Laporan' })]);
    expect(task.events.map((e) => e.event_type)).toEqual(expect.arrayContaining(['delegated', 'delegate_result']));
    const leaderPrompt = requests.find((r) => r.systemPrompt.includes('"Analis Temuan"'))!.systemPrompt;
    expect(leaderPrompt).toContain('Leader grup "Tim Laporan K3"');

    // Sub-tugas tidak muncul di daftar utama.
    const list = await asClient(app, manager).get('/api/ai/tasks?page=1&pageSize=50');
    const parents = (list.body.data as Array<{ parent_task_id: string | null }>).map((t) => t.parent_task_id);
    expect(parents.length).toBeGreaterThan(0);
    expect(parents.every((p) => p === null)).toBe(true);
  });

  it('grup diskusi: anggota bergiliran lalu Leader menyimpulkan', async () => {
    const group = await asClient(app, manager).post('/api/ai/agent-groups', {
      name: 'Forum Risiko',
      mode: 'discussion',
      leaderAgentId: analystId,
      memberAgentIds: [writerId],
      maxRounds: 3,
    });
    let turn = 0;
    respond = (options) => {
      const prompt = options.messages[0]!.content;
      if (prompt.includes('susun hasil akhir')) return reply('## Kesimpulan\nRisiko utama: highwall.');
      turn += 1;
      // Ronde 2: anggota menyatakan setuju sehingga diskusi berhenti lebih awal.
      if (prompt.includes('Ronde 2') && options.systemPrompt.includes('"Penulis Laporan"')) {
        return reply('SETUJU, tidak ada tambahan.');
      }
      return reply(`Pendapat ke-${turn}.`);
    };
    const created = await asClient(app, manager).post('/api/ai/agent-tasks', {
      groupId: group.body.data.id,
      instruction: 'Diskusikan risiko terbesar bulan ini.',
    });
    const task = await waitTask(manager, created.body.data.id as string);
    expect(task.status).toBe('completed');
    expect(task.result).toContain('Kesimpulan');
    const discussion = task.events.filter((e) => e.event_type === 'discussion');
    expect(discussion).toHaveLength(4); // 2 ronde × 2 peserta
    expect(task.events.map((e) => e.event_type)).toContain('consensus');
    expect(discussion[0]!.payload).toMatchObject({ agentName: 'Analis Temuan', round: 1, leader: true });
  });

  it('pembatalan menghentikan tugas dan grup dapat dihapus', async () => {
    respond = () => reply('', [{ id: 'k9', name: 'minta_klarifikasi', input: { pertanyaan: 'Detail?' } }]);
    const created = await asClient(app, manager).post('/api/ai/agent-tasks', {
      agentId: analystId,
      instruction: 'Tugas yang akan dibatalkan.',
    });
    await runner.idle();
    const cancelled = await asClient(app, manager).post(`/api/ai/agent-tasks/${created.body.data.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');

    expect((await asClient(app, manager).delete(`/api/ai/agent-groups/${delegateGroupId}`)).status).toBe(204);
  });
});
