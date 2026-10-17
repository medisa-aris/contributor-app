import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { ERROR_CODES } from '../../src/common/errors/app-error';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import {
  resetDatabase,
  seedTestFixtures,
  TEST_PASSWORD,
  type TestFixtures,
} from './helpers/reset-db';
import { createTestApp } from './helpers/test-app';

describe('Admin users (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixtures: TestFixtures;
  let admin: AuthedClient;
  let superadmin: AuthedClient;
  let hrAdmin: AuthedClient;
  let createdUserId: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    await resetDatabase(dataSource);
    fixtures = await seedTestFixtures(dataSource);
    admin = await loginAs(app, 'admin@test.local');
    superadmin = await loginAs(app, 'superadmin@test.local');
    hrAdmin = await loginAs(app, 'hradmin@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  it('staf tanpa rbac.users.read ditolak 403', async () => {
    const staf = await loginAs(app, 'staf@test.local');
    const res = await asClient(app, staf).get('/api/admin/users').expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.forbidden);
    expect(res.body.error.details.missing).toContain('rbac.users.read');
  });

  it('admin melihat seluruh pengguna (7 akun)', async () => {
    const res = await asClient(app, admin).get('/api/admin/users').expect(200);
    expect(res.body.meta.total).toBe(7);
    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toContain('superadmin@test.local');
    expect(emails).toContain('hradmin@test.local');
  });

  it('manajer scope department hanya melihat pengguna subtree IT', async () => {
    const manager = await loginAs(app, 'manager@test.local');
    const res = await asClient(app, manager).get('/api/admin/users').expect(200);
    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toHaveLength(5);
    expect(emails).toContain('staf@test.local');
    expect(emails).not.toContain('managerhr@test.local');
    expect(emails).not.toContain('hradmin@test.local');
  });

  it('hrAdmin scope department hanya melihat pengguna HR', async () => {
    const res = await asClient(app, hrAdmin).get('/api/admin/users').expect(200);
    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toHaveLength(2);
    expect(emails.sort()).toEqual(['hradmin@test.local', 'managerhr@test.local']);
  });

  it('manajer tidak dapat membuka detail pengguna di luar scope (404)', async () => {
    const manager = await loginAs(app, 'manager@test.local');
    await asClient(app, manager)
      .get(`/api/admin/users/${fixtures.users.hrAdmin}`)
      .expect(404);
  });

  it('admin membuat pengguna baru; email ganda ditolak 409', async () => {
    const res = await asClient(app, admin)
      .post('/api/admin/users', {
        email: 'Baru@Test.Local',
        displayName: 'Pengguna Baru',
        password: 'BaruPass12345!',
        departmentId: fixtures.departments.itData,
      })
      .expect(201);
    expect(res.body.data.email).toBe('baru@test.local');
    createdUserId = res.body.data.id as string;
    expect(res.body.data.status).toBe('active');

    await asClient(app, admin)
      .post('/api/admin/users', {
        email: 'baru@test.local',
        displayName: 'Duplikat',
        password: 'BaruPass12345!',
      })
      .expect(409);
  });

  it('validasi input gagal menghasilkan 400', async () => {
    const res = await asClient(app, admin)
      .post('/api/admin/users', { email: 'bukan-email', displayName: 'x', password: 'pendek' })
      .expect(400);
    expect(res.body.error.code).toBe(ERROR_CODES.validation);
  });

  it('admin memperbarui displayName pengguna', async () => {
    const res = await asClient(app, admin)
      .patch(`/api/admin/users/${fixtures.users.staf}`, { displayName: 'Staf Diperbarui' })
      .expect(200);
    expect(res.body.data.display_name).toBe('Staf Diperbarui');
  });

  it('admin tidak dapat menonaktifkan akunnya sendiri (400)', async () => {
    const res = await asClient(app, admin)
      .patch(`/api/admin/users/${fixtures.users.admin}`, { status: 'disabled' })
      .expect(400);
    expect(res.body.error.code).toBe(ERROR_CODES.validation);
  });

  it('superadmin terakhir tidak dapat dicabut statusnya (403)', async () => {
    const res = await asClient(app, superadmin)
      .patch(`/api/admin/users/${fixtures.users.superadmin}`, { isSuperadmin: false })
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.escalationBlocked);
  });

  it('admin non-superadmin tidak dapat mengubah akun superadmin (403)', async () => {
    const res = await asClient(app, admin)
      .patch(`/api/admin/users/${fixtures.users.superadmin}`, { displayName: 'Hack' })
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.escalationBlocked);
  });

  it('admin non-superadmin tidak dapat memberi status superadmin (403)', async () => {
    const res = await asClient(app, admin)
      .patch(`/api/admin/users/${fixtures.users.staf}`, { isSuperadmin: true })
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.escalationBlocked);
  });

  it('superadmin dapat mengaktifkan dan menonaktifkan status superadmin pengguna lain', async () => {
    const granted = await asClient(app, superadmin)
      .patch(`/api/admin/users/${fixtures.users.admin}`, { isSuperadmin: true })
      .expect(200);
    expect(granted.body.data.is_superadmin).toBe(true);

    const revoked = await asClient(app, superadmin)
      .patch(`/api/admin/users/${fixtures.users.admin}`, { isSuperadmin: false })
      .expect(200);
    expect(revoked.body.data.is_superadmin).toBe(false);
  });

  it('menonaktifkan pengguna langsung mencabut sesi aktifnya', async () => {
    const baru = await loginAs(app, 'baru@test.local', 'BaruPass12345!');
    await asClient(app, baru).get('/api/auth/me').expect(200);
    await asClient(app, admin)
      .patch(`/api/admin/users/${createdUserId}`, { status: 'disabled' })
      .expect(200);
    await asClient(app, baru).get('/api/auth/me').expect(401);
  });

  it('reset kata sandi mencabut sesi dan mengganti kredensial', async () => {
    const staf = await loginAs(app, 'staf@test.local');
    const res = await asClient(app, admin)
      .post(`/api/admin/users/${fixtures.users.staf}/password`, {
        newPassword: 'Rahasia12345!',
      })
      .expect(200);
    expect(res.body.data.reset).toBe(true);
    await asClient(app, staf).get('/api/auth/me').expect(401);
    await loginAs(app, 'staf@test.local', 'Rahasia12345!');
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'staf@test.local', password: TEST_PASSWORD })
      .expect(401);
  });

  it('hrAdmin gagal memberi peran staf karena permission subset (403)', async () => {
    const res = await asClient(app, hrAdmin)
      .post(`/api/admin/users/${fixtures.users.staf}/roles`, {
        roleId: fixtures.roles.staf,
        dataScope: 'own',
      })
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.escalationBlocked);
    const codes = (res.body.error.details.violations as { code: string }[]).map((v) => v.code);
    expect(codes).toContain('permission_subset');
  });

  it('admin non-superadmin tidak dapat memberi peran administrator (403)', async () => {
    const res = await asClient(app, admin)
      .post(`/api/admin/users/${fixtures.users.staf}/roles`, {
        roleId: fixtures.roles.administrator,
        dataScope: 'global',
      })
      .expect(403);
    const codes = (res.body.error.details.violations as { code: string }[]).map((v) => v.code);
    expect(codes).toContain('system_role_requires_superadmin');
  });

  it('tidak boleh mengubah assignment role milik sendiri (403)', async () => {
    const res = await asClient(app, admin)
      .post(`/api/admin/users/${fixtures.users.admin}/roles`, {
        roleId: fixtures.roles.staf,
        dataScope: 'global',
      })
      .expect(403);
    const codes = (res.body.error.details.violations as { code: string }[]).map((v) => v.code);
    expect(codes).toContain('self_modification');
  });

  it('admin memberi peran manajer (scope department) lalu mencabutnya', async () => {
    const granted = await asClient(app, admin)
      .post(`/api/admin/users/${fixtures.users.staf}/roles`, {
        roleId: fixtures.roles.manager,
        dataScope: 'department',
        departmentId: fixtures.departments.it,
      })
      .expect(201);
    const assignments = granted.body.data.assignments as {
      id: string;
      roleCode: string;
      dataScope: string;
    }[];
    const managerAssignment = assignments.find((a) => a.roleCode === 'manager');
    expect(managerAssignment?.dataScope).toBe('department');

    const staf = await loginAs(app, 'staf@test.local', 'Rahasia12345!');
    await asClient(app, staf).get('/api/admin/users').expect(200);

    await asClient(app, admin)
      .delete(`/api/admin/users/${fixtures.users.staf}/roles/${managerAssignment?.id}`)
      .expect(200);
    await asClient(app, staf).get('/api/admin/users').expect(403);
  });

  it('percabutan assignment milik sendiri ditolak (403)', async () => {
    const detail = await asClient(app, admin)
      .get(`/api/admin/users/${fixtures.users.admin}`)
      .expect(200);
    const own = (detail.body.data.assignments as { id: string }[])[0];
    const res = await asClient(app, admin)
      .delete(`/api/admin/users/${fixtures.users.admin}/roles/${own?.id}`)
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.escalationBlocked);
  });

  it('jejak audit mencatat setiap blokir escalasi dan perubahan pengguna', async () => {
    const blocked = await asClient(app, admin)
      .get('/api/admin/audit-events?eventKey=security.privilege_escalation_blocked')
      .expect(200);
    expect(blocked.body.meta.total).toBeGreaterThanOrEqual(3);

    const updated = await asClient(app, admin)
      .get('/api/admin/audit-events?eventKey=user.updated')
      .expect(200);
    const summaries = (updated.body.data as { summary: string }[]).map((r) => r.summary);
    expect(summaries.some((s) => s.includes('staf@test.local'))).toBe(true);

    const reset = await asClient(app, admin)
      .get('/api/admin/audit-events?eventKey=auth.password.reset')
      .expect(200);
    expect(reset.body.meta.total).toBeGreaterThanOrEqual(1);
    expect((reset.body.data as { severity: string }[])[0]?.severity).toBe('warn');
  });
});
