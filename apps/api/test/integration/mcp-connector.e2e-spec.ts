import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { DataSource } from 'typeorm';
import { z } from 'zod';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DATA_SOURCE } from '../../src/database/database.module';
import { AiGatewayService } from '../../src/modules/ai/gateway.service';
import type {
  AiProviderAdapter,
  ChatRequestOptions,
  ChatResult,
} from '../../src/modules/ai/providers/types';
import { asClient, loginAs, type AuthedClient } from './helpers/auth-as';
import { resetDatabase, seedTestFixtures, type TestFixtures } from './helpers/reset-db';

/**
 * Klien MCP end-to-end terhadap server MCP lokal (Streamable HTTP, SDK resmi):
 * sinkronisasi tool, grant, tool read-only langsung jalan, tool lain butuh persetujuan.
 */
describe('Konektor MCP (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixtures: TestFixtures;
  let admin: AuthedClient;
  let manager: AuthedClient;
  let mcpHttp: Server;
  let serverId: string;
  const tickets: string[] = [];
  const replies: ChatResult[] = [];
  const requests: ChatRequestOptions[] = [];

  function buildMcp(): McpServer {
    const mcp = new McpServer({ name: 'uji-hse', version: '1.0.0' });
    mcp.registerTool(
      'hitung_insiden',
      {
        title: 'Hitung insiden',
        description: 'Jumlah insiden per lokasi',
        inputSchema: { lokasi: z.string() },
        annotations: { readOnlyHint: true },
      },
      ({ lokasi }) => ({ content: [{ type: 'text', text: `Lokasi ${lokasi}: 7 insiden` }] }),
    );
    mcp.registerTool(
      'buat_tiket',
      { description: 'Membuat tiket tindak lanjut', inputSchema: { judul: z.string() } },
      ({ judul }) => {
        tickets.push(judul);
        return { content: [{ type: 'text', text: `Tiket "${judul}" dibuat` }] };
      },
    );
    return mcp;
  }

  const adapter: AiProviderAdapter = {
    id: 'tiruan',
    chat: (options) => {
      requests.push({ ...options, messages: [...options.messages] });
      const next = replies.shift();
      return next ? Promise.resolve(next) : Promise.reject(new Error('Balasan tiruan habis'));
    },
    // eslint-disable-next-line require-yield
    stream: async function* () {
      throw new Error('tidak dipakai');
    },
  };
  const reply = (content: string, toolCalls?: ChatResult['toolCalls']): ChatResult => ({
    content,
    model: 'model-uji',
    tokensIn: 1,
    tokensOut: 1,
    ...(toolCalls ? { toolCalls } : {}),
  });

  beforeAll(async () => {
    // Server MCP stateless: satu transport per permintaan.
    mcpHttp = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const mcp = buildMcp();
        res.on('close', () => {
          void transport.close();
          void mcp.close();
        });
        void mcp
          .connect(transport)
          .then(() =>
            transport.handleRequest(req, res, body ? (JSON.parse(body) as unknown) : undefined),
          );
      });
    });
    await new Promise<void>((resolve) => mcpHttp.listen(0, '127.0.0.1', resolve));
    const port = (mcpHttp.address() as AddressInfo).port;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiGatewayService)
      .useFactory({
        factory: (config: ConfigService) => {
          const gateway = new AiGatewayService(config);
          (gateway as unknown as { adapter: AiProviderAdapter }).adapter = adapter;
          return gateway;
        },
        inject: [ConfigService],
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get<DataSource>(DATA_SOURCE);
    await resetDatabase(dataSource);
    fixtures = await seedTestFixtures(dataSource);
    const rows = (await dataSource.query(
      `INSERT INTO mcp_servers (code, name, base_url, auth_type) VALUES ('uji-mcp', 'MCP Uji', $1, 'none') RETURNING id`,
      [`http://127.0.0.1:${port}/mcp`],
    )) as { id: string }[];
    serverId = rows[0]!.id;
    admin = await loginAs(app, 'admin@test.local');
    manager = await loginAs(app, 'manager@test.local');
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => mcpHttp.close(() => resolve()));
  });

  beforeEach(() => {
    replies.length = 0;
    requests.length = 0;
  });

  it('admin menyinkronkan tool; kebijakan bawaan mengikuti anotasi read-only', async () => {
    const res = await asClient(app, admin).post(
      `/api/integrations/mcp-servers/${serverId}/tools/sync`,
    );
    expect(res.status).toBe(201);
    const names = (res.body.data.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
    expect(names).toEqual(['buat_tiket', 'hitung_insiden']);
  });

  it('grant baca: hanya tool read-only yang ditawarkan ke model', async () => {
    await asClient(app, admin).post(`/api/integrations/connectors/mcp/${serverId}/grants`, {
      subjectType: 'user',
      subjectId: fixtures.users.manager,
      access: 'read',
    });
    const draft = await asClient(app, manager).post('/api/ai/conversations', {
      mode: 'second_brain',
    });
    const conversationId = draft.body.data.id as string;
    await asClient(app, manager).put(`/api/ai/conversations/${conversationId}/connectors`, {
      connectors: [{ connectorType: 'mcp', connectorId: serverId, access: 'read_write' }],
    });
    replies.push(
      reply('', [{ id: 'm1', name: 'mcp_uji_mcp__hitung_insiden', input: { lokasi: 'Pit A' } }]),
      reply('Pit A punya 7 insiden.'),
    );
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Berapa insiden di Pit A?',
      conversationId,
    });
    expect(res.status).toBe(200);
    expect(requests[0]!.tools?.map((t) => t.name)).toContain('mcp_uji_mcp__hitung_insiden');
    expect(requests[0]!.tools?.map((t) => t.name)).not.toContain('mcp_uji_mcp__buat_tiket');
    expect(res.body.data.assistant.tool_trace.steps[0]).toMatchObject({
      status: 'ok',
      source: 'MCP Uji',
    });
    expect(requests[1]!.messages.at(-1)!.content).toContain('7 insiden');
  });

  it('grant baca-tulis: tool tanpa anotasi read-only menunggu persetujuan lalu dijalankan', async () => {
    await asClient(app, admin).post(`/api/integrations/connectors/mcp/${serverId}/grants`, {
      subjectType: 'user',
      subjectId: fixtures.users.manager,
      access: 'read_write',
    });
    const draft = await asClient(app, manager).post('/api/ai/conversations', {
      mode: 'second_brain',
    });
    const conversationId = draft.body.data.id as string;
    await asClient(app, manager).put(`/api/ai/conversations/${conversationId}/connectors`, {
      connectors: [{ connectorType: 'mcp', connectorId: serverId, access: 'read_write' }],
    });
    replies.push(
      reply('Saya buatkan tiket.', [
        { id: 't1', name: 'mcp_uji_mcp__buat_tiket', input: { judul: 'Perbaiki rambu' } },
      ]),
    );
    const res = await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Buat tiket perbaikan rambu',
      conversationId,
    });
    const step = res.body.data.assistant.tool_trace.steps[0];
    expect(step.status).toBe('pending_approval');
    expect(tickets).toEqual([]);

    replies.push(reply('Tiket sudah dibuat.'));
    const decided = await asClient(app, manager).post(
      `/api/ai/conversations/${conversationId}/tool-approvals/${step.approvalId}/decide`,
      { decision: 'approved' },
    );
    expect(decided.status).toBe(200);
    expect(tickets).toEqual(['Perbaiki rambu']);
    expect(decided.body.data.messages.at(-1).tool_trace.steps[0].status).toBe('approved');
  });

  it('admin menonaktifkan tool lewat kebijakan', async () => {
    const res = await asClient(app, admin).put(
      `/api/integrations/mcp-servers/${serverId}/tools/policies`,
      {
        policies: {
          buat_tiket: { enabled: false, approval: true },
          hitung_insiden: { enabled: true, approval: false },
        },
      },
    );
    expect(res.status).toBe(200);
    const draft = await asClient(app, manager).post('/api/ai/conversations', {
      mode: 'second_brain',
    });
    const conversationId = draft.body.data.id as string;
    await asClient(app, manager).put(`/api/ai/conversations/${conversationId}/connectors`, {
      connectors: [{ connectorType: 'mcp', connectorId: serverId, access: 'read_write' }],
    });
    replies.push(reply('Oke.'));
    await asClient(app, manager).post('/api/ai/chat', {
      mode: 'second_brain',
      prompt: 'Halo',
      conversationId,
    });
    expect(requests[0]!.tools?.map((t) => t.name)).not.toContain('mcp_uji_mcp__buat_tiket');
  });
});
