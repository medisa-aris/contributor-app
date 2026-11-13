import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures, type TestFixtures } from './helpers/reset-db';
import { createTestApp } from './helpers/test-app';

describe('Beranda & notifikasi (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fx: TestFixtures;
  let admin: AuthedClient;
  let manager: AuthedClient;
  let staf: AuthedClient;

  async function task(userId: string, title: string, status: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO ai_tasks (user_id, title, instruction, status, finished_at)
       VALUES ($1, $2, 'x', $3::task_status, CASE WHEN $3::text IN ('completed', 'failed') THEN now() END)`,
      [userId, title, status],
    );
  }

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    await resetDatabase(dataSource);
    fx = await seedTestFixtures(dataSource);

    await task(fx.users.manager, 'Ringkasan rapat', 'completed');
    await task(fx.users.manager, 'Draf laporan', 'failed');
    await task(fx.users.manager, 'Butuh jawaban', 'needs_input');
    await task(fx.users.staf, 'Tugas staf', 'completed');

    const source = (await dataSource.query(
      `INSERT INTO knowledge_sources (code, name) VALUES ('sop-uji', 'SOP') RETURNING id`,
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO knowledge_documents (source_id, title, content, status, indexed_at)
       VALUES ($1, 'SOP Klaim', 'isi', 'indexed', now()), ($1, 'Rusak', 'isi', 'failed', NULL)`,
      [source[0]!.id],
    );

    admin = await loginAs(app, 'admin@test.local');
    manager = await loginAs(app, 'manager@test.local');
    staf = await loginAs(app, 'staf@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  it('tanpa sesi ditolak 401', async () => {
    expect((await request(app.getHttpServer()).get('/api/dashboard/summary')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/api/notifications')).status).toBe(401);
  });

  it('manajer melihat tugas miliknya, dokumen dan agen, tanpa antrean persetujuan', async () => {
    const res = await asClient(app, manager).get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    const body = res.body.data;
    expect(body.tasks).toMatchObject({ done: 1, stopped: 1, action: 1, total: 3 });
    expect(body.documents).toMatchObject({ indexed: 1, failed: 1, pending: 0, sources: 1 });
    expect(body.agents).toBeDefined();
    expect(body.approvals).toBeUndefined();
    const kinds = body.highlights.map((h: { kind: string }) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(['taskDone', 'taskFailed', 'document']));
  });

  it('staf hanya mendapat bagian yang diizinkan', async () => {
    const res = await asClient(app, staf).get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    const body = res.body.data;
    expect(body.tasks).toBeUndefined();
    expect(body.approvals).toBeUndefined();
    expect(body.documents).toBeDefined();
    expect(body.agents).toBeDefined();
  });

  it('admin melihat jumlah persetujuan menunggu', async () => {
    const res = await asClient(app, admin).get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.approvals).toEqual({ pending: 0 });
  });

  it('status guardrails terbaca semua pengguna, hanya flag aktif', async () => {
    const res = await asClient(app, staf).get('/api/guardrails/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: false });
  });

  it('notifikasi manajer: tugas miliknya dan dokumen gagal, bukan tugas orang lain', async () => {
    const res = await asClient(app, manager).get('/api/notifications');
    expect(res.status).toBe(200);
    const items = res.body.data as { kind: string; title: string }[];
    expect(items.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['taskDone', 'taskFailed', 'taskAction', 'documentFailed']),
    );
    expect(items.map((i) => i.title)).not.toContain('Tugas staf');
    expect(items.some((i) => i.kind === 'approval')).toBe(false);
  });
});
