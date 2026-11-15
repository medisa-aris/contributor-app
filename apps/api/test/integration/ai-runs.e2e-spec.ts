import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DATA_SOURCE } from '../../src/database/database.module';
import { TaskRunnerService } from '../../src/modules/ai/agents/task-runner.service';
import { PROVIDER_ADAPTER_FACTORY } from '../../src/modules/ai/models/provider-registry.service';
import type { AiProviderAdapter, ChatRequestOptions, ChatResult } from '../../src/modules/ai/providers/types';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures } from './helpers/reset-db';

/** 'hang' = stream menunggu sampai dibatalkan (untuk uji hentikan/tenggat). */
const behaviour = { mode: 'normal' as 'normal' | 'hang' };
const seen: ChatRequestOptions[] = [];

function reply(options: ChatRequestOptions): ChatResult {
  seen.push(options);
  return { content: 'Hasil kerja panjang selesai.', model: options.model, tokensIn: 50, tokensOut: 50 };
}

const adapter: AiProviderAdapter = {
  id: 'palsu',
  chat: (options) => Promise.resolve(reply(options)),
  stream: async function* (options) {
    if (behaviour.mode === 'hang') {
      yield 'Sedang bekerja… ';
      await new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason ?? new Error('aborted')));
      });
    }
    yield 'Hasil ';
    return reply(options);
  },
};

describe('Kerja panjang: run percakapan (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let manager: AuthedClient;

  async function waitFor(runId: string, statuses: string[], timeoutMs = 15000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const rows = (await dataSource.query(`SELECT * FROM ai_runs WHERE id = $1`, [runId])) as {
        status: string;
        attempt: number;
        result_message_id: string | null;
        error: string | null;
      }[];
      if (rows[0] && statuses.includes(rows[0].status)) return rows[0];
      if (Date.now() > until) throw new Error(`run ${runId} tetap ${rows[0]?.status}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  function start(prompt = 'Kerjakan analisis panjang') {
    return asClient(app, manager).post('/api/ai/runs', { mode: 'second_brain', prompt });
  }

  function readEvents(runId: string, lastEventId?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let req = request(app.getHttpServer()).get(`/api/ai/runs/${runId}/events`).set('Cookie', manager.cookies);
      if (lastEventId !== undefined) req = req.set('Last-Event-ID', String(lastEventId));
      req
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString('utf-8')));
          res.on('end', () => callback(null, data));
        })
        .end((err, res) => (err ? reject(err) : resolve(res.body as string)));
    });
  }

  beforeAll(async () => {
    process.env.AI_WORKER_ENABLED = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROVIDER_ADAPTER_FACTORY)
      .useValue(() => adapter)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get<DataSource>(DATA_SOURCE);
    await resetDatabase(dataSource);
    await seedTestFixtures(dataSource);
    manager = await loginAs(app, 'manager@test.local');
  });

  afterAll(async () => {
    behaviour.mode = 'normal';
    await app.close();
    process.env.AI_WORKER_ENABLED = 'false';
  });

  beforeEach(() => {
    behaviour.mode = 'normal';
  });

  it('run selesai di pekerja; jawaban tersimpan dan event dapat diputar ulang setelah putus', async () => {
    const created = await start();
    expect(created.status).toBe(201);
    const runId = created.body.data.run.id as string;
    const done = await waitFor(runId, ['completed']);
    expect(done.result_message_id).not.toBeNull();

    const message = (await dataSource.query(
      `SELECT content, run_id FROM conversation_messages WHERE id = $1`,
      [done.result_message_id],
    )) as { content: string; run_id: string }[];
    expect(message[0]).toMatchObject({ run_id: runId });
    expect(message[0]!.content).toContain('Hasil kerja panjang selesai.');

    const full = await readEvents(runId);
    expect(full).toContain('event: done');
    const ids = [...full.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(2);
    // Sambung ulang dengan Last-Event-ID: hanya event setelahnya yang dikirim.
    const tail = await readEvents(runId, ids[1]);
    const tailIds = [...tail.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(tailIds[0]).toBe(ids[2]);
    expect(tail).toContain('event: done');
  });

  it('permintaan kerja panjang memakai batas waktu kerja panjang, bukan riwayat dibatasi jumlah pesan', async () => {
    const last = seen.at(-1)!;
    expect(last.signal).toBeDefined();
    expect(last.messages.at(-1)?.content).toBe('Kerjakan analisis panjang');
  });

  it('hentikan: run dibatalkan dalam beberapa detik dan pekerjaan sejauh ini disimpan', async () => {
    behaviour.mode = 'hang';
    const created = await start('Tugas yang akan dihentikan');
    const runId = created.body.data.run.id as string;
    await waitFor(runId, ['running']);
    const startedAt = Date.now();
    await asClient(app, manager).post(`/api/ai/runs/${runId}/cancel`).expect(200);
    const run = await waitFor(runId, ['cancelled']);
    expect(Date.now() - startedAt).toBeLessThan(8000);
    // Pekerja selesai menyimpan setelah status berubah.
    await new Promise((r) => setTimeout(r, 2500));
    const saved = (await dataSource.query(`SELECT result_message_id FROM ai_runs WHERE id = $1`, [runId])) as {
      result_message_id: string | null;
    }[];
    expect(run.status).toBe('cancelled');
    expect(saved[0]!.result_message_id).not.toBeNull();
  });

  it('tenggat waktu: run berhenti dengan deadline_exceeded', async () => {
    behaviour.mode = 'hang';
    const created = await start('Tugas yang kehabisan waktu');
    const runId = created.body.data.run.id as string;
    await dataSource.query(`UPDATE ai_runs SET deadline_at = now() + interval '2 seconds' WHERE id = $1`, [runId]);
    const run = await waitFor(runId, ['deadline_exceeded'], 20000);
    expect(run.error).toBe('Waktu kerja habis.');
  });

  it('lease kedaluwarsa: run dilanjutkan pekerja lain dari checkpoint; tool terpotong tidak dijalankan ulang', async () => {
    const created = await start('Tugas yang dipulihkan');
    const runId = created.body.data.run.id as string;
    await waitFor(runId, ['completed']);
    // Simulasikan pekerja mati di tengah langkah: asisten meminta tool tanpa hasil tersimpan.
    await dataSource.query(`DELETE FROM ai_run_messages WHERE run_id = $1`, [runId]);
    await dataSource.query(
      `INSERT INTO ai_run_messages (run_id, seq, message) VALUES ($1, 1, $2)`,
      [runId, JSON.stringify({ role: 'assistant', content: 'Memeriksa sistem.', toolCalls: [{ id: 't1', name: 'tulis_data', input: {} }] })],
    );
    await dataSource.query(`INSERT INTO ai_run_tool_calls (run_id, tool_call_id, name, status) VALUES ($1, 't1', 'tulis_data', 'started')`, [runId]);
    await dataSource.query(
      `UPDATE ai_runs SET status = 'running', lease_owner = 'pekerja-mati', lease_expires_at = now() - interval '1 second',
                          attempt = 1, checkpoint_seq = 1, result_message_id = NULL WHERE id = $1`,
      [runId],
    );
    const resumed = await waitFor(runId, ['completed'], 20000);
    expect(resumed.attempt).toBe(2);
    const transcript = (await dataSource.query(`SELECT message FROM ai_run_messages WHERE run_id = $1 ORDER BY seq`, [runId])) as {
      message: { role: string; content: string }[] & { role: string; content: string };
    }[];
    const tool = transcript.map((r) => r.message as unknown as { role: string; content: string }).find((m) => m.role === 'tool');
    expect(tool?.content).toContain('Status tidak diketahui');
  });

  it('batas run bersamaan per pengguna ditegakkan', async () => {
    behaviour.mode = 'hang';
    const a = await start('Run A');
    const b = await start('Run B');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const c = await start('Run C');
    expect(c.status).toBe(409);
    await asClient(app, manager).post(`/api/ai/runs/${a.body.data.run.id}/cancel`).expect(200);
    await asClient(app, manager).post(`/api/ai/runs/${b.body.data.run.id}/cancel`).expect(200);
  });

  it('tugas agent: lease kedaluwarsa → dilanjutkan dari checkpoint, bukan digagalkan', async () => {
    const agent = await asClient(app, manager).post('/api/ai/agents', { name: 'Agent Pemulihan', instruction: 'Bantu saya menyusun ringkasan.' });
    expect(agent.status).toBe(201);
    const task = await asClient(app, manager).post('/api/ai/agent-tasks', {
      agentId: agent.body.data.id,
      instruction: 'Susun ringkasan mingguan.',
    });
    expect(task.status).toBe(201);
    const taskId = task.body.data.id as string;
    const runner = app.get(TaskRunnerService);
    await runner.idle(15000);
    const first = (await dataSource.query(`SELECT status, current_run_id FROM ai_tasks WHERE id = $1`, [taskId])) as {
      status: string;
      current_run_id: string;
    }[];
    expect(first[0]!.status).toBe('completed');
    expect(first[0]!.current_run_id).not.toBeNull();

    // Instance mati di tengah langkah: tugas tertinggal "running", lease kedaluwarsa, tool belum berhasil disimpan.
    await dataSource.query(
      `INSERT INTO ai_task_messages (task_id, agent_id, message) VALUES ($1, $2, $3)`,
      [taskId, agent.body.data.id, JSON.stringify({ role: 'assistant', content: 'Mengambil data.', toolCalls: [{ id: 'x1', name: 'db__run_query', input: {} }] })],
    );
    await dataSource.query(`UPDATE ai_tasks SET status = 'running' WHERE id = $1`, [taskId]);
    await dataSource.query(
      `UPDATE ai_runs SET status = 'running', lease_owner = 'instance-mati', lease_expires_at = now() - interval '1 second', attempt = 1
        WHERE id = $1`,
      [first[0]!.current_run_id],
    );
    await runner.recover();
    await runner.idle(15000);
    const after = (await dataSource.query(`SELECT status FROM ai_tasks WHERE id = $1`, [taskId])) as { status: string }[];
    expect(after[0]!.status).toBe('completed');
    const repaired = (await dataSource.query(
      `SELECT message FROM ai_task_messages WHERE task_id = $1 AND message->>'toolCallId' = 'x1'`,
      [taskId],
    )) as { message: { content: string } }[];
    expect(repaired[0]!.message.content).toContain('Status tidak diketahui');
    const events = (await dataSource.query(`SELECT event_type FROM ai_task_events WHERE task_id = $1`, [taskId])) as {
      event_type: string;
    }[];
    expect(events.map((e) => e.event_type)).toContain('resumed');
  });

  it('daftar proses aktif dan larangan membaca run milik orang lain', async () => {
    const list = await asClient(app, manager).get('/api/ai/runs?status=recent').expect(200);
    expect((list.body.data as unknown[]).length).toBeGreaterThan(0);
    const runId = (list.body.data as { id: string }[])[0]!.id;
    const admin = await loginAs(app, 'admin@test.local');
    await asClient(app, admin).get(`/api/ai/runs/${runId}`).expect(404);
  });
});
