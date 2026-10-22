import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures, type TestFixtures } from './helpers/reset-db';
import { createTestApp } from './helpers/test-app';

describe('Peta Pikiran (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fx: TestFixtures;
  let manager: AuthedClient;
  let staf: AuthedClient;

  async function conversation(userId: string, mode: string, title: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO conversations (user_id, mode, title) VALUES ($1, $2::conversation_mode, $3)`,
      [userId, mode, title],
    );
  }

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    await resetDatabase(dataSource);
    fx = await seedTestFixtures(dataSource);
    await conversation(fx.users.staf, 'second_brain', 'Strategi onboarding karyawan baru');
    await conversation(fx.users.staf, 'counterpart', 'Percakapan baru');
    await conversation(fx.users.admin, 'counterpart', 'Evaluasi onboarding vendor');
    await conversation(fx.users.hrAdmin, 'second_brain', 'Onboarding rahasia HR');
    await dataSource.query(
      `INSERT INTO ai_tasks (user_id, title, instruction) VALUES ($1, $2, 'x')`,
      [fx.users.staf, 'Ringkas laporan onboarding'],
    );
    manager = await loginAs(app, 'manager@test.local');
    staf = await loginAs(app, 'staf@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  it('staf tanpa izin ditolak 403', async () => {
    const res = await asClient(app, staf).get('/api/mind-map/org');
    expect(res.status).toBe(403);
  });

  it('org hanya memuat departemen & anggota dalam cakupan, dengan hitungan per mode', async () => {
    const res = await asClient(app, manager).get('/api/mind-map/org');
    expect(res.status).toBe(200);
    const { departments, people } = res.body.data;
    const deptIds = departments.map((d: { id: string }) => d.id);
    expect(deptIds).toEqual(expect.arrayContaining([fx.departments.it, fx.departments.itData]));
    expect(deptIds).not.toContain(fx.departments.hr);
    const ids = people.map((p: { id: string }) => p.id);
    expect(ids).toContain(fx.users.staf);
    expect(ids).not.toContain(fx.users.manager);
    expect(ids).not.toContain(fx.users.hrAdmin);
    expect(ids).not.toContain(fx.users.disabled);
    const s = people.find((p: { id: string }) => p.id === fx.users.staf);
    expect(s.counts).toEqual({ second_brain: 1, counterpart: 0, subordinate: 1 });
    expect(s.total).toBe(2);
  });

  it('thoughts anggota: judul bawaan tidak muncul, orang luar cakupan 404', async () => {
    const ok = await asClient(app, manager).get(`/api/mind-map/people/${fx.users.staf}/thoughts`);
    expect(ok.status).toBe(200);
    const titles = ok.body.data.thoughts.map((t: { title: string }) => t.title);
    expect(titles).toEqual(
      expect.arrayContaining(['Strategi onboarding karyawan baru', 'Ringkas laporan onboarding']),
    );
    expect(titles).not.toContain('Percakapan baru');

    const outside = await asClient(app, manager).get(
      `/api/mind-map/people/${fx.users.hrAdmin}/thoughts`,
    );
    expect(outside.status).toBe(404);
    const self = await asClient(app, manager).get(
      `/api/mind-map/people/${fx.users.manager}/thoughts`,
    );
    expect(self.status).toBe(404);
  });

  it('topics mengelompokkan per orang dan tidak membocorkan di luar cakupan', async () => {
    const res = await asClient(app, manager).get('/api/mind-map/topics?q=onboarding');
    expect(res.status).toBe(200);
    const { people, total, keywords } = res.body.data;
    const ids = people.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([fx.users.staf, fx.users.admin]));
    expect(ids).not.toContain(fx.users.hrAdmin);
    expect(total).toBe(3);
    expect(people[0].id).toBe(fx.users.staf);
    expect(people[0].count).toBe(2);
    expect(Array.isArray(keywords)).toBe(true);
  });

  it('wildcard LIKE di q diperlakukan literal', async () => {
    const res = await asClient(app, manager).get('/api/mind-map/topics?q=%25');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });

  it('filter mode dan validasi parameter', async () => {
    const only = await asClient(app, manager).get(
      '/api/mind-map/topics?q=onboarding&modes=subordinate',
    );
    expect(only.body.data.total).toBe(1);
    const bad = await asClient(app, manager).get('/api/mind-map/org?modes=ngawur');
    expect(bad.status).toBe(400);
  });

  it('akses tercatat di audit log', async () => {
    const rows = (await dataSource.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE event_key = 'ai.mindmap.viewed'`,
    )) as { n: number }[];
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2);
  });
});
