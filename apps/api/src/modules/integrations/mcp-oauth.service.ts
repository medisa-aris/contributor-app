import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { decryptSecret, encryptSecret, loadEncryptionKey } from '../../common/utils/secret-box';
import { DATA_SOURCE } from '../../database/database.module';

const FETCH_TIMEOUT_MS = 10_000;
const STATE_TTL_MINUTES = 10;
const REFRESH_SKEW_MS = 60_000;
const CLIENT_NAME = 'BeLead AI';
export const OAUTH_CALLBACK_PATH = '/integrations/oauth/callback';

/** Cakupan baca-saja yang diminta bila server menyediakannya (prinsip hak akses minimum). */
const PREFERRED_SCOPES = [
  'agent:search',
  'agent:query',
  'agent:query:construct',
  'agent:query:execute',
  'agent:resource:read',
  'agent:question:execute',
  'agent:sql:construct',
  'agent:sql:execute',
];

interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes: string[];
  registered_redirect_uri?: string;
}

interface ServerOAuthRow {
  id: string;
  name: string;
  base_url: string;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  oauth_client_manual: boolean;
  oauth_metadata: OAuthMetadata | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

@Injectable()
export class McpOauthService {
  private readonly logger = new Logger(McpOauthService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  /** Memulai alur otorisasi: temukan metadata, daftarkan client (bila perlu), kembalikan URL otorisasi. */
  async start(serverId: string, userId: string, redirectUri: string): Promise<{ authorizationUrl: string }> {
    this.requireKey();
    this.assertRedirectAllowed(redirectUri);
    const server = await this.loadServer(serverId);

    let metadata = server.oauth_metadata;
    let clientId = server.oauth_client_id;
    if (server.oauth_client_manual && clientId) {
      // Client didaftarkan manual: cukup discovery, tanpa pendaftaran dinamis.
      if (!metadata) {
        metadata = await this.discover(server.base_url);
        await this.dataSource.query(
          `UPDATE mcp_servers SET oauth_metadata = $2::jsonb, updated_at = now() WHERE id = $1`,
          [serverId, JSON.stringify(metadata)],
        );
      }
    } else if (!metadata || !clientId || metadata.registered_redirect_uri !== redirectUri) {
      metadata = await this.discover(server.base_url);
      clientId = await this.registerClient(metadata, redirectUri);
      metadata.registered_redirect_uri = redirectUri;
      await this.dataSource.query(
        `UPDATE mcp_servers SET oauth_client_id = $2, oauth_metadata = $3::jsonb, updated_at = now() WHERE id = $1`,
        [serverId, clientId, JSON.stringify(metadata)],
      );
    }

    const state = base64Url(randomBytes(24));
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    await this.dataSource.query(
      `DELETE FROM mcp_oauth_states WHERE created_at < now() - ($1 || ' minutes')::interval`,
      [STATE_TTL_MINUTES],
    );
    await this.dataSource.query(
      `INSERT INTO mcp_oauth_states (state, server_id, user_id, code_verifier, redirect_uri)
       VALUES ($1, $2, $3, $4, $5)`,
      [state, serverId, userId, verifier, redirectUri],
    );

    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('resource', server.base_url);
    if (metadata.scopes.length > 0) url.searchParams.set('scope', metadata.scopes.join(' '));
    return { authorizationUrl: url.toString() };
  }

  /** Menyelesaikan alur: tukar kode otorisasi dengan token lalu simpan terenkripsi. */
  async complete(userId: string, state: string, code: string): Promise<string> {
    const key = this.requireKey();
    const rows = (await this.dataSource.query(
      `DELETE FROM mcp_oauth_states
       WHERE state = $1 AND created_at > now() - ($2 || ' minutes')::interval
       RETURNING server_id, user_id, code_verifier, redirect_uri`,
      [state, STATE_TTL_MINUTES],
    )) as { server_id: string; user_id: string; code_verifier: string; redirect_uri: string }[];
    const pending = rows[0];
    if (!pending || pending.user_id !== userId) {
      throw new AppError(ERROR_CODES.validation, 'Sesi otorisasi tidak valid atau sudah kedaluwarsa. Ulangi dari awal.', 400);
    }
    const server = await this.loadServer(pending.server_id);
    if (!server.oauth_metadata || !server.oauth_client_id) {
      throw new AppError(ERROR_CODES.validation, 'Client OAuth belum terdaftar.', 400);
    }
    const token = await this.requestToken(server.oauth_metadata.token_endpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirect_uri,
      client_id: server.oauth_client_id,
      code_verifier: pending.code_verifier,
      resource: server.base_url,
      ...this.clientSecretParam(server, key),
    });
    await this.storeToken(pending.server_id, token, key, null);
    return pending.server_id;
  }

  async disconnect(serverId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE mcp_servers
          SET oauth_access_token = NULL, oauth_refresh_token = NULL, oauth_expires_at = NULL,
              oauth_scope = NULL, oauth_connected_at = NULL, updated_at = now()
        WHERE id = $1`,
      [serverId],
    );
  }

  /** Access token yang masih berlaku (disegarkan bila hampir habis); null bila belum terhubung. */
  async getAccessToken(serverId: string): Promise<string | null> {
    const key = this.requireKey();
    const server = await this.loadServer(serverId);
    if (!server.oauth_access_token) return null;
    const expiresAt = server.oauth_expires_at ? new Date(server.oauth_expires_at).getTime() : null;
    if (expiresAt === null || expiresAt - REFRESH_SKEW_MS > Date.now()) {
      return decryptSecret(server.oauth_access_token, key);
    }
    if (!server.oauth_refresh_token || !server.oauth_metadata || !server.oauth_client_id) {
      return null;
    }
    const refreshToken = decryptSecret(server.oauth_refresh_token, key);
    try {
      const token = await this.requestToken(server.oauth_metadata.token_endpoint, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: server.oauth_client_id,
        resource: server.base_url,
        ...this.clientSecretParam(server, key),
      });
      return await this.storeToken(serverId, token, key, refreshToken);
    } catch (error) {
      this.logger.warn(`Penyegaran token ${server.name} gagal: ${(error as Error).message}`);
      return null;
    }
  }

  /** Mengatur client OAuth manual (client ID + secret opsional); clientId kosong = pendaftaran dinamis. */
  async setManualClient(serverId: string, clientId: string, clientSecret: string | undefined): Promise<void> {
    const trimmed = clientId.trim();
    if (!trimmed) {
      await this.dataSource.query(
        `UPDATE mcp_servers
            SET oauth_client_id = NULL, oauth_client_secret = NULL, oauth_client_manual = false,
                oauth_metadata = NULL, updated_at = now()
          WHERE id = $1`,
        [serverId],
      );
      await this.disconnect(serverId);
      return;
    }
    const secret = clientSecret?.trim();
    const encrypted = secret ? encryptSecret(secret, this.requireKey()) : null;
    // Ganti client berarti token lama tidak berlaku lagi.
    await this.dataSource.query(
      `UPDATE mcp_servers
          SET oauth_client_id = $2, oauth_client_secret = $3, oauth_client_manual = true,
              oauth_metadata = NULL, updated_at = now()
        WHERE id = $1`,
      [serverId, trimmed, encrypted],
    );
    await this.disconnect(serverId);
  }

  private clientSecretParam(server: ServerOAuthRow, key: Buffer): Record<string, string> {
    return server.oauth_client_secret
      ? { client_secret: decryptSecret(server.oauth_client_secret, key) }
      : {};
  }

  private requireKey(): Buffer {
    const key = loadEncryptionKey(this.config.get<string>('INTEGRATIONS_ENCRYPTION_KEY'));
    if (!key) {
      throw new AppError(
        ERROR_CODES.validation,
        'INTEGRATIONS_ENCRYPTION_KEY belum diatur di server (base64, 32 byte). Buat dengan: openssl rand -base64 32',
        400,
      );
    }
    return key;
  }

  private assertRedirectAllowed(redirectUri: string): void {
    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      throw new AppError(ERROR_CODES.validation, 'redirectUri tidak valid.', 400);
    }
    const allowed = this.config.get<string[]>('app.corsOrigins') ?? [];
    if (parsed.pathname !== OAUTH_CALLBACK_PATH || !allowed.includes(parsed.origin)) {
      throw new AppError(ERROR_CODES.validation, 'redirectUri tidak diizinkan.', 400);
    }
  }

  private async loadServer(serverId: string): Promise<ServerOAuthRow> {
    const rows = (await this.dataSource.query(
      `SELECT id, name, base_url, oauth_client_id, oauth_client_secret, oauth_client_manual, oauth_metadata, oauth_access_token,
              oauth_refresh_token, oauth_expires_at
         FROM mcp_servers WHERE id = $1`,
      [serverId],
    )) as ServerOAuthRow[];
    if (rows.length === 0) throw new AppError(ERROR_CODES.notFound, 'MCP server tidak ditemukan.', 404);
    return rows[0]!;
  }

  private async fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
    this.assertSafeUrl(url);
    const response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', 'User-Agent': 'BeLead-OAuth/1.0', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error',
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  private assertSafeUrl(url: string): void {
    const parsed = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !local) {
      throw new AppError(ERROR_CODES.validation, `Endpoint OAuth harus HTTPS: ${parsed.origin}`, 400);
    }
  }

  /** RFC 9728 (protected resource) lalu RFC 8414 (authorization server). */
  private async discover(baseUrl: string): Promise<OAuthMetadata> {
    const base = new URL(baseUrl);
    const resourcePath = base.pathname === '/' ? '' : base.pathname;
    let issuer = base.origin;
    let supported: string[] = [];
    try {
      const resource = await this.fetchJson(`${base.origin}/.well-known/oauth-protected-resource${resourcePath}`);
      const body = resource.body as { authorization_servers?: string[]; scopes_supported?: string[] } | null;
      if (resource.status === 200 && body?.authorization_servers?.[0]) {
        issuer = body.authorization_servers[0];
        supported = body.scopes_supported ?? [];
      }
    } catch (error) {
      this.logger.warn(`Discovery protected-resource gagal: ${(error as Error).message}`);
    }

    const issuerUrl = new URL(issuer);
    const issuerPath = issuerUrl.pathname === '/' ? '' : issuerUrl.pathname;
    const candidates = [
      `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerPath}`,
      `${issuerUrl.origin}/.well-known/openid-configuration${issuerPath}`,
    ];
    for (const candidate of candidates) {
      const result = await this.fetchJson(candidate).catch(() => null);
      const meta = result?.body as
        | {
            issuer?: string;
            authorization_endpoint?: string;
            token_endpoint?: string;
            registration_endpoint?: string;
            scopes_supported?: string[];
            code_challenge_methods_supported?: string[];
          }
        | null
        | undefined;
      if (result?.status === 200 && meta?.authorization_endpoint && meta.token_endpoint) {
        if (meta.code_challenge_methods_supported && !meta.code_challenge_methods_supported.includes('S256')) {
          throw new AppError(ERROR_CODES.validation, 'Server otorisasi tidak mendukung PKCE S256.', 400);
        }
        const available = new Set(supported.length > 0 ? supported : (meta.scopes_supported ?? []));
        const scopes = PREFERRED_SCOPES.filter((s) => available.has(s));
        return {
          issuer: meta.issuer ?? issuerUrl.origin,
          authorization_endpoint: meta.authorization_endpoint,
          token_endpoint: meta.token_endpoint,
          registration_endpoint: meta.registration_endpoint,
          scopes,
        };
      }
    }
    throw new AppError(ERROR_CODES.validation, 'Metadata OAuth server tidak ditemukan (discovery gagal).', 400);
  }

  /** Dynamic Client Registration (RFC 7591) sebagai public client. */
  private async registerClient(metadata: OAuthMetadata, redirectUri: string): Promise<string> {
    if (!metadata.registration_endpoint) {
      throw new AppError(ERROR_CODES.validation, 'Server tidak mendukung pendaftaran client dinamis.', 400);
    }
    const result = await this.fetchJson(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: metadata.scopes.join(' ') || undefined,
      }),
    });
    const body = result.body as { client_id?: string } | null;
    if (result.status >= 300 || !body?.client_id) {
      const hint =
        result.status === 403 || result.status === 401
          ? ' Kemungkinan endpoint pendaftaran diblokir gateway/WAF atau butuh akses jaringan internal (VPN).'
          : '';
      throw new AppError(
        ERROR_CODES.validation,
        `Pendaftaran client OAuth ditolak (HTTP ${result.status}).${hint}`,
        400,
      );
    }
    return body.client_id;
  }

  private async requestToken(tokenEndpoint: string, params: Record<string, string>): Promise<TokenResponse> {
    const result = await this.fetchJson(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const body = (result.body ?? {}) as TokenResponse;
    if (result.status >= 300 || !body.access_token) {
      const reason = body.error_description ?? body.error ?? `HTTP ${result.status}`;
      throw new AppError(ERROR_CODES.validation, `Penukaran token ditolak: ${reason}`, 400);
    }
    return body;
  }

  private async storeToken(
    serverId: string,
    token: TokenResponse,
    key: Buffer,
    previousRefreshToken: string | null,
  ): Promise<string> {
    const accessToken = token.access_token!;
    const refresh = token.refresh_token ?? previousRefreshToken;
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
    await this.dataSource.query(
      `UPDATE mcp_servers
          SET oauth_access_token = $2, oauth_refresh_token = $3, oauth_expires_at = $4,
              oauth_scope = COALESCE($5, oauth_scope), oauth_connected_at = COALESCE(oauth_connected_at, now()),
              updated_at = now()
        WHERE id = $1`,
      [
        serverId,
        encryptSecret(accessToken, key),
        refresh ? encryptSecret(refresh, key) : null,
        expiresAt,
        token.scope ?? null,
      ],
    );
    return accessToken;
  }
}
