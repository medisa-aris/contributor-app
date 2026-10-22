import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { ERROR_CODES } from '../../src/common/errors/app-error';
import { asClient, loginAs } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures, TEST_PASSWORD, type TestFixtures } from './helpers/reset-db';
import { createTestApp } from './helpers/test-app';

describe('Permission guard & audit (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixtures: TestFixtures;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    await resetDatabase(dataSource);
    fixtures = await seedTestFixtures(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('tanpa sesi, endpoint ber-permission tetap 401 (bukan 403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/rbac/diagnostics/summary')
      .expect(401);
    expect(res.body.error.code).toBe(ERROR_CODES.unauthenticated);
  });

  it('staf tanpa admin.access ditolak 403 dengan detail missing', async () => {
    const client = await loginAs(app, 'staf@test.local');
    const res = await asClient(app, client)
      .get('/api/rbac/diagnostics/summary')
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.forbidden);
    expect(res.body.error.details.required).toContain('admin.access');
    expect(res.body.error.details.missing).toContain('admin.access');
  });

  it('manajer dengan admin.access dapat mengakses summary', async () => {
    const client = await loginAs(app, 'manager@test.local');
    const res = await asClient(app, client)
      .get('/api/rbac/diagnostics/summary')
      .expect(200);
    expect(res.body.data.userId).toBe(fixtures.users.manager);
    expect(res.body.data.isSuperadmin).toBe(false);
    expect(res.body.data.totalPermissions).toBe(39);
    expect(res.body.data.allowedCount).toBeGreaterThan(0);
    expect(res.body.data.deniedCount).toBeGreaterThan(0);
  });

  it('manajer tanpa rbac.effective.inspect ditolak 403 pada inspeksi keputusan', async () => {
    const client = await loginAs(app, 'manager@test.local');
    const res = await asClient(app, client)
      .get('/api/rbac/diagnostics/effective-permissions')
      .expect(403);
    expect(res.body.error.details.missing).toContain('rbac.effective.inspect');
  });

  it('admin dengan rbac.effective.inspect menerima rantai keputusan lengkap', async () => {
    const client = await loginAs(app, 'admin@test.local');
    const res = await asClient(app, client)
      .get('/api/rbac/diagnostics/effective-permissions')
      .expect(200);
    expect(res.body.data.user.id).toBe(fixtures.users.admin);
    expect(res.body.data.decisions.length).toBe(39);
    expect(res.body.data.allowed).toContain('rbac.roles.manage');
    const decide = res.body.data.decisions.find(
      (d: { permission: string }) => d.permission === 'rbac.roles.manage',
    );
    expect(decide.allowed).toBe(true);
    expect(decide.reason).toBe('role_grant');
    expect(decide.chain.length).toBeGreaterThan(0);
    expect(decide.scope).toBe('global');
  });

  it('superadmin mendapat seluruh keputusan allow dengan alasan superadmin', async () => {
    const client = await loginAs(app, 'superadmin@test.local');
    const res = await asClient(app, client)
      .get('/api/rbac/diagnostics/effective-permissions')
      .expect(200);
    expect(res.body.data.allowed.length).toBe(39);
    const decide = res.body.data.decisions.find(
      (d: { permission: string }) => d.permission === 'rbac.policies.manage',
    );
    expect(decide.reason).toBe('superadmin');
  });


  it('logout dan logout-all tercatat di audit_events dengan severity benar', async () => {
    const logoutClient = await loginAs(app, 'staf@test.local');
    await asClient(app, logoutClient).post('/api/auth/logout').expect(200);
    const logoutAllClient = await loginAs(app, 'staf@test.local');
    await asClient(app, logoutAllClient).post('/api/auth/logout-all').expect(200);

    const rows = (await dataSource.query(
      `SELECT event_key, severity FROM audit_events
        WHERE event_key IN ('auth.logout', 'auth.logout_all')`,
    )) as { event_key: string; severity: string }[];
    expect(rows.some((r) => r.event_key === 'auth.logout')).toBe(true);
    const logoutRow = rows.find((r) => r.event_key === 'auth.logout');
    expect(logoutRow?.severity).toBe('info');
  });

  it('pengguna tidak dapat mencabut sesi milik pengguna lain (404)', async () => {
    const admin = await loginAs(app, 'admin@test.local');
    const adminSessions = await asClient(app, admin).get('/api/auth/sessions').expect(200);
    const adminSessionId = adminSessions.body.data[0].id as string;

    const staf = await loginAs(app, 'staf@test.local');
    const res = await asClient(app, staf)
      .delete(`/api/auth/sessions/${adminSessionId}`)
      .expect(404);
    expect(res.body.error.code).toBe(ERROR_CODES.notFound);

    await asClient(app, admin).get('/api/auth/me').expect(200);
  });

  it('pencabutan sesi sendiri berhasil dan tercatat dengan atribusi lengkap', async () => {
    const client = await loginAs(app, 'staf@test.local');
    const sessions = await asClient(app, client).get('/api/auth/sessions').expect(200);
    const ownSessionId = sessions.body.data[0].id as string;
    await request(app.getHttpServer())
      .delete(`/api/auth/sessions/${ownSessionId}`)
      .set('Cookie', client.cookies)
      .set('X-CSRF-Token', client.csrfToken)
      .set('User-Agent', 'e2e-kontributor/1.0')
      .expect(200);

    const rows = (await dataSource.query(
      `SELECT actor_ip, actor_user_agent, request_id, actor_user_id FROM audit_events
        WHERE event_key = 'auth.session.revoked'`,
    )) as { actor_ip: string | null; actor_user_agent: string | null; request_id: string | null; actor_user_id: string }[];
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.actor_user_id).toBe(fixtures.users.staf);
    expect(row.actor_user_agent).toBe('e2e-kontributor/1.0');
    expect(row.request_id).toBeTruthy();
  });

  it('id sesi tidak valid ditolak 404 (bukan 500)', async () => {
    const client = await loginAs(app, 'staf@test.local');
    const res = await asClient(app, client)
      .delete('/api/auth/sessions/bukan-uuid')
      .expect(404);
    expect(res.body.error.code).toBe(ERROR_CODES.notFound);
  });

  it('perubahan password tercatat di audit_events tanpa kredensial mentah', async () => {
    const client = await loginAs(app, 'staf@test.local');
    const api = asClient(app, client);
    await api
      .post('/api/auth/password', {
        currentPassword: TEST_PASSWORD,
        newPassword: 'AuditBaru123!',
      })
      .expect(200);

    const rows = (await dataSource.query(
      `SELECT event_key, severity, actor_user_id, actor_label, summary, payload
         FROM audit_events WHERE event_key = 'auth.password.changed'`,
    )) as {
      event_key: string;
      severity: string;
      actor_user_id: string;
      actor_label: string;
      summary: string;
      payload: Record<string, unknown>;
    }[];

    expect(rows.length).toBe(1);
    const event = rows[0]!;
    expect(event.severity).toBe('critical');
    expect(event.actor_user_id).toBe(fixtures.users.staf);
    expect(event.actor_label).toBe('staf@test.local');
    expect(event.summary).toContain('POST /api/auth/password');
    const serialized = JSON.stringify(event.payload);
    expect(serialized).not.toContain('AuditBaru123!');
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).toContain('[REDACTED]');
  });
});
