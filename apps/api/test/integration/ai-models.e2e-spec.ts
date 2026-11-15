import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DATA_SOURCE } from '../../src/database/database.module';
import { PROVIDER_ADAPTER_FACTORY } from '../../src/modules/ai/models/provider-registry.service';
import type { AiProviderAdapter, ChatRequestOptions, ChatResult } from '../../src/modules/ai/providers/types';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures, type TestFixtures } from './helpers/reset-db';

/** Model tanpa dukungan tools: adapter palsu tidak pernah memanggil alat untuknya. */
const NO_TOOLS_KEY = 'model-tanpa-tools';
const tokens = { in: 100, out: 100 };
const requests: ChatRequestOptions[] = [];

function reply(options: ChatRequestOptions): ChatResult {
  requests.push(options);
  const wantsPing = options.tools?.some((t) => t.name === 'ping') && options.model !== NO_TOOLS_KEY;
  return {
    content: wantsPing ? '' : 'Jawaban uji.',
    model: options.model,
    tokensIn: tokens.in,
    tokensOut: tokens.out,
    ...(wantsPing ? { toolCalls: [{ id: 'p1', name: 'ping', input: { value: 'ok' } }] } : {}),
  };
}

const adapter: AiProviderAdapter = {
  id: 'palsu',
  chat: (options) => Promise.resolve(reply(options)),
  stream: async function* (options) {
    yield 'Jawaban ';
    return reply(options);
  },
};

describe('Katalog model, izin, dan kuota (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixtures: TestFixtures;
  let admin: AuthedClient;
  let manager: AuthedClient;
  let memberA: AuthedClient;
  let memberB: AuthedClient;
  let memberA2: AuthedClient;
  let outsider: AuthedClient;
  let superadmin: AuthedClient;
  let ids: { a: string; b: string; a2: string };
  let defaultModelId: string;
  let sModelId: string;
  let premiumId: string;
  let noToolsId: string;

  async function addUser(email: string, name: string, departmentId: string): Promise<string> {
    const rows = (await dataSource.query(
      `INSERT INTO users (email, password_hash, display_name, department_id, status)
       SELECT $1, password_hash, $2, $3, 'active' FROM users WHERE email = 'staf@test.local'
       RETURNING id`,
      [email, name, departmentId],
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO user_roles (user_id, role_id, data_scope) VALUES ($1, $2, 'own')`,
      [rows[0]!.id, fixtures.roles.manager],
    );
    return rows[0]!.id;
  }

  async function addModel(provider: string, modelKey: string, extra: Record<string, unknown> = {}): Promise<string> {
    const created = await asClient(app, admin).post('/api/admin/ai/models', {
      items: [{ provider, modelKey, displayName: modelKey }],
    });
    expect(created.status).toBe(201);
    const id = created.body.data[0].id as string;
    if (Object.keys(extra).length > 0) {
      await asClient(app, admin).patch(`/api/admin/ai/models/${id}`, extra).expect(200);
    }
    await asClient(app, admin).post(`/api/admin/ai/models/${id}/test`, {}).expect(200);
    await asClient(app, admin).post(`/api/admin/ai/models/${id}/enable`).expect(200);
    return id;
  }

  function chat(client: AuthedClient, modelId?: string, prompt = 'Halo') {
    return asClient(app, client).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt,
      ...(modelId ? { modelId } : {}),
    });
  }

  async function grant(client: AuthedClient, body: Record<string, unknown>) {
    return asClient(app, client).post('/api/ai/model-grants', { period: 'day', tokenLimit: null, ...body });
  }

  async function modelsOf(client: AuthedClient) {
    const res = await asClient(app, client).get('/api/ai/models').expect(200);
    return res.body.data.models as { id: string; isDefault: boolean; unlimited: boolean; quotas: { period: string; limit: number }[] }[];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROVIDER_ADAPTER_FACTORY)
      .useValue(() => adapter)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get<DataSource>(DATA_SOURCE);
    await resetDatabase(dataSource);
    fixtures = await seedTestFixtures(dataSource);
    // Manajer = kepala departemen IT (jangkauan: IT dan sub-departemen IT - Data).
    await dataSource.query(`UPDATE departments SET head_user_id = $1 WHERE id = $2`, [
      fixtures.users.manager,
      fixtures.departments.it,
    ]);
    ids = {
      a: await addUser('a@test.local', 'Anggota A', fixtures.departments.it),
      b: await addUser('b@test.local', 'Anggota B', fixtures.departments.it),
      a2: await addUser('a2@test.local', 'Anggota A2', fixtures.departments.itData),
    };
    admin = await loginAs(app, 'admin@test.local');
    manager = await loginAs(app, 'manager@test.local');
    memberA = await loginAs(app, 'a@test.local');
    memberB = await loginAs(app, 'b@test.local');
    memberA2 = await loginAs(app, 'a2@test.local');
    outsider = await loginAs(app, 'managerhr@test.local');
    superadmin = await loginAs(app, 'superadmin@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    tokens.in = 100;
    tokens.out = 100;
  });

  it('migrasi mengisi model bawaan dari env tanpa izin apa pun; status penyedia tanpa kredensial', async () => {
    const models = await modelsOf(memberA);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ isDefault: true, unlimited: true });
    defaultModelId = models[0]!.id;
    const grants = (await dataSource.query(`SELECT count(*)::int AS n FROM ai_model_grants`)) as { n: number }[];
    expect(grants[0]!.n).toBe(0);

    const providers = await asClient(app, admin).get('/api/admin/ai/providers').expect(200);
    const raw = JSON.stringify(providers.body);
    expect(raw).not.toMatch(/apiKey|api_key|sk-/);
    expect((providers.body.data as { code: string }[]).map((p) => p.code).sort()).toEqual([
      'anthropic',
      'ollama',
      'openai',
      'openrouter',
    ]);
  });

  it('model baru wajib diuji sebelum aktif; uji mengisi kemampuan dan dicatat di ledger', async () => {
    const created = await asClient(app, admin).post('/api/admin/ai/models', {
      items: [{ provider: 'anthropic', modelKey: 'claude-uji', displayName: 'Claude Uji' }],
    });
    sModelId = created.body.data[0].id;
    const early = await asClient(app, admin).post(`/api/admin/ai/models/${sModelId}/enable`);
    expect(early.status).toBe(409);

    const tested = await asClient(app, admin).post(`/api/admin/ai/models/${sModelId}/test`, {}).expect(200);
    expect(tested.body.data.model).toMatchObject({ lastTestOk: true, supportsTools: true });
    const ledger = (await dataSource.query(
      `SELECT source, counts_toward_quota FROM ai_usage_ledger WHERE model_id = $1`,
      [sModelId],
    )) as { source: string; counts_toward_quota: boolean }[];
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.every((r) => r.source === 'model_test' && !r.counts_toward_quota)).toBe(true);
    await asClient(app, admin).post(`/api/admin/ai/models/${sModelId}/enable`).expect(200);

    premiumId = await addModel('anthropic', 'claude-premium', { leaderGrantable: false, costTier: 3 });
    noToolsId = await addModel('openai', NO_TOOLS_KEY);
  });

  it('model bawaan tidak dapat diberi izin dan tidak dapat dinonaktifkan', async () => {
    const res = await grant(admin, { targetType: 'user', targetId: ids.a, modelId: defaultModelId });
    expect(res.status).toBe(409);
    await asClient(app, admin).post(`/api/admin/ai/models/${defaultModelId}/disable`).expect(409);
  });

  it('tanpa izin, model aktif tetap tidak dapat dipakai', async () => {
    const res = await chat(memberA, sModelId);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AI_MODEL_NOT_ALLOWED');
    expect((await modelsOf(memberA)).map((m) => m.id)).toEqual([defaultModelId]);
  });

  it('leader memberi izin departemen; sub-departemen hanya bila diminta', async () => {
    const created = await grant(manager, {
      targetType: 'department',
      targetId: fixtures.departments.it,
      includeSubDepartments: false,
      modelId: sModelId,
      tokenLimit: 300,
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ grantedScope: 'leader', editable: true });
    expect((await modelsOf(memberA)).map((m) => m.id)).toContain(sModelId);
    expect((await modelsOf(memberB)).map((m) => m.id)).toContain(sModelId);
    expect((await modelsOf(memberA2)).map((m) => m.id)).not.toContain(sModelId);
    expect((await modelsOf(outsider)).map((m) => m.id)).not.toContain(sModelId);

    await asClient(app, manager)
      .patch(`/api/ai/model-grants/${created.body.data.id}`, { includeSubDepartments: true })
      .expect(200);
    expect((await modelsOf(memberA2)).map((m) => m.id)).toContain(sModelId);
  });

  it('izin leader tidak berlaku untuk pembuatnya sendiri (anggota departemen yang sama)', async () => {
    expect((await modelsOf(manager)).map((m) => m.id)).not.toContain(sModelId);
  });

  it('kuota harian ditegakkan sebelum panggilan; pesan memuat waktu reset', async () => {
    const before = requests.length;
    await chat(memberA, sModelId).expect(200); // terpakai 200
    await chat(memberA, sModelId).expect(200); // sisa 100 → terpakai 400
    const blocked = await chat(memberA, sModelId);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('AI_QUOTA_EXCEEDED');
    expect(blocked.body.error.details).toMatchObject({ period: 'day', limit: 300 });
    const resetsAt = new Date(blocked.body.error.details.resetsAt as string);
    // Reset tengah malam Asia/Jakarta = 17:00 UTC.
    expect(resetsAt.getUTCHours()).toBe(17);
    expect(requests.length - before).toBe(2);

    const conv = (await dataSource.query(
      `SELECT m.model_id FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = $1 AND m.role = 'assistant' ORDER BY m.id DESC LIMIT 1`,
      [ids.a],
    )) as { model_id: string }[];
    expect(conv[0]!.model_id).toBe(sModelId);
  });

  it('izin pribadi mengalahkan izin departemen; setingkat, batas terendah menang', async () => {
    await grant(manager, { targetType: 'user', targetId: ids.b, modelId: sModelId, tokenLimit: 3000 }).then((r) =>
      expect(r.status).toBe(201),
    );
    let effective = await asClient(app, manager).get(`/api/ai/model-grants/effective?userId=${ids.b}`).expect(200);
    let s = (effective.body.data as { id: string; quotas: { limit: number; sourceLabel: string }[] }[]).find(
      (m) => m.id === sModelId,
    )!;
    expect(s.quotas[0]!.limit).toBe(3000);
    expect(s.quotas[0]!.sourceLabel).toContain('Izin pribadi');

    await grant(admin, { targetType: 'user', targetId: ids.b, modelId: sModelId, tokenLimit: 2000 }).then((r) =>
      expect(r.status).toBe(201),
    );
    effective = await asClient(app, manager).get(`/api/ai/model-grants/effective?userId=${ids.b}`).expect(200);
    s = (effective.body.data as typeof s[]).find((m) => m.id === sModelId)!;
    expect(s.quotas[0]!.limit).toBe(2000);
  });

  it('leader ditolak di luar jangkauan, ke semua orang, ke diri sendiri, dan untuk model khusus admin', async () => {
    const cases: Record<string, unknown>[] = [
      { targetType: 'user', targetId: fixtures.users.managerHr, modelId: sModelId },
      { targetType: 'department', targetId: fixtures.departments.hr, modelId: sModelId },
      { targetType: 'everyone', targetId: null, modelId: sModelId },
      { targetType: 'user', targetId: fixtures.users.manager, modelId: sModelId },
      { targetType: 'user', targetId: ids.a, modelId: premiumId },
    ];
    for (const body of cases) {
      const res = await grant(manager, body);
      expect([403]).toContain(res.status);
    }
  });

  it('izin admin hanya dapat dibaca leader', async () => {
    const list = await asClient(app, manager).get('/api/ai/model-grants').expect(200);
    const adminRow = (list.body.data as { id: string; grantedScope: string; editable: boolean }[]).find(
      (g) => g.grantedScope === 'admin',
    )!;
    expect(adminRow.editable).toBe(false);
    await asClient(app, manager).patch(`/api/ai/model-grants/${adminRow.id}`, { tokenLimit: 1 }).expect(403);
  });

  it('model tanpa tools ditolak saat percakapan memerlukan alat', async () => {
    await grant(admin, { targetType: 'user', targetId: ids.a2, modelId: noToolsId }).then((r) => expect(r.status).toBe(201));
    const res = await chat(memberA2, noToolsId);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AI_MODEL_CAPABILITY_MISSING');
    expect(res.body.error.details.missing).toEqual(['tools']);
  });

  it('agent pribadi hanya boleh memakai model yang diizinkan bagi pemiliknya', async () => {
    const denied = await asClient(app, memberA).post('/api/ai/agents', {
      name: 'Agent Premium',
      instruction: 'Bantu saya.',
      modelId: premiumId,
    });
    expect(denied.status).toBe(403);
    const ok = await asClient(app, memberA).post('/api/ai/agents', {
      name: 'Agent Uji',
      instruction: 'Bantu saya.',
      modelId: sModelId,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.model_id).toBe(sModelId);
  });

  it('batas model bawaan: bawaan tanpa batas, dapat diatur, lalu dikembalikan', async () => {
    const initial = await asClient(app, admin).get('/api/admin/ai/default-model-limits').expect(200);
    expect(initial.body.data).toEqual({ tokenLimit: null, period: 'day', requestsPerMinute: null });

    await asClient(app, admin)
      .put('/api/admin/ai/default-model-limits', { tokenLimit: 250, period: 'day', requestsPerMinute: null })
      .expect(200);
    await chat(memberB).expect(200);
    await chat(memberB).expect(200);
    const blocked = await chat(memberB);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('AI_QUOTA_EXCEEDED');

    await asClient(app, admin)
      .put('/api/admin/ai/default-model-limits', { tokenLimit: null, period: 'day', requestsPerMinute: 2 })
      .expect(200);
    const rateLimited = await chat(memberB);
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.body.error.code).toBe('AI_RATE_LIMITED');

    await asClient(app, admin)
      .put('/api/admin/ai/default-model-limits', { tokenLimit: null, period: 'day', requestsPerMinute: null })
      .expect(200);
    await chat(memberB).expect(200);
  });

  it('ganti model di tengah percakapan; pesan menyimpan model masing-masing', async () => {
    const first = await chat(memberB, defaultModelId).expect(200);
    const conversationId = first.body.data.conversation.id as string;
    const second = await asClient(app, memberB)
      .post('/api/ai/chat', { mode: 'second_brain', prompt: 'Lanjut', conversationId, modelId: sModelId })
      .expect(200);
    expect(second.body.data.assistant.model_id).toBe(sModelId);
    expect(second.body.data.conversation.model_id).toBe(sModelId);
    const assistants = (second.body.data.conversation.messages as { role: string; model_id: string }[]).filter(
      (m) => m.role === 'assistant',
    );
    expect(assistants.map((m) => m.model_id)).toEqual([defaultModelId, sModelId]);
  });

  it('pergantian kepala departemen langsung mengubah jangkauan leader', async () => {
    await dataSource.query(`UPDATE departments SET head_user_id = $1 WHERE id = $2`, [
      fixtures.users.managerHr,
      fixtures.departments.it,
    ]);
    const reach = await asClient(app, manager).get('/api/ai/model-grants/reach').expect(200);
    expect(reach.body.data.users).toHaveLength(0);
    const res = await grant(manager, { targetType: 'user', targetId: ids.a, modelId: noToolsId });
    expect(res.status).toBe(403);
    await dataSource.query(`UPDATE departments SET head_user_id = $1 WHERE id = $2`, [
      fixtures.users.manager,
      fixtures.departments.it,
    ]);
  });

  it('pemakaian saya dan pemakaian tim (leader hanya melihat jangkauannya)', async () => {
    const mine = await asClient(app, memberA).get('/api/ai/usage/me').expect(200);
    const s = (mine.body.data as { modelId: string; today: number; week: number; quotas: unknown[] }[]).find(
      (row) => row.modelId === sModelId,
    )!;
    expect(s.today).toBeGreaterThanOrEqual(400);
    expect(s.week).toBeGreaterThanOrEqual(s.today);
    expect(s.quotas.length).toBeGreaterThan(0);

    const team = await asClient(app, manager).get('/api/ai/usage/team?period=day&groupBy=user').expect(200);
    const labels = (team.body.data.rows as { label: string; tokens: number }[]).map((r) => r.label);
    expect(labels).toContain('Anggota A');
    expect(labels).not.toContain('Manajer HR');
    const byModel = await asClient(app, admin).get('/api/ai/usage/team?period=week&groupBy=model').expect(200);
    expect((byModel.body.data.rows as { key: string }[]).map((r) => r.key)).toContain(sModelId);
    const staf = await loginAs(app, 'staf@test.local');
    await asClient(app, staf).get('/api/ai/usage/team?period=day&groupBy=user').expect(403);
  });

  it('superadmin memakai semua model aktif tanpa izin', async () => {
    const ids = (await modelsOf(superadmin)).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([defaultModelId, sModelId, premiumId]));
  });

  it('mengganti model bawaan membuka model baru untuk semua dan izin lamanya tidak berlaku', async () => {
    await asClient(app, admin).post(`/api/admin/ai/models/${sModelId}/default`, { confirm: false }).expect(400);
    await asClient(app, admin).post(`/api/admin/ai/models/${sModelId}/default`, { confirm: true }).expect(200);
    const outsiderModels = await modelsOf(outsider);
    expect(outsiderModels.map((m) => m.id)).toContain(sModelId);
    expect(outsiderModels.map((m) => m.id)).not.toContain(defaultModelId);
    const list = await asClient(app, admin).get('/api/ai/model-grants').expect(200);
    const onS = (list.body.data as { modelId: string; notApplicable: boolean }[]).filter((g) => g.modelId === sModelId);
    expect(onS.length).toBeGreaterThan(0);
    expect(onS.every((g) => g.notApplicable)).toBe(true);
  });
});
