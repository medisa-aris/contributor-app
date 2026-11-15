import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DATA_SOURCE } from '../../src/database/database.module';
import { TaskRunnerService } from '../../src/modules/ai/agents/task-runner.service';
import { PROVIDER_ADAPTER_FACTORY } from '../../src/modules/ai/models/provider-registry.service';
import type {
  AiProviderAdapter,
  ChatRequestOptions,
  ChatResult,
} from '../../src/modules/ai/providers/types';
import {
  EXTRACTOR_PROMPT,
  MemoryExtractionService,
} from '../../src/modules/memory/memory-extraction.service';
import { CONSOLIDATION_PROMPT, DIGEST_PROMPT } from '../../src/modules/memory/memory-insights.service';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures, type TestFixtures } from './helpers/reset-db';

/**
 * Memori terpusat dengan pintu (docs/LLM-requirement.md §12):
 * jangkauan dari kepala departemen, izin pemilik, pintu per percakapan/tugas,
 * catatan pribadi, pencabutan langsung, log akses, dan jalur tulis (ekstraksi).
 */
describe('Memori terpusat & pintu memori (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let runner: TaskRunnerService;
  let notes: MemoryExtractionService;
  let fx: TestFixtures;
  let admin: AuthedClient;
  let manager: AuthedClient;
  let staf: AuthedClient;
  let agentId: string;
  let conversationId: string;
  let stafSubject: string;
  let agentSubject: string;

  const requests: ChatRequestOptions[] = [];
  let extraction: () => string = () => '{"operations":[]}';

  const adapter: AiProviderAdapter = {
    id: 'tiruan',
    chat: (options) => {
      requests.push({ ...options, messages: [...options.messages] });
      const content = options.systemPrompt.startsWith(EXTRACTOR_PROMPT)
        ? extraction()
        : options.systemPrompt.startsWith(CONSOLIDATION_PROMPT)
          ? 'Manajer memimpin tim klaim IT dan menyukai jawaban berupa poin singkat.'
          : options.systemPrompt.startsWith(DIGEST_PROMPT)
            ? '## Tema utama\n- Verifikasi klaim santunan menurut Staf.'
            : 'Jawaban uji.';
      return Promise.resolve({ content, model: 'model-uji', tokensIn: 3, tokensOut: 4 } satisfies ChatResult);
    },
    // eslint-disable-next-line require-yield
    stream: async function* () {
      throw new Error('tidak dipakai');
    },
  };

  /** System prompt permintaan chat terakhir (bukan ekstraksi). */
  function lastChatPrompt(): string {
    const chat = [...requests]
      .reverse()
      .find(
        (r) =>
          !r.systemPrompt.startsWith(EXTRACTOR_PROMPT) &&
          !r.systemPrompt.startsWith(CONSOLIDATION_PROMPT) &&
          !r.systemPrompt.startsWith(DIGEST_PROMPT),
      );
    return chat?.systemPrompt ?? '';
  }

  async function ask(prompt: string) {
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      conversationId,
      prompt,
    });
    expect(res.status).toBe(200);
    return res.body.data.assistant as { memory_refs: { subjectName: string; own: boolean; content: string }[] | null };
  }

  async function addEntry(client: AuthedClient, body: Record<string, unknown>): Promise<string> {
    const res = await asClient(app, client).post('/api/memory/me/entries', body);
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Adapter palsu untuk semua penyedia; registry tetap membungkusnya dengan Guardrails.
      .overrideProvider(PROVIDER_ADAPTER_FACTORY)
      .useValue(() => adapter)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get<DataSource>(DATA_SOURCE);
    runner = app.get(TaskRunnerService);
    notes = app.get(MemoryExtractionService);
    await resetDatabase(dataSource);
    fx = await seedTestFixtures(dataSource);

    const agents = (await dataSource.query(
      `INSERT INTO agents (code, name, description, instruction, owner_user_id)
       VALUES ('uji-notifikasi', 'Agen Notifikasi', 'Mengabari pemohon klaim',
               'Susun pesan singkat untuk pemohon klaim.', $1) RETURNING id`,
      [fx.users.manager],
    )) as { id: string }[];
    agentId = agents[0]!.id;

    admin = await loginAs(app, 'admin@test.local');
    manager = await loginAs(app, 'manager@test.local');
    staf = await loginAs(app, 'staf@test.local');

    const draft = await asClient(app, manager).post('/api/ai/conversations', { mode: 'second_brain' });
    conversationId = draft.body.data.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('tanpa izin membuka pintu, jangkauan ditolak 403 (AC9)', async () => {
    await asClient(app, staf).get('/api/memory/reach').expect(403);
  });

  it('jangkauan: agent sendiri selalu; bawahan setelah ditetapkan kepala departemen (R1, R2, R4)', async () => {
    const before = await asClient(app, manager).get('/api/memory/reach').expect(200);
    expect(before.body.data.map((s: { name: string }) => s.name)).toEqual(['Agen Notifikasi']);

    await asClient(app, admin)
      .patch(`/api/admin/departments/${fx.departments.it}`, { headUserId: fx.users.manager })
      .expect(200);

    const reach = await asClient(app, manager).get('/api/memory/reach').expect(200);
    const subjects = reach.body.data as { subjectId: string; name: string; kind: string; granted: boolean }[];
    const names = subjects.map((s) => s.name);
    // IT-Data adalah sub-departemen IT, jadi Staf ikut terjangkau (transitif).
    expect(names).toEqual(expect.arrayContaining(['Staf', 'Admin', 'Super Admin', 'Agen Notifikasi']));
    expect(names).not.toContain('Manajer');
    expect(names).not.toContain('Manajer HR');
    expect(names).not.toContain('Nonaktif');
    stafSubject = subjects.find((s) => s.name === 'Staf')!.subjectId;
    const agent = subjects.find((s) => s.kind === 'agent')!;
    agentSubject = agent.subjectId;
    expect(agent.granted).toBe(true);
    expect(subjects.find((s) => s.name === 'Staf')!.granted).toBe(false);
  });

  it('catatan manual: data pribadi ditutup permanen (AC11)', async () => {
    const res = await asClient(app, staf).post('/api/memory/me/entries', {
      type: 'fact',
      content: 'Nomor HP saya 0812-3456-7890 dan NIK 3201012304890002 untuk verifikasi.',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.content).toContain('[nomor telepon]');
    expect(res.body.data.content).toContain('[NIK]');
    expect(res.body.data.content).not.toContain('3201012304890002');
    expect(res.body.data.editedByOwner).toBe(true);
  });

  it('pintu yang belum diizinkan pemilik tidak dapat dibuka (AC5)', async () => {
    await addEntry(staf, { type: 'fact', content: 'Batas verifikasi klaim santunan adalah 3 hari kerja.' });
    await addEntry(staf, { type: 'decision', content: 'Disepakati klaim di atas 50 juta wajib dua tanda tangan.' });
    await addEntry(staf, {
      type: 'fact',
      content: 'Staf sedang mempertimbangkan pindah ke tim klaim lain.',
      sensitivity: 'private',
    });
    await addEntry(admin, { type: 'fact', content: 'Admin memegang SOP verifikasi klaim versi lama.' });
    await addEntry(manager, {
      type: 'preference',
      content: 'Manajer lebih suka jawaban berupa poin singkat.',
      importance: 5,
    });

    const res = await asClient(app, manager).put(`/api/memory/contexts/conversation/${conversationId}/doors`, {
      subjectIds: [stafSubject],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.details.rejected).toEqual([stafSubject]);
  });

  it('subjek di luar jangkauan ditolak walau pintunya terbuka (AC4)', async () => {
    const rows = (await dataSource.query(
      `INSERT INTO memory_subjects (kind, user_id, owner_user_id) VALUES ('user', $1, $1) RETURNING id`,
      [fx.users.managerHr],
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO memory_doors (subject_id, enabled, updated_by) VALUES ($1, true, $2)`,
      [rows[0]!.id, fx.users.managerHr],
    );
    const res = await asClient(app, manager).put(`/api/memory/contexts/conversation/${conversationId}/doors`, {
      subjectIds: [rows[0]!.id],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.details.rejected).toEqual([rows[0]!.id]);
  });

  it('tanpa pintu terbuka, hanya memori sendiri yang dipakai (AC1)', async () => {
    await ask('Berapa batas verifikasi klaim santunan?');
    const prompt = lastChatPrompt();
    expect(prompt).toContain('Manajer lebih suka jawaban berupa poin singkat.');
    expect(prompt).not.toContain('3 hari kerja');
    expect(prompt).not.toContain('SOP verifikasi klaim versi lama');
  });

  it('membuka pintu Staf saja: catatan Staf terpakai, Admin tidak, pribadi & jenis tertutup tidak (AC2, AC7, AC8)', async () => {
    await asClient(app, staf)
      .put('/api/memory/me/door', { enabled: true, exposedTypes: ['fact'] })
      .expect(200);
    await asClient(app, admin)
      .put('/api/memory/me/door', { enabled: true, exposedTypes: ['fact', 'decision'] })
      .expect(200);

    const opened = await asClient(app, manager)
      .put(`/api/memory/contexts/conversation/${conversationId}/doors`, { subjectIds: [stafSubject] })
      .expect(200);
    expect(opened.body.data).toEqual([expect.objectContaining({ subjectId: stafSubject, effective: true })]);

    const assistant = await ask('Berapa batas verifikasi klaim santunan dan aturan tanda tangan?');
    const prompt = lastChatPrompt();
    expect(prompt).toContain('Dari memori Staf (dibuka melalui pintu)');
    expect(prompt).toContain('Batas verifikasi klaim santunan adalah 3 hari kerja.');
    expect(prompt).not.toContain('pindah ke tim klaim lain'); // pribadi
    expect(prompt).not.toContain('dua tanda tangan'); // keputusan tidak dibuka pintunya
    expect(prompt).not.toContain('SOP verifikasi klaim versi lama'); // pintu Admin tidak dibuka
    expect(assistant.memory_refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ subjectName: 'Staf', own: false })]),
    );

    const stored = (await dataSource.query(
      `SELECT memory_refs FROM conversation_messages
        WHERE conversation_id = $1 AND role = 'assistant' ORDER BY id DESC LIMIT 1`,
      [conversationId],
    )) as { memory_refs: { subjectName: string }[] }[];
    expect(stored[0]!.memory_refs.map((r) => r.subjectName)).toContain('Staf');
  });

  it('pembukaan dan pemakaian tercatat dan terlihat oleh pemilik (AC10)', async () => {
    const log = await asClient(app, staf).get('/api/memory/me/access-log').expect(200);
    const actions = log.body.data.map((r: { action: string; actorName: string }) => `${r.action}:${r.actorName}`);
    expect(actions).toEqual(expect.arrayContaining(['door_opened:Manajer', 'entries_read:Manajer']));
    const audit = (await dataSource.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE event_key = 'ai.memory.door_opened' AND entity_id = $1`,
      [stafSubject],
    )) as { n: number }[];
    expect(audit[0]!.n).toBe(1);
    // Atasan tidak punya endpoint untuk membaca isi buku bawahan.
    await asClient(app, manager).get(`/api/memory/agents/${stafSubject}/entries`).expect(404);
  });

  it('pemilik mencabut izin: jawaban berikutnya tidak memakai catatannya (AC6)', async () => {
    await asClient(app, staf).put('/api/memory/me/door', { enabled: false, exposedTypes: ['fact'] }).expect(200);
    const doors = await asClient(app, manager)
      .get(`/api/memory/contexts/conversation/${conversationId}/doors`)
      .expect(200);
    expect(doors.body.data).toEqual([expect.objectContaining({ subjectId: stafSubject, effective: false })]);
    await ask('Berapa batas verifikasi klaim santunan?');
    expect(lastChatPrompt()).not.toContain('3 hari kerja');
  });

  it('pengguna nonaktif keluar dari jangkauan dan pintunya diabaikan (AC16)', async () => {
    await asClient(app, staf).put('/api/memory/me/door', { enabled: true, exposedTypes: ['fact'] }).expect(200);
    await dataSource.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [fx.users.staf]);
    try {
      const reach = await asClient(app, manager).get('/api/memory/reach').expect(200);
      expect(reach.body.data.map((s: { name: string }) => s.name)).not.toContain('Staf');
      await ask('Berapa batas verifikasi klaim santunan?');
      expect(lastChatPrompt()).not.toContain('3 hari kerja');
    } finally {
      await dataSource.query(`UPDATE users SET status = 'active' WHERE id = $1`, [fx.users.staf]);
    }
    await ask('Berapa batas verifikasi klaim santunan?');
    expect(lastChatPrompt()).toContain('3 hari kerja');
  });

  it('ekstraksi: catatan baru disaring, keputusan lama digantikan, catatan yang diubah pemilik tidak ditimpa (AC12, AC13)', async () => {
    const old = (await dataSource.query(
      `SELECT e.id FROM memory_entries e WHERE e.subject_id = $1 AND e.content LIKE '%dua tanda tangan%'`,
      [stafSubject],
    )) as { id: string }[];
    const edited = (await dataSource.query(
      `SELECT e.id FROM memory_entries e WHERE e.subject_id = $1 AND e.content LIKE '%3 hari kerja%'`,
      [stafSubject],
    )) as { id: string }[];
    // Catatan dari ekstraksi lama (belum diubah pemilik) agar bisa digantikan.
    await dataSource.query(`UPDATE memory_entries SET edited_by_owner = false WHERE id = $1`, [old[0]!.id]);

    const conv = (await dataSource.query(
      `INSERT INTO conversations (user_id, mode, title) VALUES ($1, 'second_brain', 'Rapat klaim') RETURNING id`,
      [fx.users.staf],
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, role, content) VALUES
         ($1, 'user', 'Mulai bulan ini klaim di atas 50 juta cukup satu tanda tangan kepala cabang. Hubungi saya di 0812-1111-2222.'),
         ($1, 'assistant', 'Baik, saya catat perubahannya.')`,
      [conv[0]!.id],
    );
    extraction = () =>
      JSON.stringify({
        operations: [
          {
            op: 'supersede',
            targetId: old[0]!.id,
            about: 'user',
            type: 'decision',
            content: 'Klaim di atas 50 juta kini cukup satu tanda tangan kepala cabang (Nov 2026).',
            importance: 4,
            confidence: 0.9,
            sensitivity: 'shareable',
          },
          {
            op: 'update',
            targetId: edited[0]!.id,
            about: 'user',
            type: 'fact',
            content: 'Batas verifikasi klaim diubah AI.',
            importance: 3,
            confidence: 0.9,
            sensitivity: 'shareable',
          },
          {
            op: 'add',
            targetId: null,
            about: 'user',
            type: 'fact',
            content: 'Staf dapat dihubungi di 0812-1111-2222.',
            importance: 2,
            confidence: 0.8,
            sensitivity: 'shareable',
          },
          { op: 'add', about: 'user', type: 'fact', content: 'Ragu-ragu.', confidence: 0.2 },
        ],
      });
    await notes.extractConversation(conv[0]!.id);

    const extractorRequest = requests.find((r) => r.systemPrompt.startsWith(EXTRACTOR_PROMPT))!;
    expect(extractorRequest.messages[0]!.content).not.toContain('0812-1111-2222');

    const rows = (await dataSource.query(
      `SELECT id, content, status, supersedes_id FROM memory_entries WHERE subject_id = $1`,
      [stafSubject],
    )) as { id: string; content: string; status: string; supersedes_id: string | null }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(old[0]!.id)!.status).toBe('superseded');
    const replacement = rows.find((r) => r.content.includes('satu tanda tangan'))!;
    expect(replacement.supersedes_id).toBe(old[0]!.id);
    expect(replacement.status).toBe('active');
    // Catatan yang diubah pemilik tidak ditimpa; versi AI masuk sebagai catatan baru.
    expect(byId.get(edited[0]!.id)!.content).toBe('Batas verifikasi klaim santunan adalah 3 hari kerja.');
    expect(rows.some((r) => r.content === 'Batas verifikasi klaim diubah AI.')).toBe(true);
    expect(rows.some((r) => r.content.includes('0812-1111-2222'))).toBe(false);
    expect(rows.some((r) => r.content.includes('[nomor telepon]'))).toBe(true);
    expect(rows.some((r) => r.content === 'Ragu-ragu.')).toBe(false);

    const watermark = (await dataSource.query(`SELECT memory_watermark FROM conversations WHERE id = $1`, [
      conv[0]!.id,
    ])) as { memory_watermark: string }[];
    expect(Number(watermark[0]!.memory_watermark)).toBeGreaterThan(0);

    // Tidak ada pesan baru → tidak ada panggilan LLM lagi.
    const before = requests.length;
    await notes.extractConversation(conv[0]!.id);
    expect(requests.length).toBe(before);
  });

  it('tugas agent: pintu dibuka saat membuat tugas, memori masuk prompt agent, lalu agent mencatat (task doors)', async () => {
    await asClient(app, manager)
      .post('/api/ai/agent-tasks', {
        agentId,
        instruction: 'Kabari pemohon soal batas verifikasi klaim santunan.',
        memorySubjectIds: [fx.users.managerHr],
      })
      .expect(403);

    extraction = () =>
      JSON.stringify({
        operations: [
          {
            op: 'add',
            about: 'agent',
            type: 'skill',
            content: 'Pesan ke pemohon klaim selalu menyebut batas verifikasi 3 hari kerja.',
            importance: 3,
            confidence: 0.9,
            sensitivity: 'shareable',
          },
        ],
      });
    const created = await asClient(app, manager)
      .post('/api/ai/agent-tasks', {
        agentId,
        instruction: 'Kabari pemohon soal batas verifikasi klaim santunan.',
        memorySubjectIds: [stafSubject],
      })
      .expect(201);
    const taskId = created.body.data.id as string;
    await runner.idle();
    await notes.flush();

    const doors = (await dataSource.query(`SELECT subject_id FROM task_memory_doors WHERE task_id = $1`, [
      taskId,
    ])) as { subject_id: string }[];
    expect(doors.map((d) => d.subject_id)).toEqual([stafSubject]);
    const agentPrompt = requests.find((r) => r.systemPrompt.includes('Anda adalah "Agen Notifikasi"'))!;
    expect(agentPrompt.systemPrompt).toContain('Batas verifikasi klaim santunan adalah 3 hari kerja.');

    const agentEntries = (await dataSource.query(
      `SELECT content, source_kind FROM memory_entries WHERE subject_id = $1`,
      [agentSubject],
    )) as { content: string; source_kind: string }[];
    expect(agentEntries).toEqual([
      expect.objectContaining({ source_kind: 'task', content: expect.stringContaining('3 hari kerja') }),
    ]);

    // Sitasi: catatan yang dipakai agent tersimpan pada tugasnya.
    const taskRefs = (await dataSource.query(`SELECT memory_refs FROM ai_tasks WHERE id = $1`, [taskId])) as {
      memory_refs: { subjectName: string; own: boolean }[] | null;
    }[];
    expect(taskRefs[0]!.memory_refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ subjectName: 'Staf', own: false })]),
    );

    // Pemilik agent mengelola buku agent; pengguna lain tidak.
    await asClient(app, manager).get(`/api/memory/agents/${agentId}/entries`).expect(200);
    await asClient(app, admin).get(`/api/memory/agents/${agentId}/entries`).expect(404);
  });

  it('tugas umum Subordinate: pintu, memori di prompt, sitasi, lalu pencatatan', async () => {
    await asClient(app, manager)
      .post('/api/ai/tasks', {
        title: 'Ringkas aturan klaim',
        instruction: 'Ringkas batas verifikasi klaim santunan.',
        memorySubjectIds: [fx.users.managerHr],
      })
      .expect(403);

    extraction = () => '{"operations":[]}';
    const created = await asClient(app, manager)
      .post('/api/ai/tasks', {
        title: 'Ringkas aturan klaim',
        instruction: 'Ringkas batas verifikasi klaim santunan.',
        memorySubjectIds: [stafSubject],
      })
      .expect(201);
    const taskId = created.body.data.id as string;
    const before = requests.length;
    const run = await asClient(app, manager).post(`/api/ai/tasks/${taskId}/run`).expect(200);
    expect(run.body.data.status).toBe('completed');

    const taskPrompt = requests.slice(before).find((r) => !r.systemPrompt.startsWith(EXTRACTOR_PROMPT))!;
    expect(taskPrompt.systemPrompt).toContain('Dari memori Staf (dibuka melalui pintu)');
    expect(run.body.data.memory_refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ subjectName: 'Staf', own: false })]),
    );

    await notes.flush();
    const runs = (await dataSource.query(
      `SELECT source_kind FROM memory_extraction_runs WHERE source_id = $1`,
      [taskId],
    )) as { source_kind: string }[];
    expect(runs).toEqual([{ source_kind: 'task' }]);
  });

  it('diskusi grup: agent anggota ikut dicatat dari kontribusinya sendiri', async () => {
    const members = (await dataSource.query(
      `INSERT INTO agents (code, name, description, instruction, owner_user_id)
       VALUES ('uji-k3', 'Agen K3', 'Pemeriksa keselamatan', 'Periksa aspek keselamatan.', $1) RETURNING id`,
      [fx.users.manager],
    )) as { id: string }[];
    const memberId = members[0]!.id;
    const group = await asClient(app, manager)
      .post('/api/ai/agent-groups', {
        name: 'Grup Klaim',
        mode: 'discussion',
        leaderAgentId: agentId,
        memberAgentIds: [agentId, memberId],
        maxRounds: 1,
      })
      .expect(201);

    extraction = () =>
      JSON.stringify({
        operations: [
          {
            op: 'add',
            about: 'agent2',
            type: 'skill',
            content: 'Agen K3 mengecek jalur evakuasi sebelum memberi rekomendasi.',
            importance: 3,
            confidence: 0.9,
            sensitivity: 'shareable',
          },
        ],
      });
    const created = await asClient(app, manager)
      .post('/api/ai/agent-tasks', {
        groupId: group.body.data.id,
        instruction: 'Diskusikan kesiapan evakuasi gedung klaim.',
      })
      .expect(201);
    await runner.idle();
    await notes.flush();

    const extractorCall = [...requests].reverse().find((r) => r.systemPrompt.startsWith(EXTRACTOR_PROMPT))!;
    const extractorInput = extractorCall.messages[0]!.content;
    expect(extractorInput).toContain('"Agen K3" (about="agent2")');
    expect(extractorInput).toContain('Kontribusi anggota grup Agen K3');

    const memberEntries = (await dataSource.query(
      `SELECT e.content, e.source_id FROM memory_entries e
         JOIN memory_subjects s ON s.id = e.subject_id WHERE s.agent_id = $1`,
      [memberId],
    )) as { content: string; source_id: string }[];
    expect(memberEntries).toEqual([
      { content: 'Agen K3 mengecek jalur evakuasi sebelum memberi rekomendasi.', source_id: created.body.data.id },
    ]);
  });

  it('pintu agent milik sendiri dapat dibuka di percakapan (AC3)', async () => {
    await asClient(app, manager)
      .put(`/api/memory/contexts/conversation/${conversationId}/doors`, { subjectIds: [stafSubject, agentSubject] })
      .expect(200);
    await ask('Bagaimana pesan ke pemohon soal batas verifikasi klaim?');
    const prompt = lastChatPrompt();
    expect(prompt).toContain('Dari memori Staf (dibuka melalui pintu)');
    expect(prompt).toContain('Dari memori Agen Notifikasi (dibuka melalui pintu)');
  });
  // ───────────────────────── Fase 2 ─────────────────────────

  async function openStafDoor(extra: Record<string, unknown> = {}) {
    await asClient(app, staf)
      .put('/api/memory/me/door', { enabled: true, exposedTypes: ['fact', 'decision'], ...extra })
      .expect(200);
  }

  it('P2 R6: agent milik bawahan masuk jangkauan hanya bila bawahan mengizinkan', async () => {
    await dataSource.query(
      `INSERT INTO agents (code, name, description, instruction, owner_user_id)
       VALUES ('uji-staf', 'Agen Staf', 'Asisten klaim staf', 'Bantu klaim.', $1)`,
      [fx.users.staf],
    );
    await openStafDoor({ exposeAgents: false });
    let reach = await asClient(app, manager).get('/api/memory/reach').expect(200);
    expect(reach.body.data.map((s: { name: string }) => s.name)).not.toContain('Agen Staf');

    await openStafDoor({ exposeAgents: true });
    reach = await asClient(app, manager).get('/api/memory/reach').expect(200);
    const agent = (reach.body.data as { name: string; ownerName: string | null; granted: boolean; kind: string }[]).find(
      (s) => s.name === 'Agen Staf',
    );
    expect(agent).toEqual(expect.objectContaining({ kind: 'agent', ownerName: 'Staf', granted: true }));
    // Agent milik manajer sendiri tidak diberi nama pemilik.
    expect(
      (reach.body.data as { name: string; ownerName: string | null }[]).find((s) => s.name === 'Agen Notifikasi')!
        .ownerName,
    ).toBeNull();

    await openStafDoor({ exposeAgents: false });
    reach = await asClient(app, manager).get('/api/memory/reach').expect(200);
    expect(reach.body.data.map((s: { name: string }) => s.name)).not.toContain('Agen Staf');
  });

  it('P2 kotak tinjauan: catatan baru ditahan sampai disetujui pemilik', async () => {
    await openStafDoor({ reviewRequired: true });
    const conv = (await dataSource.query(
      `INSERT INTO conversations (user_id, mode, title) VALUES ($1, 'second_brain', 'Klaim banjir') RETURNING id`,
      [fx.users.staf],
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO conversation_messages (conversation_id, role, content) VALUES
         ($1, 'user', 'Saya sedang memeriksa klaim banjir gudang timur.'),
         ($1, 'assistant', 'Baik, saya bantu.')`,
      [conv[0]!.id],
    );
    extraction = () =>
      JSON.stringify([
        {
          op: 'add',
          about: 'user',
          type: 'fact',
          content: 'Staf memeriksa klaim banjir gudang timur.',
          importance: 3,
          confidence: 0.9,
          sensitivity: 'shareable',
        },
      ]);
    await notes.extractConversation(conv[0]!.id);

    await asClient(app, manager)
      .put(`/api/memory/contexts/conversation/${conversationId}/doors`, { subjectIds: [stafSubject] })
      .expect(200);
    await ask('Siapa yang memeriksa klaim banjir gudang timur?');
    expect(lastChatPrompt()).not.toContain('klaim banjir gudang timur.');

    const inbox = await asClient(app, staf).get('/api/memory/me/review').expect(200);
    expect(inbox.body.data.map((e: { content: string }) => e.content)).toEqual([
      'Staf memeriksa klaim banjir gudang timur.',
    ]);
    const summary = await asClient(app, staf).get('/api/memory/me/summary').expect(200);
    expect(summary.body.data.pendingReview).toBe(1);

    const approved = await asClient(app, staf).post('/api/memory/me/review', { decision: 'approve' }).expect(200);
    expect(approved.body.data).toEqual({ affected: 1 });
    await ask('Siapa yang memeriksa klaim banjir gudang timur?');
    expect(lastChatPrompt()).toContain('Staf memeriksa klaim banjir gudang timur.');
    await openStafDoor({ reviewRequired: false });
  });

  it('P2 memori bersama grup: anggota membaca buku agent lain hanya bila grup mengizinkan', async () => {
    const k3 = (await dataSource.query(`SELECT id FROM agents WHERE code = 'uji-k3'`)) as { id: string }[];
    const k3Id = k3[0]!.id;
    await asClient(app, manager)
      .post(`/api/memory/agents/${k3Id}/entries`, {
        type: 'skill',
        content: 'Agen K3 selalu memeriksa jalur evakuasi gedung sebelum rekomendasi.',
      })
      .expect(201);

    const runGroup = async (shareMemory: boolean) => {
      const group = await asClient(app, manager)
        .post('/api/ai/agent-groups', {
          name: shareMemory ? 'Grup Berbagi' : 'Grup Tertutup',
          mode: 'discussion',
          leaderAgentId: agentId,
          memberAgentIds: [agentId, k3Id],
          maxRounds: 1,
          shareMemory,
        })
        .expect(201);
      expect(group.body.data.share_memory).toBe(shareMemory);
      const before = requests.length;
      await asClient(app, manager)
        .post('/api/ai/agent-tasks', {
          groupId: group.body.data.id,
          instruction: 'Diskusikan jalur evakuasi gedung klaim.',
        })
        .expect(201);
      await runner.idle();
      await notes.flush();
      return requests
        .slice(before)
        .filter((r) => r.systemPrompt.includes('Anda adalah "Agen Notifikasi"'))
        .map((r) => r.systemPrompt);
    };

    const closed = await runGroup(false);
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.join('\n')).not.toContain('Dari memori Agen K3');

    const shared = await runGroup(true);
    expect(shared.join('\n')).toContain('Dari memori Agen K3 (dibuka melalui pintu)');
    expect(shared.join('\n')).toContain('jalur evakuasi gedung sebelum rekomendasi');
  });

  // ───────────────────────── Fase 3 ─────────────────────────

  it('P3 ringkasan profil: dibuat dari buku sendiri dan hanya dipakai pemiliknya', async () => {
    const refreshed = await asClient(app, manager).post('/api/memory/me/summary/refresh').expect(200);
    expect(refreshed.body.data.profile).toEqual(
      expect.objectContaining({ content: 'Manajer memimpin tim klaim IT dan menyukai jawaban berupa poin singkat.' }),
    );
    await dataSource.query(
      `UPDATE memory_subjects SET summary = 'Ringkasan rahasia Staf yang memuat catatan pribadi.', summary_at = now()
        WHERE id = $1`,
      [stafSubject],
    );
    await openStafDoor();
    await asClient(app, manager)
      .put(`/api/memory/contexts/conversation/${conversationId}/doors`, { subjectIds: [stafSubject] })
      .expect(200);
    await ask('Berapa batas verifikasi klaim santunan?');
    const prompt = lastChatPrompt();
    expect(prompt).toContain('### Ringkasan profil Anda');
    expect(prompt).toContain('Manajer memimpin tim klaim IT');
    expect(prompt).not.toContain('Ringkasan rahasia Staf');
  });

  it('P3 ringkasan tim: hanya dari pintu yang diizinkan dan tercatat di log akses', async () => {
    await openStafDoor();
    const res = await asClient(app, manager)
      .post('/api/memory/digest', { subjectIds: [stafSubject], days: 30 })
      .expect(200);
    expect(res.body.data.content).toContain('Tema utama');
    const contents = (res.body.data.refs as { content: string; subjectName: string }[]).map((r) => r.content);
    expect(contents).toContain('Batas verifikasi klaim santunan adalah 3 hari kerja.');
    expect(contents.join(' ')).not.toContain('pindah ke tim klaim lain'); // pribadi
    expect(res.body.data.subjects).toEqual([expect.objectContaining({ subjectId: stafSubject, name: 'Staf' })]);

    const digestPrompt = [...requests].reverse().find((r) => r.systemPrompt.startsWith(DIGEST_PROMPT))!;
    expect(digestPrompt.messages[0]!.content).not.toContain('pindah ke tim klaim lain');

    const log = (await dataSource.query(
      `SELECT action, context_kind FROM memory_access_log WHERE subject_id = $1 AND action = 'digest_read'`,
      [stafSubject],
    )) as { action: string; context_kind: string }[];
    expect(log).toEqual([{ action: 'digest_read', context_kind: 'digest' }]);
    const stafLog = await asClient(app, staf).get('/api/memory/me/access-log').expect(200);
    expect(stafLog.body.data.map((l: { action: string }) => l.action)).toContain('digest_read');

    await asClient(app, staf).post('/api/memory/digest', { subjectIds: [stafSubject] }).expect(403);
    const hr = (await dataSource.query(`SELECT id FROM memory_subjects WHERE user_id = $1`, [
      fx.users.managerHr,
    ])) as { id: string }[];
    await asClient(app, manager).post('/api/memory/digest', { subjectIds: [hr[0]!.id] }).expect(403);
  });

  it('P3 tema memori: kata kunci tanpa isi catatan, dari pintu yang diizinkan saja', async () => {
    await openStafDoor();
    const res = await asClient(app, manager).get('/api/memory/themes').expect(200);
    const subjects = res.body.data as {
      name: string;
      own: boolean;
      themes: { term: string }[];
      counts: Record<string, number>;
    }[];
    expect(subjects[0]).toEqual(expect.objectContaining({ name: 'Manajer', own: true }));
    const stafThemes = subjects.find((s) => s.name === 'Staf')!;
    const terms = stafThemes.themes.map((t) => t.term);
    expect(terms).toEqual(expect.arrayContaining(['verifikasi']));
    expect(terms).not.toContain('pindah'); // catatan pribadi
    expect(JSON.stringify(res.body.data)).not.toContain('3 hari kerja');
    const log = (await dataSource.query(
      `SELECT count(*)::int AS n FROM memory_access_log WHERE subject_id = $1 AND action = 'themes_read'`,
      [stafSubject],
    )) as { n: number }[];
    expect(log[0]!.n).toBe(1);
    await asClient(app, staf).get('/api/memory/themes').expect(403);
  });
});
