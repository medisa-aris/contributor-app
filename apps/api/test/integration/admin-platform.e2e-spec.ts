import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { ERROR_CODES } from '../../src/common/errors/app-error';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures, type TestFixtures } from './helpers/reset-db';
import { createTestApp } from './helpers/test-app';

describe('Admin platform (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixtures: TestFixtures;
  let admin: AuthedClient;
  let superadmin: AuthedClient;
  let navAppId: string;
  let navModuleId: string;

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

  it('staf tanpa audit.logs.read ditolak 403', async () => {
    const staf = await loginAs(app, 'staf@test.local');
    await asClient(app, staf).get('/api/admin/audit-events').expect(403);
  });

  it('log audit dapat difilter per event, severity, dan pencarian', async () => {
    const all = await asClient(app, admin).get('/api/admin/audit-events').expect(200);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(2);

    const login = await asClient(app, admin)
      .get('/api/admin/audit-events?eventKey=auth.login.success')
      .expect(200);
    expect(login.body.meta.total).toBeGreaterThanOrEqual(2);
    const first = (login.body.data as { event_key: string }[])[0];
    expect(first?.event_key).toBe('auth.login.success');

    const search = await asClient(app, admin)
      .get('/api/admin/audit-events?search=superadmin%40test.local')
      .expect(200);
    expect(search.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('admin mencabut sesi pengguna lain secara paksa', async () => {
    const manager = await loginAs(app, 'manager@test.local');
    const list = await asClient(app, admin)
      .get(`/api/admin/sessions?userId=${fixtures.users.manager}`)
      .expect(200);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);
    const target = (list.body.data as { id: string; email: string }[])[0];
    expect(target?.email).toBe('manager@test.local');

    const revoked = await asClient(app, admin)
      .delete(`/api/admin/sessions/${target?.id}`)
      .expect(200);
    expect(revoked.body.data.revoked).toBe(true);
    await asClient(app, manager).get('/api/auth/me').expect(401);

    const audit = await asClient(app, admin)
      .get('/api/admin/audit-events?eventKey=auth.session.revoked&severity=warn')
      .expect(200);
    expect(audit.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('staf tanpa security.sessions.manage ditolak 403', async () => {
    const staf = await loginAs(app, 'staf@test.local');
    await asClient(app, staf).get('/api/admin/sessions').expect(403);
  });

  it('konfigurasi publik dapat diakses tanpa sesi dengan nilai default', async () => {
    const res = await request(app.getHttpServer()).get('/api/config/public').expect(200);
    expect(res.body.data.appName).toBe('Contributor AI');
    expect(res.body.data.defaultLocale).toBe('id');
    expect(res.body.data.defaultTheme).toBe('system');
    expect(res.body.data.timezone).toBe('Asia/Jakarta');
    expect(res.body.data.showTokenUsage).toBe(true);
  });

  it('konfigurasi privat diubah dan tercatat; kunci tidak dikenal 404', async () => {
    await dataSource.query(
      `INSERT INTO app_config (key, value, description, is_public)
       VALUES ('security.test_knob', '1'::jsonb, 'Knob pengujian', false)`,
    );
    const updated = await asClient(app, admin)
      .put('/api/admin/config/security.test_knob', { value: 5 })
      .expect(200);
    expect(updated.body.data.value).toBe(5);

    const list = await asClient(app, admin).get('/api/admin/config').expect(200);
    const row = (list.body.data as { key: string; value: unknown; updated_by: string }[]).find(
      (r) => r.key === 'security.test_knob',
    );
    expect(row?.value).toBe(5);
    expect(row?.updated_by).toBe(fixtures.users.admin);

    const audit = await asClient(app, admin)
      .get('/api/admin/audit-events?eventKey=config.updated')
      .expect(200);
    expect(audit.body.meta.total).toBe(1);

    await asClient(app, admin)
      .put('/api/admin/config/tidak.ada', { value: 1 })
      .expect(404);
  });

  it('toggle tampilkan token diatur admin dan tercermin pada konfigurasi publik', async () => {
    const off = await asClient(app, admin)
      .put('/api/admin/config/ai.show_token_usage', { value: false })
      .expect(200);
    expect(off.body.data.value).toBe(false);

    const publicOff = await request(app.getHttpServer()).get('/api/config/public').expect(200);
    expect(publicOff.body.data.showTokenUsage).toBe(false);

    const on = await asClient(app, admin)
      .put('/api/admin/config/ai.show_token_usage', { value: true })
      .expect(200);
    expect(on.body.data.value).toBe(true);

    const publicOn = await request(app.getHttpServer()).get('/api/config/public').expect(200);
    expect(publicOn.body.data.showTokenUsage).toBe(true);
  });

  it('staf tidak dapat melihat maupun mengubah konfigurasi (403)', async () => {
    const staf = await loginAs(app, 'staf@test.local');
    await asClient(app, staf).get('/api/admin/config').expect(403);
    await asClient(app, staf)
      .put('/api/admin/config/security.test_knob', { value: 9 })
      .expect(403);
  });

  it('status provider tidak pernah membocorkan kredensial', async () => {
    const res = await asClient(app, admin).get('/api/admin/providers').expect(200);
    expect(res.body.data.defaultProvider).toBe('openrouter');
    const names = (res.body.data.providers as { name: string }[]).map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(['openrouter', 'ollama', 'openai', 'anthropic']),
    );
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('sk-');
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('api_key');
  });

  it('inspeksi permission efektif hanya untuk pemegang rbac.effective.inspect', async () => {
    const manager = await loginAs(app, 'manager@test.local');
    const blocked = await asClient(app, manager)
      .get(`/api/admin/diagnostics/users/${fixtures.users.staf}/effective-permissions`)
      .expect(403);
    expect(blocked.body.error.code).toBe(ERROR_CODES.forbidden);

    const res = await asClient(app, superadmin)
      .get(`/api/admin/diagnostics/users/${fixtures.users.staf}/effective-permissions`)
      .expect(200);
    expect(res.body.data.user.email).toBe('staf@test.local');
    expect((res.body.data.decisions as unknown[]).length).toBe(38);
  });

  it('uji otorisasi mengembalikan keputusan, scope, dan rantai', async () => {
    const res = await asClient(app, superadmin)
      .post('/api/admin/diagnostics/authz-test', {
        userId: fixtures.users.staf,
        permission: 'ai.workspace.access',
      })
      .expect(200);
    expect(res.body.data.allowed).toBe(true);
    expect(res.body.data.reason).toBe('role_grant');
    expect(res.body.data.scope).toBe('own');
    expect((res.body.data.chain as unknown[]).length).toBeGreaterThanOrEqual(1);

    const staf = await loginAs(app, 'staf@test.local');
    await asClient(app, staf)
      .post('/api/admin/diagnostics/authz-test', {
        userId: fixtures.users.staf,
        permission: 'ai.workspace.access',
      })
      .expect(403);
  });

  it('navigasi dinamis hanya menampilkan menu yang izinnya dimiliki', async () => {
    const appRows = (await dataSource.query(
      `INSERT INTO applications (identifier, name, sort_order)
       VALUES ('test-app', 'Aplikasi Uji', 1) RETURNING id`,
    )) as { id: string }[];
    navAppId = appRows[0]?.id as string;
    const moduleRows = (await dataSource.query(
      `INSERT INTO modules (application_id, identifier, name, sort_order)
       VALUES ($1, 'mod-a', 'Modul A', 1) RETURNING id`,
      [navAppId],
    )) as { id: string }[];
    navModuleId = moduleRows[0]?.id as string;
    await dataSource.query(
      `INSERT INTO menu_items (key, application_id, module_id, label_default, i18n_key,
                               route_path, required_permission, sort_order, is_future)
       VALUES
         ('test.item1', $1, $2, 'Item Satu', 'nav.test.item1', '/satu', 'ai.workspace.access', 1, false),
         ('test.item2', $1, $2, 'Item Dua', 'nav.test.item2', '/dua', 'rbac.roles.manage', 2, false),
         ('test.future', $1, $2, 'Item Masa Depan', 'nav.test.future', NULL, 'knowledge.search.use', 3, true)`,
      [navAppId, navModuleId],
    );

    const staf = await loginAs(app, 'staf@test.local');
    const stafNav = await asClient(app, staf).get('/api/navigation').expect(200);
    type NavApp = { identifier: string; modules: { items: { key: string; isFuture: boolean }[] }[] };
    const stafApps = stafNav.body.data as NavApp[];
    const testAppForStaf = stafApps.find((a) => a.identifier === 'test-app');
    expect(testAppForStaf).toBeDefined();
    const stafItems = testAppForStaf?.modules[0]?.items ?? [];
    expect(stafItems.map((i) => i.key)).toEqual(['nav.test.item1', 'nav.test.future']);
    expect(stafItems.find((i) => i.key === 'nav.test.future')?.isFuture).toBe(true);

    const adminNav = await asClient(app, admin).get('/api/navigation').expect(200);
    const adminApps = adminNav.body.data as NavApp[];
    const testAppForAdmin = adminApps.find((a) => a.identifier === 'test-app');
    expect(testAppForAdmin?.modules[0]?.items).toHaveLength(3);
  });

  it('staf tanpa nav.manage tidak dapat membuka tree admin (403)', async () => {
    const staf = await loginAs(app, 'staf@test.local');
    await asClient(app, staf).get('/api/admin/nav/tree').expect(403);
  });

  it('tree admin menampilkan seluruh level navigasi', async () => {
    const res = await asClient(app, admin).get('/api/admin/nav/tree').expect(200);
    expect((res.body.data.applications as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((res.body.data.modules as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.features).toBeDefined();
    expect((res.body.data.menuItems as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it('CRUD navigasi end-to-end dengan penjagaan dependensi', async () => {
    const createdApp = await asClient(app, admin)
      .post('/api/admin/nav/applications', { identifier: 'crud-app', name: 'CRUD App' })
      .expect(201);
    const crudAppId = createdApp.body.data.id as string;

    await asClient(app, admin)
      .post('/api/admin/nav/applications', { identifier: 'crud-app', name: 'Duplikat' })
      .expect(409);

    await asClient(app, admin)
      .patch(`/api/admin/nav/applications/${crudAppId}`, { name: 'CRUD App 2' })
      .expect(200);

    const createdModule = await asClient(app, admin)
      .post('/api/admin/nav/modules', {
        applicationId: crudAppId,
        identifier: 'crud-mod',
        name: 'Modul CRUD',
        sortOrder: 1,
      })
      .expect(201);
    const crudModuleId = createdModule.body.data.id as string;

    const blockedDelete = await asClient(app, admin)
      .delete(`/api/admin/nav/applications/${crudAppId}`)
      .expect(409);
    expect(blockedDelete.body.error.code).toBe(ERROR_CODES.conflict);

    const createdFeature = await asClient(app, admin)
      .post('/api/admin/nav/features', {
        moduleId: crudModuleId,
        identifier: 'crud-feat',
        name: 'Fitur CRUD',
      })
      .expect(201);
    const crudFeatureId = createdFeature.body.data.id as string;

    await asClient(app, admin)
      .post('/api/admin/nav/menu-items', {
        key: 'crud.unknown',
        applicationId: crudAppId,
        labelDefault: 'Izin Hantu',
        requiredPermission: 'tidak.ada.izin',
      })
      .expect(400);

    const createdItem = await asClient(app, admin)
      .post('/api/admin/nav/menu-items', {
        key: 'crud.item',
        applicationId: crudAppId,
        moduleId: crudModuleId,
        featureId: crudFeatureId,
        labelDefault: 'Item CRUD',
        i18nKey: 'nav.crud.item',
        routePath: '/crud',
        requiredPermission: 'ai.workspace.access',
        isFuture: true,
      })
      .expect(201);
    const crudItemId = createdItem.body.data.id as string;

    await asClient(app, admin)
      .patch(`/api/admin/nav/menu-items/${crudItemId}`, { routePath: '/crud/v2', isFuture: false })
      .expect(200);

    const reordered = await asClient(app, admin)
      .put('/api/admin/nav/reorder', {
        items: [
          { id: crudItemId, type: 'menu_item', sortOrder: 9 },
          { id: crudModuleId, type: 'module', sortOrder: 3 },
        ],
      })
      .expect(200);
    expect(reordered.body.data.updated).toBe(2);

    await asClient(app, admin)
      .put('/api/admin/nav/reorder', { items: [{ id: crudItemId, type: 'bogus', sortOrder: 1 }] })
      .expect(400);

    await asClient(app, admin)
      .delete(`/api/admin/nav/features/${crudFeatureId}`)
      .expect(409);
    await asClient(app, admin).delete(`/api/admin/nav/menu-items/${crudItemId}`).expect(200);
    await asClient(app, admin).delete(`/api/admin/nav/features/${crudFeatureId}`).expect(200);
    await asClient(app, admin).delete(`/api/admin/nav/modules/${crudModuleId}`).expect(200);
    await asClient(app, admin).delete(`/api/admin/nav/applications/${crudAppId}`).expect(200);
    await asClient(app, admin).delete(`/api/admin/nav/applications/${crudAppId}`).expect(404);

    const audit = await asClient(app, admin)
      .get('/api/admin/audit-events?eventKey=nav.application')
      .expect(200);
    expect(audit.body.meta.total).toBeGreaterThanOrEqual(2);
  });
});
