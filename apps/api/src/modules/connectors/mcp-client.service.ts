import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { McpOauthService } from '../integrations/mcp-oauth.service';

/** Tool MCP sebagaimana dikembalikan tools/list (disederhanakan). */
export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** Kebijakan admin per tool. */
export interface McpToolPolicy {
  enabled: boolean;
  /** true: setiap pemanggilan menunggu persetujuan manusia (diperlakukan sebagai operasi tulis). */
  approval: boolean;
}

export interface McpServerToolsRow {
  id: string;
  code: string;
  name: string;
  base_url: string;
  auth_type: 'none' | 'api_key' | 'oauth';
  api_key_env: string | null;
  enabled: boolean;
  tools_cache: McpToolInfo[];
  tools_synced_at: string | null;
  tool_policies: Record<string, McpToolPolicy>;
}

export interface McpCallResult {
  isError: boolean;
  text: string;
  raw: unknown;
}

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 60_000;

/**
 * Kebijakan bawaan bila admin belum mengatur: tool aktif; butuh persetujuan kecuali server
 * menandainya read-only (`readOnlyHint: true`).
 */
export function defaultToolPolicy(tool: McpToolInfo): McpToolPolicy {
  return { enabled: true, approval: tool.annotations?.readOnlyHint !== true };
}

export function effectiveToolPolicy(
  row: Pick<McpServerToolsRow, 'tool_policies'>,
  tool: McpToolInfo,
): McpToolPolicy {
  return row.tool_policies?.[tool.name] ?? defaultToolPolicy(tool);
}

/** Gabungkan isi hasil tools/call menjadi teks untuk model. */
export function mcpContentToText(content: unknown): string {
  if (!Array.isArray(content))
    return typeof content === 'string' ? content : JSON.stringify(content ?? '');
  return content
    .map(
      (part: {
        type?: string;
        text?: string;
        resource?: { text?: string; uri?: string };
        mimeType?: string;
      }) => {
        if (part.type === 'text') return part.text ?? '';
        if (part.type === 'resource')
          return part.resource?.text ?? `[resource ${part.resource?.uri ?? ''}]`;
        if (part.type === 'image' || part.type === 'audio')
          return `[${part.type} ${part.mimeType ?? ''} tidak ditampilkan]`;
        return JSON.stringify(part);
      },
    )
    .join('\n');
}

/**
 * Klien MCP (Streamable HTTP, fallback SSE) memakai @modelcontextprotocol/sdk.
 * Koneksi dibuat per operasi agar kredensial selalu segar dan tidak ada sesi menggantung.
 */
@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly oauth: McpOauthService,
  ) {}

  async server(serverId: string): Promise<McpServerToolsRow> {
    const rows = (await this.dataSource.query(
      `SELECT id, code, name, base_url, auth_type, api_key_env, enabled, tools_cache, tools_synced_at, tool_policies
         FROM mcp_servers WHERE id = $1`,
      [serverId],
    )) as McpServerToolsRow[];
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Server MCP tidak ditemukan.', 404);
    return rows[0];
  }

  private async headers(server: McpServerToolsRow): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'User-Agent': 'ContributorAI-MCP/1.0' };
    if (server.auth_type === 'oauth') {
      const token = await this.oauth.getAccessToken(server.id);
      if (!token) {
        throw new AppError(
          ERROR_CODES.validation,
          `Server MCP "${server.name}" belum terhubung lewat OAuth atau tokennya kedaluwarsa. Admin perlu menekan "Hubungkan".`,
          409,
        );
      }
      headers.Authorization = `Bearer ${token}`;
    } else if (server.auth_type === 'api_key' && server.api_key_env) {
      const key = process.env[server.api_key_env];
      if (!key) {
        throw new AppError(
          ERROR_CODES.validation,
          `Variabel lingkungan ${server.api_key_env} belum diatur di server.`,
          409,
        );
      }
      headers.Authorization = `Bearer ${key}`;
    }
    return headers;
  }

  private async withClient<T>(
    server: McpServerToolsRow,
    fn: (client: McpSdkClient) => Promise<T>,
  ): Promise<T> {
    const headers = await this.headers(server);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } =
      await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const url = new URL(server.base_url);
    const client = new Client({ name: 'ContributorAI', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }), {
        timeout: CONNECT_TIMEOUT_MS,
      });
    } catch (streamableError) {
      // Server lama hanya mendukung transport SSE.
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      try {
        await client.connect(new SSEClientTransport(url, { requestInit: { headers } }), {
          timeout: CONNECT_TIMEOUT_MS,
        });
      } catch {
        const message =
          streamableError instanceof Error ? streamableError.message : String(streamableError);
        throw new AppError(
          ERROR_CODES.aiUpstreamError,
          `Tidak dapat terhubung ke server MCP "${server.name}": ${message}`,
          502,
        );
      }
    }
    try {
      return await fn(client as unknown as McpSdkClient);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /** Ambil ulang daftar tool dari server dan simpan ke cache. */
  async syncTools(serverId: string): Promise<McpServerToolsRow> {
    const server = await this.server(serverId);
    const tools: McpToolInfo[] = [];
    await this.withClient(server, async (client) => {
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, {
          timeout: CALL_TIMEOUT_MS,
        });
        for (const tool of page.tools ?? []) {
          tools.push({
            name: tool.name,
            ...(tool.title ? { title: tool.title } : {}),
            ...(tool.description ? { description: tool.description.slice(0, 2000) } : {}),
            inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object' },
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
          });
        }
        cursor = page.nextCursor;
      } while (cursor && tools.length < 500);
    });
    await this.dataSource.query(
      `UPDATE mcp_servers SET tools_cache = $2, tools_synced_at = now() WHERE id = $1`,
      [serverId, JSON.stringify(tools)],
    );
    return this.server(serverId);
  }

  async setPolicies(
    serverId: string,
    policies: Record<string, McpToolPolicy>,
  ): Promise<McpServerToolsRow> {
    await this.server(serverId);
    await this.dataSource.query(
      `UPDATE mcp_servers SET tool_policies = $2, updated_at = now() WHERE id = $1`,
      [serverId, JSON.stringify(policies)],
    );
    return this.server(serverId);
  }

  async callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    const server = await this.server(serverId);
    return this.withClient(server, async (client) => {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: CALL_TIMEOUT_MS,
      });
      const text =
        result.structuredContent !== undefined && !result.content?.length
          ? JSON.stringify(result.structuredContent)
          : mcpContentToText(result.content);
      return { isError: result.isError === true, text, raw: result };
    });
  }
}

/** Subset API Client SDK yang dipakai (menghindari ketergantungan tipe di luar modul ini). */
interface McpSdkClient {
  listTools(
    params?: { cursor?: string },
    options?: { timeout?: number },
  ): Promise<{
    tools: Array<{
      name: string;
      title?: string;
      description?: string;
      inputSchema: unknown;
      annotations?: McpToolInfo['annotations'];
    }>;
    nextCursor?: string;
  }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: unknown,
    options?: { timeout?: number },
  ): Promise<{ content?: unknown[]; structuredContent?: unknown; isError?: boolean }>;
}
