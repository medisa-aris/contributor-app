import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUDIT_EVENTS } from '@bara/shared';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { McpOauthService } from './mcp-oauth.service';
import type {
  CreateMcpServerDto,
  CreateRestConnectorDto,
  UpdateMcpServerDto,
  UpdateRestConnectorDto,
} from './dto/integrations.dto';

export interface McpServerRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  base_url: string;
  auth_type: 'none' | 'api_key' | 'oauth';
  api_key_env: string | null;
  enabled: boolean;
  oauth_connected: boolean;
  oauth_client_manual: boolean;
  oauth_client_id: string | null;
  oauth_has_secret: boolean;
  oauth_scope: string | null;
  oauth_connected_at: string | null;
  last_health_at: string | null;
  last_health_ok: boolean | null;
  last_health_detail: string | null;
  created_at: string;
  updated_at: string;
}

/** Kolom publik MCP server: token OAuth tidak pernah ikut keluar. */
const MCP_COLUMNS = `id, code, name, description, base_url, auth_type, api_key_env, enabled,
  (oauth_access_token IS NOT NULL) AS oauth_connected, oauth_client_manual,
  oauth_client_id, (oauth_client_secret IS NOT NULL) AS oauth_has_secret, oauth_scope, oauth_connected_at,
  last_health_at, last_health_ok, last_health_detail, created_at, updated_at`;

export interface RestConnectorRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  base_url: string;
  tool_endpoints: { name: string; method: string; path: string }[];
  auth_type: 'none' | 'api_key';
  api_key_env: string | null;
  enabled: boolean;
  last_health_at: string | null;
  last_health_ok: boolean | null;
  last_health_detail: string | null;
  created_at: string;
  updated_at: string;
}

const HEALTH_TIMEOUT_MS = 5000;

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly oauth: McpOauthService,
  ) {}

  /** Konfigurasi provider AI aktif — tanpa kredensial, hanya status terkonfigurasi. */
  providerStatus(): {
    provider: string;
    model: string;
    baseUrl: string;
    timeoutMs: number;
    credentials: { openrouter: boolean; openai: boolean; anthropic: boolean };
  } {
    return {
      provider: this.config.get<string>('app.aiProvider', 'openrouter'),
      model: this.config.get<string>('app.aiModel', ''),
      baseUrl: this.config.get<string>('app.aiBaseUrl', ''),
      timeoutMs: this.config.get<number>('app.aiTimeoutMs', 60000),
      credentials: {
        openrouter: Boolean(this.config.get<string | null>('app.openrouterApiKey', null)),
        openai: Boolean(this.config.get<string | null>('app.openaiApiKey', null)),
        anthropic: Boolean(this.config.get<string | null>('app.anthropicApiKey', null)),
      },
    };
  }

  /** Status kredensial terreferensi (api_key_env) — boolean saja, nilai tidak pernah keluar. */
  async credentialStatus(): Promise<{ env: string; configured: boolean }[]> {
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT api_key_env FROM mcp_servers WHERE api_key_env IS NOT NULL
       UNION
       SELECT DISTINCT api_key_env FROM rest_connectors WHERE api_key_env IS NOT NULL`,
    )) as { api_key_env: string }[];
    const withCore = new Set(rows.map((r) => r.api_key_env));
    withCore.add('OPENROUTER_API_KEY');
    withCore.add('OPENAI_API_KEY');
    withCore.add('ANTHROPIC_API_KEY');
    return [...withCore].sort().map((env) => ({ env, configured: Boolean(process.env[env]) }));
  }

  async listMcpServers(options: {
    skip: number;
    take: number;
  }): Promise<{ items: McpServerRow[]; total: number }> {
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM mcp_servers`,
    )) as { total: number }[];
    const items = (await this.dataSource.query(
      `SELECT ${MCP_COLUMNS} FROM mcp_servers ORDER BY name LIMIT $1 OFFSET $2`,
      [options.take, options.skip],
    )) as McpServerRow[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  async createMcpServer(auth: AuthContext, dto: CreateMcpServerDto): Promise<McpServerRow> {
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO mcp_servers (code, name, description, base_url, auth_type, api_key_env)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [dto.code, dto.name, dto.description ?? null, dto.baseUrl, dto.authType, dto.apiKeyEnv ?? null],
      )) as { id: string }[];
      if (dto.oauthClientId) {
        await this.oauth.setManualClient(rows[0]!.id, dto.oauthClientId, dto.oauthClientSecret);
      }
      await this.audit.record({
        eventKey: AUDIT_EVENTS.mcpServerCreated,
        severity: 'info',
        summary: `Mendaftarkan MCP server "${dto.name}" (${dto.code})`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'mcp_server',
        entityId: rows[0]!.id,
        payload: { code: dto.code, baseUrl: dto.baseUrl },
      });
      return this.mcpDetail(rows[0]!.id);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Kode server sudah dipakai.', 409);
      }
      throw error;
    }
  }

  async updateMcpServer(
    auth: AuthContext,
    serverId: string,
    dto: UpdateMcpServerDto,
  ): Promise<McpServerRow> {
    await this.mcpDetail(serverId);
    const sets: string[] = [];
    const params: unknown[] = [serverId];
    const push = (clause: string, value: unknown) => {
      params.push(value);
      sets.push(`${clause} = $${params.length}`);
    };
    if (dto.name !== undefined) push('name', dto.name);
    if (dto.description !== undefined) push('description', dto.description);
    if (dto.baseUrl !== undefined) push('base_url', dto.baseUrl);
    if (dto.authType !== undefined) push('auth_type', dto.authType);
    if (dto.apiKeyEnv !== undefined) push('api_key_env', dto.apiKeyEnv);
    if (dto.enabled !== undefined) push('enabled', dto.enabled);
    if (sets.length > 0) {
      await this.dataSource.query(
        `UPDATE mcp_servers SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params,
      );
    }
    if (dto.oauthClientId !== undefined) {
      await this.oauth.setManualClient(serverId, dto.oauthClientId, dto.oauthClientSecret);
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.mcpServerUpdated,
      severity: 'info',
      summary: `Mengubah MCP server ${serverId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'mcp_server',
      entityId: serverId,
      payload: { fields: Object.keys(dto).filter((f) => f !== 'oauthClientSecret') },
    });
    return this.mcpDetail(serverId);
  }

  async deleteMcpServer(auth: AuthContext, serverId: string): Promise<void> {
    const server = await this.mcpDetail(serverId);
    await this.dataSource.query(`DELETE FROM mcp_servers WHERE id = $1`, [serverId]);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.mcpServerDeleted,
      severity: 'warn',
      summary: `Menghapus MCP server "${server.name}" (${server.code})`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'mcp_server',
      entityId: serverId,
      payload: {},
    });
  }

  async mcpHealthCheck(auth: AuthContext, serverId: string): Promise<McpServerRow> {
    const server = await this.mcpDetail(serverId);
    const result = await this.probe(server.base_url, server.auth_type, server.api_key_env, serverId);
    return this.recordHealth('mcp_servers', auth, serverId, server.name, result);
  }

  async startMcpOauth(auth: AuthContext, serverId: string, redirectUri: string) {
    const server = await this.mcpDetail(serverId);
    if (server.auth_type !== 'oauth') {
      throw new AppError(ERROR_CODES.validation, 'Server ini tidak memakai autentikasi OAuth.', 400);
    }
    return this.oauth.start(serverId, auth.user.id, redirectUri);
  }

  async completeMcpOauth(auth: AuthContext, state: string, code: string): Promise<McpServerRow> {
    const serverId = await this.oauth.complete(auth.user.id, state, code);
    const server = await this.mcpDetail(serverId);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.mcpServerUpdated,
      severity: 'info',
      summary: `Menghubungkan MCP server "${server.name}" via OAuth`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'mcp_server',
      entityId: serverId,
      payload: { oauth: 'connected' },
    });
    return server;
  }

  async disconnectMcpOauth(auth: AuthContext, serverId: string): Promise<McpServerRow> {
    const server = await this.mcpDetail(serverId);
    await this.oauth.disconnect(serverId);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.mcpServerUpdated,
      severity: 'warn',
      summary: `Memutus koneksi OAuth MCP server "${server.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'mcp_server',
      entityId: serverId,
      payload: { oauth: 'disconnected' },
    });
    return this.mcpDetail(serverId);
  }

  private async mcpDetail(serverId: string): Promise<McpServerRow> {
    const rows = (await this.dataSource.query(`SELECT ${MCP_COLUMNS} FROM mcp_servers WHERE id = $1`, [
      serverId,
    ])) as McpServerRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'MCP server tidak ditemukan.', 404);
    }
    return rows[0]!;
  }

  async listRestConnectors(options: {
    skip: number;
    take: number;
  }): Promise<{ items: RestConnectorRow[]; total: number }> {
    const totalRows = (await this.dataSource.query(
      `SELECT count(*)::int AS total FROM rest_connectors`,
    )) as { total: number }[];
    const items = (await this.dataSource.query(
      `SELECT * FROM rest_connectors ORDER BY name LIMIT $1 OFFSET $2`,
      [options.take, options.skip],
    )) as RestConnectorRow[];
    return { items, total: totalRows[0]?.total ?? 0 };
  }

  async createRestConnector(
    auth: AuthContext,
    dto: CreateRestConnectorDto,
  ): Promise<RestConnectorRow> {
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO rest_connectors (code, name, description, base_url, tool_endpoints, auth_type, api_key_env)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          dto.code,
          dto.name,
          dto.description ?? null,
          dto.baseUrl,
          JSON.stringify(dto.toolEndpoints),
          dto.authType,
          dto.apiKeyEnv ?? null,
        ],
      )) as { id: string }[];
      await this.audit.record({
        eventKey: AUDIT_EVENTS.restConnectorCreated,
        severity: 'info',
        summary: `Mendaftarkan REST connector "${dto.name}" (${dto.code})`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'rest_connector',
        entityId: rows[0]!.id,
        payload: { code: dto.code, baseUrl: dto.baseUrl, endpoints: dto.toolEndpoints.length },
      });
      return this.restDetail(rows[0]!.id);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Kode konektor sudah dipakai.', 409);
      }
      throw error;
    }
  }

  async updateRestConnector(
    auth: AuthContext,
    connectorId: string,
    dto: UpdateRestConnectorDto,
  ): Promise<RestConnectorRow> {
    await this.restDetail(connectorId);
    const sets: string[] = [];
    const params: unknown[] = [connectorId];
    const push = (clause: string, value: unknown) => {
      params.push(value);
      sets.push(`${clause} = $${params.length}`);
    };
    if (dto.name !== undefined) push('name', dto.name);
    if (dto.description !== undefined) push('description', dto.description);
    if (dto.baseUrl !== undefined) push('base_url', dto.baseUrl);
    if (dto.toolEndpoints !== undefined) push('tool_endpoints', JSON.stringify(dto.toolEndpoints));
    if (dto.authType !== undefined) push('auth_type', dto.authType);
    if (dto.apiKeyEnv !== undefined) push('api_key_env', dto.apiKeyEnv);
    if (dto.enabled !== undefined) push('enabled', dto.enabled);
    if (sets.length > 0) {
      await this.dataSource.query(
        `UPDATE rest_connectors SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params,
      );
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.restConnectorUpdated,
      severity: 'info',
      summary: `Mengubah REST connector ${connectorId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'rest_connector',
      entityId: connectorId,
      payload: { fields: Object.keys(dto) },
    });
    return this.restDetail(connectorId);
  }

  async deleteRestConnector(auth: AuthContext, connectorId: string): Promise<void> {
    const connector = await this.restDetail(connectorId);
    await this.dataSource.query(`DELETE FROM rest_connectors WHERE id = $1`, [connectorId]);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.restConnectorDeleted,
      severity: 'warn',
      summary: `Menghapus REST connector "${connector.name}" (${connector.code})`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'rest_connector',
      entityId: connectorId,
      payload: {},
    });
  }

  async restHealthCheck(auth: AuthContext, connectorId: string): Promise<RestConnectorRow> {
    const connector = await this.restDetail(connectorId);
    const result = await this.probe(connector.base_url, connector.auth_type, connector.api_key_env);
    return this.recordHealth('rest_connectors', auth, connectorId, connector.name, result);
  }

  private async restDetail(connectorId: string): Promise<RestConnectorRow> {
    const rows = (await this.dataSource.query(`SELECT * FROM rest_connectors WHERE id = $1`, [
      connectorId,
    ])) as RestConnectorRow[];
    if (rows.length === 0) {
      throw new AppError(ERROR_CODES.notFound, 'REST connector tidak ditemukan.', 404);
    }
    return rows[0]!;
  }

  /** Uji ketercapaian HTTP server-side; kredensial (bila ada) dikirim sebagai header, tidak pernah dicatat. */
  private async probe(
    baseUrl: string,
    authType: 'none' | 'api_key' | 'oauth',
    apiKeyEnv: string | null,
    oauthServerId?: string,
  ): Promise<{ ok: boolean; detail: string }> {
    const startedAt = Date.now();
    let credentialsSent = false;
    try {
      const headers: Record<string, string> = { 'User-Agent': 'bara-healthcheck/1.0' };
      if (authType === 'oauth' && oauthServerId) {
        const token = await this.oauth.getAccessToken(oauthServerId);
        if (!token) {
          return { ok: false, detail: 'Belum terhubung via OAuth (atau token kedaluwarsa). Klik "Hubungkan".' };
        }
        headers.Authorization = `Bearer ${token}`;
        credentialsSent = true;
      }
      if (authType === 'api_key' && apiKeyEnv) {
        const key = process.env[apiKeyEnv];
        if (!key) {
          return { ok: false, detail: `Variabel lingkungan ${apiKeyEnv} belum diatur di server.` };
        }
        headers.Authorization = `Bearer ${key}`;
        credentialsSent = true;
      }
      const response = await fetch(baseUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        redirect: 'follow',
      });
      const detail = `HTTP ${response.status} dalam ${Date.now() - startedAt} ms`;
      const rejected = credentialsSent && (response.status === 401 || response.status === 403);
      return { ok: !rejected && (response.ok || response.status < 500), detail };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kesalahan jaringan.';
      this.logger.warn(`Health check ${baseUrl} gagal: ${message}`);
      return { ok: false, detail: `Tidak terjangkau: ${message.slice(0, 200)}` };
    }
  }

  private async recordHealth(
    table: 'mcp_servers' | 'rest_connectors',
    auth: AuthContext,
    id: string,
    name: string,
    result: { ok: boolean; detail: string },
  ): Promise<McpServerRow & RestConnectorRow> {
    await this.dataSource.query(
      `UPDATE ${table} SET last_health_at = now(), last_health_ok = $2, last_health_detail = $3 WHERE id = $1`,
      [id, result.ok, result.detail],
    );
    await this.audit.record({
      eventKey: AUDIT_EVENTS.integrationHealthChecked,
      severity: result.ok ? 'info' : 'warn',
      summary: `Health check ${table === 'mcp_servers' ? 'MCP server' : 'REST connector'} "${name}": ${result.ok ? 'OK' : 'gagal'}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: table === 'mcp_servers' ? 'mcp_server' : 'rest_connector',
      entityId: id,
      payload: { ok: result.ok, detail: result.detail },
    });
    const rows = (await this.dataSource.query(`SELECT * FROM ${table} WHERE id = $1`, [id])) as (
      | McpServerRow
      | RestConnectorRow
    )[];
    return rows[0]! as McpServerRow & RestConnectorRow;
  }
}
