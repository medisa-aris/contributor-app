import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DATA_SOURCE } from '../../src/database/database.module';
import { AiGatewayService } from '../../src/modules/ai/gateway.service';
import { GuardedProvider } from '../../src/modules/ai/guardrails/guarded-provider';
import { GuardrailsService } from '../../src/modules/ai/guardrails/guardrails.service';
import type {
  AiProviderAdapter,
  ChatRequestOptions,
  ChatResult,
} from '../../src/modules/ai/providers/types';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures } from './helpers/reset-db';

const EMAIL_TOKEN = /[A-Z0-9]{4}[0-9a-f]{12}@[A-Z0-9]{4}[0-9a-f]{12}\.com/;
const PROMPT = 'nama,email\nMedisa Aris,medisa@gmail.com\nTolong rapikan.';

describe('Guardrails (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: AuthedClient;
  let manager: AuthedClient;
  const sent: ChatRequestOptions[] = [];

  const reply = (options: ChatRequestOptions): ChatResult => {
    sent.push(options);
    const text = options.messages.map((m) => m.content).join('\n');
    const token = EMAIL_TOKEN.exec(text)?.[0] ?? 'tidak ada';
    return { content: `Tersimpan: ${token}`, model: 'model-uji', tokensIn: 1, tokensOut: 1 };
  };
  const adapter: AiProviderAdapter = {
    id: 'mock',
    chat: async (options) => reply(options),
    async *stream(options) {
      const result = reply(options);
      for (let i = 0; i < result.content.length; i += 7) yield result.content.slice(i, i + 7);
      return result;
    },
  };

  const settings = (enabled: boolean) => ({
    enabled,
    blockImages: true,
    categories: ['full_name', 'email'],
    terms: [],
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiGatewayService)
      .useFactory({
        factory: (config: ConfigService, guardrails: GuardrailsService) => {
          const gateway = new AiGatewayService(config, guardrails);
          (gateway as unknown as { adapter: AiProviderAdapter }).adapter = new GuardedProvider(
            adapter,
            guardrails,
          );
          return gateway;
        },
        inject: [ConfigService, GuardrailsService],
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    (app.get(GuardrailsService) as unknown as { secretKey: () => Buffer }).secretKey = () =>
      Buffer.alloc(32, 3);
    dataSource = app.get<DataSource>(DATA_SOURCE);
    await resetDatabase(dataSource);
    await seedTestFixtures(dataSource);
    admin = await loginAs(app, 'admin@test.local');
    manager = await loginAs(app, 'manager@test.local');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it('hanya pemilik izin yang bisa membaca dan mengubah', async () => {
    expect((await asClient(app, manager).get('/api/admin/guardrails')).status).toBe(403);
    expect((await asClient(app, manager).put('/api/admin/guardrails', settings(true))).status).toBe(403);
    const res = await asClient(app, admin).get('/api/admin/guardrails');
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
    expect(res.body.data.keyConfigured).toBe(true);
  });

  it('endpoint konfigurasi umum tidak bisa melewati izin khusus', async () => {
    await asClient(app, admin).put('/api/admin/guardrails', settings(false));
    const put = await asClient(app, admin).put('/api/admin/config/ai.guardrails_enabled', { value: true });
    expect(put.status).toBe(403);
    const list = await asClient(app, admin).get('/api/admin/config');
    expect(JSON.stringify(list.body)).not.toContain('ai.guardrails_');
  });

  it('nonaktif: data dikirim apa adanya', async () => {
    await asClient(app, admin).put('/api/admin/guardrails', settings(false));
    await asClient(app, admin).post('/api/ai/chat', { mode: 'second_brain', prompt: PROMPT });
    expect(JSON.stringify(sent)).toContain('medisa@gmail.com');
    const last = (await dataSource.query(
      `SELECT guardrails FROM conversation_messages WHERE role = 'assistant' ORDER BY id DESC LIMIT 1`,
    )) as { guardrails: unknown }[];
    expect(last[0]!.guardrails).toBeNull();
  });

  it('aktif: LLM hanya melihat token, DB dan respons berisi data asli', async () => {
    await asClient(app, admin).put('/api/admin/guardrails', settings(true));
    const res = await asClient(app, admin).post('/api/ai/chat', { mode: 'second_brain', prompt: PROMPT });
    expect(res.status).toBe(200);
    expect(JSON.stringify(sent)).not.toMatch(/Medisa|medisa|gmail/);
    expect(res.body.data.assistant.content).toBe('Tersimpan: medisa@gmail.com');
    expect(res.body.data.assistant.guardrails).toMatchObject({ email: 1 });
    expect(res.body.data.assistant.guardrails.full_name).toBeGreaterThan(0);

    const id = res.body.data.conversation.id as string;
    const detail = await asClient(app, admin).get(`/api/ai/conversations/${id}`);
    expect(detail.body.data.messages[1].guardrails).toEqual(res.body.data.assistant.guardrails);
    expect(detail.body.data.messages[0].guardrails).toBeNull();
    const stored = (await dataSource.query(
      `SELECT content FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at`,
      [id],
    )) as { content: string }[];
    expect(stored[0]!.content).toContain('medisa@gmail.com');
    expect(stored[1]!.content).toBe('Tersimpan: medisa@gmail.com');

    const terms = (await dataSource.query(
      `SELECT token, value_encrypted, category FROM guardrail_terms WHERE conversation_id = $1`,
      [id],
    )) as { value_encrypted: string; category: string }[];
    expect(terms.length).toBeGreaterThan(0);
    expect(JSON.stringify(terms)).not.toContain('Medisa');

    // Giliran berikutnya: nama dari kamus tertutup walau tidak lagi berada di kolom.
    sent.length = 0;
    await asClient(app, admin).post('/api/ai/chat', {
      mode: 'second_brain',
      conversationId: id,
      prompt: 'Medisa Aris sudah setuju',
    });
    expect(JSON.stringify(sent)).not.toMatch(/Medisa|gmail/);

    const audit = (await dataSource.query(
      `SELECT payload::text AS payload FROM audit_events WHERE event_key = 'ai.guardrails.applied'`,
    )) as { payload: string }[];
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toMatch(/Medisa|medisa@/);

    await asClient(app, admin).delete(`/api/ai/conversations/${id}`);
    const left = (await dataSource.query(
      `SELECT count(*)::int AS n FROM guardrail_terms WHERE conversation_id = $1`,
      [id],
    )) as { n: number }[];
    expect(left[0]!.n).toBe(0);
  });

  it('stream: delta ke klien berisi data asli', async () => {
    await asClient(app, admin).put('/api/admin/guardrails', settings(true));
    const res = await asClient(app, admin).post('/api/ai/chat/stream', {
      mode: 'second_brain',
      prompt: PROMPT,
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(sent)).not.toMatch(/Medisa|gmail/);
    const text = [...res.text.matchAll(/event: delta\ndata: (.+)\n/g)]
      .map((m) => (JSON.parse(m[1]!) as { text: string }).text)
      .join('');
    expect(text).toBe('Tersimpan: medisa@gmail.com');
  });
});
