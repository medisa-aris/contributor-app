import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { ERROR_CODES } from '../../src/common/errors/app-error';
import { asClient, loginAs } from './helpers/auth-as';
import {
  resetDatabase,
  seedTestFixtures,
  TEST_PASSWORD,
  type TestFixtures,
} from './helpers/reset-db';
import { createTestApp } from './helpers/test-app';

describe('Auth, sesi, dan CSRF (e2e)', () => {
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

  it('health dapat diakses tanpa sesi', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.database).toBe('up');
  });

  it('GET /api/auth/me tanpa sesi ditolak 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    expect(res.body.error.code).toBe(ERROR_CODES.unauthenticated);
  });

  it('login dengan kredensial salah ditolak 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'SalahSekali1!' })
      .expect(401);
    expect(res.body.error.code).toBe(ERROR_CODES.invalidCredentials);
  });

  it('login admin berhasil: cookie sesi + csrf, permission efektif terisi', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: TEST_PASSWORD })
      .expect(200);

    const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const names = setCookie.map((c) => c.split('=')[0]);
    expect(names).toEqual(expect.arrayContaining(['ca_session', 'ca_csrf']));

    const sessionCookie = setCookie.find((c) => c.startsWith('ca_session=')) ?? '';
    const csrfCookie = setCookie.find((c) => c.startsWith('ca_csrf=')) ?? '';
    expect(sessionCookie).toContain('HttpOnly');
    expect(csrfCookie).not.toContain('HttpOnly');

    const data = res.body.data;
    expect(data.user.email).toBe('admin@test.local');
    expect(data.user.isSuperadmin).toBe(false);
    expect(data.user.id).toBe(fixtures.users.admin);
    expect(typeof data.csrfToken).toBe('string');
    expect(data.csrfToken.length).toBeGreaterThan(20);
    expect(data.permissions).toEqual(
      expect.arrayContaining(['rbac.users.manage', 'rbac.roles.manage', 'ai.workspace.access']),
    );
  });

  it('manajer hanya menerima permission sesuai rolenya via /auth/me', async () => {
    const client = await loginAs(app, 'manager@test.local');
    const me = await asClient(app, client).get('/api/auth/me').expect(200);
    expect(me.body.data.permissions).toContain('ai.workspace.access');
    expect(me.body.data.permissions).toContain('rbac.users.read');
    expect(me.body.data.permissions).not.toContain('rbac.roles.manage');
    expect(me.body.data.permissions).not.toContain('rbac.users.manage');
    expect(me.body.data.user.departmentName).toBe('IT');
  });

  it('superadmin mendapat bypass penuh pada permission efektif', async () => {
    const client = await loginAs(app, 'superadmin@test.local');
    const me = await asClient(app, client).get('/api/auth/me').expect(200);
    expect(me.body.data.user.isSuperadmin).toBe(true);
    expect(me.body.data.permissions).toContain('rbac.roles.manage');
    expect(me.body.data.permissions).toContain('rbac.policies.manage');
  });

  it('POST tanpa header CSRF ditolak 403', async () => {
    const client = await loginAs(app, 'staf@test.local');
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', client.cookies)
      .send({})
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.csrfInvalid);
  });

  it('logout mencabut sesi sehingga /auth/me berikutnya 401', async () => {
    const client = await loginAs(app, 'staf@test.local');
    const api = asClient(app, client);
    const logout = await api.post('/api/auth/logout').expect(200);
    expect(logout.body.data.loggedOut).toBe(true);
    const me = await api.get('/api/auth/me').expect(401);
    expect(me.body.error.code).toBe(ERROR_CODES.unauthenticated);
  });

  it('logout-all mencabut seluruh sesi pengguna', async () => {
    const first = await loginAs(app, 'staf@test.local');
    const second = await loginAs(app, 'staf@test.local');
    await asClient(app, second).post('/api/auth/logout-all').expect(200);
    const meFirst = await asClient(app, first).get('/api/auth/me').expect(401);
    expect(meFirst.body.error.code).toBe(ERROR_CODES.unauthenticated);
    const meSecond = await asClient(app, second).get('/api/auth/me').expect(401);
    expect(meSecond.body.error.code).toBe(ERROR_CODES.unauthenticated);
  });

  it('PATCH /auth/profile memperbarui preferensi tema dan locale', async () => {
    const client = await loginAs(app, 'manager@test.local');
    const api = asClient(app, client);
    const res = await api
      .patch('/api/auth/profile', { theme: 'dark', locale: 'id' })
      .expect(200);
    expect(res.body.data.preferences.theme).toBe('dark');
    const me = await api.get('/api/auth/me').expect(200);
    expect(me.body.data.preferences.theme).toBe('dark');
  });

  it('ganti password: sesi lama dicabut dan login memakai password baru', async () => {
    const client = await loginAs(app, 'manager@test.local');
    const api = asClient(app, client);
    await api
      .post('/api/auth/password', {
        currentPassword: TEST_PASSWORD,
        newPassword: 'GantiBaru123!',
      })
      .expect(200);
    await api.get('/api/auth/me').expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'manager@test.local', password: TEST_PASSWORD })
      .expect(401);

    const reLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'manager@test.local', password: 'GantiBaru123!' })
      .expect(200);
    expect(reLogin.body.data.user.email).toBe('manager@test.local');
  });

  it('GET /auth/sessions menandai sesi saat ini', async () => {
    const client = await loginAs(app, 'admin@test.local');
    const res = await asClient(app, client).get('/api/auth/sessions').expect(200);
    const sessions = res.body.data as { id: string; current: boolean }[];
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.filter((s) => s.current).length).toBe(1);
  });

  it('akun nonaktif tidak dapat login (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'disabled@test.local', password: TEST_PASSWORD })
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.accountDisabled);
  });

  it('5 kegagalan login berturut-turut mengunci akun (423)', async () => {
    const email = 'staf@test.local';
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'SalahTerus1!' })
        .expect(401);
    }
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(423);
    expect(res.body.error.code).toBe(ERROR_CODES.accountLocked);
  });
});
