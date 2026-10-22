import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ERROR_CODES } from '../../src/common/errors/app-error';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import {
  MANAGER_PERMISSIONS,
  resetDatabase,
  seedTestFixtures,
  type TestFixtures,
} from './helpers/reset-db';
import { createTestApp } from './helpers/test-app';

describe('Admin RBAC (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixtures: TestFixtures;
  let admin: AuthedClient;
  let superadmin: AuthedClient;
  let financeRoleId: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    await resetDatabase(dataSource);
    fixtures = await seedTestFixtures(dataSource);
    admin = await loginAs(app, 'admin@test.local');
    superadmin = await loginAs(app, 'superadmin@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  it('staf tanpa rbac.roles.read ditolak 403', async () => {
    const staf = await loginAs(app, 'staf@test.local');
    await asClient(app, staf).get('/api/admin/roles').expect(403);
  });

  it('daftar peran memuat ringkasan permission dan pemakaian', async () => {
    const res = await asClient(app, admin).get('/api/admin/roles').expect(200);
    const roles = res.body.data as { code: string; is_system: boolean; permission_count: number }[];
    expect(roles).toHaveLength(4);
    const administrator = roles.find((r) => r.code === 'administrator');
    expect(administrator?.is_system).toBe(true);
    expect(administrator?.permission_count).toBe(39);
    const hr = roles.find((r) => r.code === 'hr_admin');
    expect(hr?.is_system).toBe(false);
    expect(hr?.permission_count).toBe(4);
  });

  it('katalog permission berisi 39 identifier aktif', async () => {
    const res = await asClient(app, admin).get('/api/admin/permissions').expect(200);
    const items = res.body.data as { identifier: string; role_count: number }[];
    expect(items).toHaveLength(39);
    const adminAccess = items.find((i) => i.identifier === 'admin.access');
    expect(adminAccess?.role_count).toBeGreaterThanOrEqual(2);
  });

  it('membuat peran baru; kode ganda dan kode tidak valid ditolak', async () => {
    const res = await asClient(app, admin)
      .post('/api/admin/roles', { code: 'finance_viewer', name: 'Peninjau Keuangan' })
      .expect(201);
    financeRoleId = res.body.data.id as string;
    expect(res.body.data.code).toBe('finance_viewer');

    await asClient(app, admin)
      .post('/api/admin/roles', { code: 'finance_viewer', name: 'Duplikat' })
      .expect(409);
    await asClient(app, admin)
      .post('/api/admin/roles', { code: 'F!', name: 'Tidak Valid' })
      .expect(400);
  });

  it('peran sistem hanya dapat diubah superadmin', async () => {
    const blocked = await asClient(app, admin)
      .patch(`/api/admin/roles/${fixtures.roles.manager}`, { name: 'Manajer Operasi' })
      .expect(403);
    expect(blocked.body.error.code).toBe(ERROR_CODES.escalationBlocked);

    await asClient(app, superadmin)
      .patch(`/api/admin/roles/${fixtures.roles.manager}`, { name: 'Manajer Operasi' })
      .expect(200);
    await asClient(app, superadmin)
      .patch(`/api/admin/roles/${fixtures.roles.manager}`, { name: 'Manajer' })
      .expect(200);
  });

  it('peran administrator hanya dapat diubah permissionnya oleh superadmin', async () => {
    const res = await asClient(app, admin)
      .put(`/api/admin/roles/${fixtures.roles.administrator}/permissions`, {
        permissions: ['admin.access'],
      })
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.escalationBlocked);
    const audit = await asClient(app, admin)
      .get('/api/admin/audit-events?eventKey=security.privilege_escalation_blocked')
      .expect(200);
    expect(audit.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('permission tidak dikenal ditolak 400 saat mengganti permission peran', async () => {
    const res = await asClient(app, admin)
      .put(`/api/admin/roles/${financeRoleId}/permissions`, {
        permissions: ['knowledge.documents.read', 'foo.tidak.ada'],
      })
      .expect(400);
    expect(res.body.error.code).toBe(ERROR_CODES.validation);
    expect(res.body.error.details.unknown).toContain('foo.tidak.ada');
  });

  it('mengganti permission peran tersimpan dan tercatat di audit', async () => {
    const res = await asClient(app, admin)
      .put(`/api/admin/roles/${financeRoleId}/permissions`, {
        permissions: ['knowledge.documents.read', 'knowledge.search.use'],
      })
      .expect(200);
    const identifiers = [...(res.body.data.permissions as string[])].sort();
    expect(identifiers).toEqual(['knowledge.documents.read', 'knowledge.search.use']);

    const audit = await asClient(app, admin)
      .get('/api/admin/audit-events?eventKey=rbac.role.permissions_updated')
      .expect(200);
    expect(audit.body.meta.total).toBe(1);
  });

  it('perubahan peran langsung membatalkan cache izin sesi berjalan', async () => {
    const manager = await loginAs(app, 'manager@test.local');
    await asClient(app, manager).get('/api/admin/users').expect(200);

    await asClient(app, admin)
      .put(`/api/admin/roles/${fixtures.roles.manager}/permissions`, {
        permissions: MANAGER_PERMISSIONS.filter((p) => p !== 'rbac.users.read'),
      })
      .expect(200);
    await asClient(app, manager).get('/api/admin/users').expect(403);

    await asClient(app, admin)
      .put(`/api/admin/roles/${fixtures.roles.manager}/permissions`, {
        permissions: MANAGER_PERMISSIONS,
      })
      .expect(200);
    await asClient(app, manager).get('/api/admin/users').expect(200);
  });

  it('membuat grup; kode ganda ditolak 409', async () => {
    const res = await asClient(app, admin)
      .post('/api/admin/groups', {
        code: 'engineering',
        name: 'Engineering',
        description: 'Tim rekayasa',
      })
      .expect(201);
    expect(res.body.data.code).toBe('engineering');

    const list = await asClient(app, admin).get('/api/admin/groups').expect(200);
    const codes = (list.body.data as { code: string }[]).map((g) => g.code);
    expect(codes).toContain('engineering');

    await asClient(app, admin)
      .post('/api/admin/groups', { code: 'engineering', name: 'Duplikat' })
      .expect(409);
  });

  it('anggota grup diberi peran grup dan langsung mewarisi izinnya', async () => {
    const created = await asClient(app, admin)
      .post('/api/admin/users', {
        email: 'grouptest@test.local',
        displayName: 'Grup Test',
        password: 'GrupTest12345!',
        departmentId: fixtures.departments.hr,
      })
      .expect(201);
    const groupTest = await loginAs(app, 'grouptest@test.local', 'GrupTest12345!');
    await asClient(app, groupTest).get('/api/admin/users').expect(403);

    const groups = await asClient(app, admin).get('/api/admin/groups').expect(200);
    const groupId = (groups.body.data as { id: string; code: string }[]).find(
      (g) => g.code === 'engineering',
    )?.id as string;

    const added = await asClient(app, admin)
      .post(`/api/admin/groups/${groupId}/members`, {
        userIds: [created.body.data.id as string, fixtures.users.managerHr],
      })
      .expect(201);
    expect((added.body.data.members as unknown[]).length).toBe(2);

    const unknown = await asClient(app, admin)
      .post(`/api/admin/groups/${groupId}/members`, {
        userIds: ['00000000-0000-4000-8000-000000000000'],
      })
      .expect(400);
    expect(unknown.body.error.code).toBe(ERROR_CODES.validation);

    const granted = await asClient(app, admin)
      .post(`/api/admin/groups/${groupId}/roles`, {
        roleId: fixtures.roles.manager,
        dataScope: 'global',
      })
      .expect(201);
    const assignments = granted.body.data.roles as { id: string; roleCode: string }[];
    const assignment = assignments.find((r) => r.roleCode === 'manager');
    expect(assignment).toBeDefined();

    await asClient(app, groupTest).get('/api/admin/users').expect(200);
  });

  it('mengeluarkan anggota dan mencabut peran grup', async () => {
    const groups = await asClient(app, admin).get('/api/admin/groups').expect(200);
    const groupId = (groups.body.data as { id: string; code: string }[]).find(
      (g) => g.code === 'engineering',
    )?.id as string;
    const detail = await asClient(app, admin).get(`/api/admin/groups/${groupId}`).expect(200);
    const members = detail.body.data.members as { id: string; email: string }[];
    const member = members.find((m) => m.email === 'grouptest@test.local');
    const groupTest = await loginAs(app, 'grouptest@test.local', 'GrupTest12345!');

    await asClient(app, admin)
      .delete(`/api/admin/groups/${groupId}/members/${member?.id}`)
      .expect(200);
    await asClient(app, groupTest).get('/api/admin/users').expect(403);

    await asClient(app, admin)
      .post(`/api/admin/groups/${groupId}/members`, { userIds: [member?.id] })
      .expect(201);
    await asClient(app, groupTest).get('/api/admin/users').expect(200);

    const withRole = await asClient(app, admin).get(`/api/admin/groups/${groupId}`).expect(200);
    const assignment = (withRole.body.data.roles as { id: string; roleCode: string }[]).find(
      (r) => r.roleCode === 'manager',
    );
    await asClient(app, admin)
      .delete(`/api/admin/groups/${groupId}/roles/${assignment?.id}`)
      .expect(200);
    await asClient(app, groupTest).get('/api/admin/users').expect(403);
  });

  it('hrAdmin tidak dapat memberi peran administrator ke grup (403)', async () => {
    const hrClient = await loginAs(app, 'hradmin@test.local');
    const groups = await asClient(app, admin).get('/api/admin/groups').expect(200);
    const groupId = (groups.body.data as { id: string; code: string }[]).find(
      (g) => g.code === 'engineering',
    )?.id as string;
    const res = await asClient(app, hrClient)
      .post(`/api/admin/groups/${groupId}/roles`, {
        roleId: fixtures.roles.administrator,
        dataScope: 'global',
      })
      .expect(403);
    expect(res.body.error.code).toBe(ERROR_CODES.escalationBlocked);
  });

  it('grup dapat dihapus dan detailnya menjadi 404', async () => {
    const groups = await asClient(app, admin).get('/api/admin/groups').expect(200);
    const groupId = (groups.body.data as { id: string; code: string }[]).find(
      (g) => g.code === 'engineering',
    )?.id as string;
    await asClient(app, admin).delete(`/api/admin/groups/${groupId}`).expect(200);
    await asClient(app, admin).get(`/api/admin/groups/${groupId}`).expect(404);
  });

  it('pohon departemen memuat hierarki dan jumlah pengguna', async () => {
    const res = await asClient(app, admin).get('/api/admin/departments').expect(200);
    const roots = res.body.data as {
      id: string;
      name: string;
      user_count: number;
      children: { name: string }[];
    }[];
    const it = roots.find((d) => d.name === 'IT');
    expect(it?.user_count).toBe(4);
    expect(it?.children.map((c) => c.name)).toContain('IT - Data');
    expect(roots.map((d) => d.name)).toContain('HR');
  });

  it('membuat department, kode ganda ditolak, siklus induk ditolak', async () => {
    const created = await asClient(app, admin)
      .post('/api/admin/departments', {
        name: 'Keuangan',
        code: 'FIN',
        parentId: fixtures.departments.it,
      })
      .expect(201);
    const rootsAfterCreate = created.body.data as {
      name: string;
      children: { id: string; name: string }[];
    }[];
    const finId = rootsAfterCreate
      .find((d) => d.name === 'IT')
      ?.children.find((c) => c.name === 'Keuangan')?.id as string;
    expect(finId).toBeDefined();

    await asClient(app, admin)
      .post('/api/admin/departments', { name: 'Duplikat', code: 'FIN' })
      .expect(409);

    await asClient(app, admin)
      .patch(`/api/admin/departments/${finId}`, { parentId: fixtures.departments.itData })
      .expect(200);

    const cycle = await asClient(app, admin)
      .patch(`/api/admin/departments/${fixtures.departments.it}`, { parentId: finId })
      .expect(400);
    expect(cycle.body.error.code).toBe(ERROR_CODES.validation);

    const blocked = await asClient(app, admin)
      .delete(`/api/admin/departments/${fixtures.departments.it}`)
      .expect(409);
    expect(blocked.body.error.code).toBe(ERROR_CODES.conflict);

    await asClient(app, admin).delete(`/api/admin/departments/${finId}`).expect(200);
    const tree = await asClient(app, admin).get('/api/admin/departments').expect(200);
    expect((tree.body.data as { name: string }[]).map((d) => d.name)).not.toContain('Keuangan');
  });

  it('kebijakan deny menimpa grant peran pada uji otorisasi', async () => {
    const before = await asClient(app, admin)
      .post('/api/admin/diagnostics/authz-test', {
        userId: fixtures.users.staf,
        permission: 'ai.workspace.access',
      })
      .expect(200);
    expect(before.body.data.allowed).toBe(true);
    expect(before.body.data.reason).toBe('role_grant');

    const policy = await asClient(app, admin)
      .post('/api/admin/policies', {
        name: 'Blokir staf dari ruang kerja AI',
        effect: 'deny',
        subjectType: 'user',
        subjectId: fixtures.users.staf,
        permissionPattern: 'ai.workspace.access',
        priority: 10,
      })
      .expect(201);
    const policyId = policy.body.data.id as string;

    const denied = await asClient(app, admin)
      .post('/api/admin/diagnostics/authz-test', {
        userId: fixtures.users.staf,
        permission: 'ai.workspace.access',
      })
      .expect(200);
    expect(denied.body.data.allowed).toBe(false);
    expect(denied.body.data.reason).toBe('policy_deny');

    await asClient(app, admin).delete(`/api/admin/policies/${policyId}`).expect(200);
    const restored = await asClient(app, admin)
      .post('/api/admin/diagnostics/authz-test', {
        userId: fixtures.users.staf,
        permission: 'ai.workspace.access',
      })
      .expect(200);
    expect(restored.body.data.allowed).toBe(true);
  });

  it('kebijakan dengan subjek tidak dikenal ditolak 404', async () => {
    await asClient(app, admin)
      .post('/api/admin/policies', {
        name: 'Subjek hantu',
        effect: 'deny',
        subjectType: 'user',
        subjectId: '00000000-0000-4000-8000-000000000000',
        permissionPattern: 'ai.workspace.access',
      })
      .expect(404);
  });

  it('sinkronisasi katalog permission idempoten (0 baru)', async () => {
    const res = await asClient(app, admin).post('/api/admin/permissions/sync').expect(200);
    expect(res.body.data.added).toBe(0);
  });
});
