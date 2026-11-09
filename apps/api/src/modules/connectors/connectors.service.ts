import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUDIT_EVENTS } from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import { decryptSecret, encryptSecret, loadEncryptionKey } from '../../common/utils/secret-box';
import { DATA_SOURCE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { ConnectorAccessService, type ConnectorType } from './connector-access.service';
import {
  createDriver,
  type DbConnectionOptions,
  type DbDriver,
  type DbEngine,
  type DbTableInfo,
} from './drivers';
import type {
  CreateConnectorGrantDto,
  CreateDbConnectorDto,
  UpdateDbConnectorDto,
} from './dto/connectors.dto';

export interface DbConnectorRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  engine: DbEngine;
  host: string;
  port: number;
  database_name: string;
  username: string;
  has_password: boolean;
  options: DbConnectionOptions;
  allow_write: boolean;
  row_limit: number;
  timeout_ms: number;
  enabled: boolean;
  last_health_at: string | null;
  last_health_ok: boolean | null;
  last_health_detail: string | null;
  grant_count: number;
  created_at: string;
  updated_at: string;
}

/** Kolom publik: password terenkripsi tidak pernah keluar dari server. */
const DB_COLUMNS = `c.id, c.code, c.name, c.description, c.engine, c.host, c.port, c.database_name, c.username,
  (c.password_enc IS NOT NULL) AS has_password, c.options, c.allow_write, c.row_limit, c.timeout_ms, c.enabled,
  c.last_health_at, c.last_health_ok, c.last_health_detail,
  (SELECT count(*)::int FROM connector_grants g WHERE g.connector_type = 'database' AND g.connector_id = c.id) AS grant_count,
  c.created_at, c.updated_at`;

export interface ConnectorGrantRow {
  id: string;
  connector_type: ConnectorType;
  connector_id: string;
  subject_type: 'user' | 'role' | 'department' | 'group';
  subject_id: string;
  subject_label: string | null;
  access: 'read' | 'read_write';
  table_allowlist: string[] | null;
  created_at: string;
}

/** Konektor yang dapat dipasang oleh user (gabungan database + MCP sesuai grant). */
export interface AvailableConnector {
  connectorType: ConnectorType;
  connectorId: string;
  code: string;
  name: string;
  description: string | null;
  /** postgres/mysql/mssql/oracle untuk database, `mcp` untuk server MCP. */
  engine: string;
  access: 'read' | 'read_write';
  allowWrite: boolean;
  tableAllowlist: string[] | null;
}

interface CachedDriver {
  driver: DbDriver;
  updatedAt: string;
}

@Injectable()
export class ConnectorsService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectorsService.name);
  private readonly drivers = new Map<string, CachedDriver>();

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly access: ConnectorAccessService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.drivers.values()].map((entry) => entry.driver.close().catch(() => undefined)),
    );
    this.drivers.clear();
  }

  private encryptionKey(): Buffer {
    const key = loadEncryptionKey(this.config.get<string>('INTEGRATIONS_ENCRYPTION_KEY'));
    if (!key) {
      throw new AppError(
        ERROR_CODES.validation,
        'INTEGRATIONS_ENCRYPTION_KEY belum diatur di server (base64, 32 byte). Buat dengan: openssl rand -base64 32',
        503,
      );
    }
    return key;
  }

  // ───────────────────────── Konektor database (admin) ─────────────────────────

  async listDb(): Promise<DbConnectorRow[]> {
    return (await this.dataSource.query(
      `SELECT ${DB_COLUMNS} FROM db_connectors c ORDER BY c.name`,
    )) as DbConnectorRow[];
  }

  async dbDetail(id: string): Promise<DbConnectorRow> {
    const rows = (await this.dataSource.query(
      `SELECT ${DB_COLUMNS} FROM db_connectors c WHERE c.id = $1`,
      [id],
    )) as DbConnectorRow[];
    if (!rows[0])
      throw new AppError(ERROR_CODES.notFound, 'Konektor database tidak ditemukan.', 404);
    return rows[0];
  }

  async createDb(auth: AuthContext, dto: CreateDbConnectorDto): Promise<DbConnectorRow> {
    const passwordEnc = dto.password ? encryptSecret(dto.password, this.encryptionKey()) : null;
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO db_connectors
           (code, name, description, engine, host, port, database_name, username, password_enc,
            options, allow_write, row_limit, timeout_ms, enabled, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 200), COALESCE($13, 30000),
                 COALESCE($14, true), $15)
         RETURNING id`,
        [
          dto.code,
          dto.name,
          dto.description ?? null,
          dto.engine,
          dto.host,
          dto.port,
          dto.database,
          dto.username,
          passwordEnc,
          JSON.stringify(dto.options ?? {}),
          dto.allowWrite ?? false,
          dto.rowLimit ?? null,
          dto.timeoutMs ?? null,
          dto.enabled ?? null,
          auth.user.id,
        ],
      )) as { id: string }[];
      await this.audit.record({
        eventKey: AUDIT_EVENTS.dbConnectorCreated,
        severity: 'info',
        summary: `Mendaftarkan konektor database "${dto.name}" (${dto.engine})`,
        actorUserId: auth.user.id,
        actorLabel: auth.user.email,
        actorIp: auth.session.ip,
        entityType: 'db_connector',
        entityId: rows[0]!.id,
        payload: {
          code: dto.code,
          engine: dto.engine,
          host: dto.host,
          database: dto.database,
          allowWrite: dto.allowWrite ?? false,
        },
      });
      return this.dbDetail(rows[0]!.id);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Kode konektor sudah dipakai.', 409);
      }
      throw error;
    }
  }

  async updateDb(
    auth: AuthContext,
    id: string,
    dto: UpdateDbConnectorDto,
  ): Promise<DbConnectorRow> {
    const before = await this.dbDetail(id);
    const sets: string[] = [];
    const params: unknown[] = [id];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (dto.name !== undefined) push('name', dto.name);
    if (dto.description !== undefined) push('description', dto.description || null);
    if (dto.host !== undefined) push('host', dto.host);
    if (dto.port !== undefined) push('port', dto.port);
    if (dto.database !== undefined) push('database_name', dto.database);
    if (dto.username !== undefined) push('username', dto.username);
    if (dto.password) push('password_enc', encryptSecret(dto.password, this.encryptionKey()));
    if (dto.options !== undefined) push('options', JSON.stringify(dto.options));
    if (dto.allowWrite !== undefined) push('allow_write', dto.allowWrite);
    if (dto.rowLimit !== undefined) push('row_limit', dto.rowLimit);
    if (dto.timeoutMs !== undefined) push('timeout_ms', dto.timeoutMs);
    if (dto.enabled !== undefined) push('enabled', dto.enabled);
    if (sets.length === 0) return before;
    await this.dataSource.query(
      `UPDATE db_connectors SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
      params,
    );
    await this.dropDriver(id);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.dbConnectorUpdated,
      severity: dto.allowWrite && !before.allow_write ? 'warn' : 'info',
      summary: `Mengubah konektor database "${before.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'db_connector',
      entityId: id,
      payload: {
        fields: Object.keys(dto).filter((key) => key !== 'password'),
        passwordChanged: Boolean(dto.password),
      },
    });
    return this.dbDetail(id);
  }

  async deleteDb(auth: AuthContext, id: string): Promise<void> {
    const before = await this.dbDetail(id);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM connector_grants WHERE connector_type = 'database' AND connector_id = $1`,
        [id],
      );
      await manager.query(`DELETE FROM db_connectors WHERE id = $1`, [id]);
    });
    await this.dropDriver(id);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.dbConnectorDeleted,
      severity: 'warn',
      summary: `Menghapus konektor database "${before.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'db_connector',
      entityId: id,
      payload: { code: before.code },
    });
  }

  async testDb(auth: AuthContext, id: string): Promise<DbConnectorRow> {
    const connector = await this.dbDetail(id);
    let ok = false;
    let detail: string;
    try {
      const driver = await this.driverFor(id);
      detail = await driver.test(Math.min(connector.timeout_ms, 15_000));
      ok = true;
    } catch (error) {
      detail = error instanceof Error ? error.message : 'Koneksi gagal.';
      await this.dropDriver(id);
    }
    await this.dataSource.query(
      `UPDATE db_connectors SET last_health_at = now(), last_health_ok = $2, last_health_detail = $3 WHERE id = $1`,
      [id, ok, detail.slice(0, 500)],
    );
    await this.audit.record({
      eventKey: AUDIT_EVENTS.integrationHealthChecked,
      severity: ok ? 'info' : 'warn',
      summary: `Uji koneksi konektor database "${connector.name}": ${ok ? 'berhasil' : 'gagal'}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'db_connector',
      entityId: id,
      payload: { ok },
    });
    return this.dbDetail(id);
  }

  async tablesDb(id: string): Promise<DbTableInfo[]> {
    const connector = await this.dbDetail(id);
    const driver = await this.driverFor(id);
    return driver.listTables(connector.options.schema, connector.timeout_ms);
  }

  // ───────────────────────── Driver (dipakai tool) ─────────────────────────

  /** Driver ter-cache per konektor; dibuat ulang bila konektor berubah. */
  async driverFor(id: string): Promise<DbDriver> {
    const rows = (await this.dataSource.query(
      `SELECT engine, host, port, database_name, username, password_enc, options, enabled, updated_at
         FROM db_connectors WHERE id = $1`,
      [id],
    )) as Array<{
      engine: DbEngine;
      host: string;
      port: number;
      database_name: string;
      username: string;
      password_enc: string | null;
      options: DbConnectionOptions;
      enabled: boolean;
      updated_at: Date | string;
    }>;
    const row = rows[0];
    if (!row) throw new AppError(ERROR_CODES.notFound, 'Konektor database tidak ditemukan.', 404);
    const updatedAt = new Date(row.updated_at).toISOString();
    const cached = this.drivers.get(id);
    if (cached && cached.updatedAt === updatedAt) return cached.driver;
    if (cached) await cached.driver.close().catch(() => undefined);
    const driver = await createDriver({
      engine: row.engine,
      host: row.host,
      port: row.port,
      database: row.database_name,
      username: row.username,
      password: row.password_enc ? decryptSecret(row.password_enc, this.encryptionKey()) : '',
      options: row.options ?? {},
    });
    this.drivers.set(id, { driver, updatedAt });
    return driver;
  }

  private async dropDriver(id: string): Promise<void> {
    const cached = this.drivers.get(id);
    this.drivers.delete(id);
    if (cached)
      await cached.driver.close().catch((error: unknown) => this.logger.warn(String(error)));
  }

  // ───────────────────────── Grant (admin) ─────────────────────────

  private async assertConnector(type: ConnectorType, id: string): Promise<{ name: string }> {
    const table = type === 'database' ? 'db_connectors' : 'mcp_servers';
    const rows = (await this.dataSource.query(`SELECT name FROM ${table} WHERE id = $1`, [id])) as {
      name: string;
    }[];
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Konektor tidak ditemukan.', 404);
    return rows[0];
  }

  async listGrants(type: ConnectorType, connectorId: string): Promise<ConnectorGrantRow[]> {
    await this.assertConnector(type, connectorId);
    return (await this.dataSource.query(
      `SELECT g.id, g.connector_type, g.connector_id, g.subject_type, g.subject_id, g.access, g.table_allowlist,
              g.created_at,
              CASE g.subject_type
                WHEN 'user' THEN (SELECT u.display_name || ' <' || u.email || '>' FROM users u WHERE u.id = g.subject_id)
                WHEN 'role' THEN (SELECT r.name FROM roles r WHERE r.id = g.subject_id)
                WHEN 'department' THEN (SELECT d.name || ' (' || d.code || ')' FROM departments d WHERE d.id = g.subject_id)
                WHEN 'group' THEN (SELECT gr.name FROM groups gr WHERE gr.id = g.subject_id)
              END AS subject_label
         FROM connector_grants g
        WHERE g.connector_type = $1 AND g.connector_id = $2
        ORDER BY g.subject_type, subject_label`,
      [type, connectorId],
    )) as ConnectorGrantRow[];
  }

  async addGrant(
    auth: AuthContext,
    type: ConnectorType,
    connectorId: string,
    dto: CreateConnectorGrantDto,
  ): Promise<ConnectorGrantRow[]> {
    const connector = await this.assertConnector(type, connectorId);
    const subjectTable = {
      user: 'users',
      role: 'roles',
      department: 'departments',
      group: 'groups',
    }[dto.subjectType];
    const subject = (await this.dataSource.query(`SELECT 1 FROM ${subjectTable} WHERE id = $1`, [
      dto.subjectId,
    ])) as unknown[];
    if (subject.length === 0)
      throw new AppError(ERROR_CODES.notFound, 'Subjek grant tidak ditemukan.', 404);
    const allowlist = (dto.tableAllowlist ?? []).map((t) => t.trim()).filter(Boolean);
    await this.dataSource.query(
      `INSERT INTO connector_grants (connector_type, connector_id, subject_type, subject_id, access, table_allowlist, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ON CONSTRAINT uq_connector_grant
       DO UPDATE SET access = EXCLUDED.access, table_allowlist = EXCLUDED.table_allowlist`,
      [
        type,
        connectorId,
        dto.subjectType,
        dto.subjectId,
        dto.access,
        allowlist.length > 0 ? JSON.stringify(allowlist) : null,
        auth.user.id,
      ],
    );
    await this.audit.record({
      eventKey: AUDIT_EVENTS.connectorGrantCreated,
      severity: dto.access === 'read_write' ? 'warn' : 'info',
      summary: `Memberi akses ${dto.access} konektor "${connector.name}" ke ${dto.subjectType}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: type === 'database' ? 'db_connector' : 'mcp_server',
      entityId: connectorId,
      payload: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        access: dto.access,
        tableAllowlist: allowlist,
      },
    });
    return this.listGrants(type, connectorId);
  }

  async deleteGrant(
    auth: AuthContext,
    type: ConnectorType,
    connectorId: string,
    grantId: string,
  ): Promise<void> {
    const connector = await this.assertConnector(type, connectorId);
    const rows = (await this.dataSource.query(
      `DELETE FROM connector_grants WHERE id = $1 AND connector_type = $2 AND connector_id = $3
       RETURNING subject_type, subject_id`,
      [grantId, type, connectorId],
    )) as unknown[];
    // node-postgres mengembalikan [rows, count] untuk DELETE ... RETURNING lewat TypeORM.
    const deleted = Array.isArray(rows[0]) ? (rows[0] as unknown[]) : rows;
    if (deleted.length === 0)
      throw new AppError(ERROR_CODES.notFound, 'Grant tidak ditemukan.', 404);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.connectorGrantDeleted,
      severity: 'info',
      summary: `Mencabut akses konektor "${connector.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: type === 'database' ? 'db_connector' : 'mcp_server',
      entityId: connectorId,
      payload: { grantId },
    });
  }

  // ───────────────────────── Untuk user ─────────────────────────

  /** Konektor aktif yang di-grant ke user (untuk pemilih di agent dan percakapan). */
  async availableFor(userId: string): Promise<AvailableConnector[]> {
    const grants = await this.access.effectiveGrants(userId);
    if (grants.length === 0) return [];
    const dbIds = grants.filter((g) => g.connectorType === 'database').map((g) => g.connectorId);
    const mcpIds = grants.filter((g) => g.connectorType === 'mcp').map((g) => g.connectorId);
    const dbRows = dbIds.length
      ? ((await this.dataSource.query(
          `SELECT id, code, name, description, engine::text AS engine, allow_write
             FROM db_connectors WHERE enabled AND id = ANY($1::uuid[])`,
          [dbIds],
        )) as Array<{
          id: string;
          code: string;
          name: string;
          description: string | null;
          engine: string;
          allow_write: boolean;
        }>)
      : [];
    const mcpRows = mcpIds.length
      ? ((await this.dataSource.query(
          `SELECT id, code, name, description FROM mcp_servers WHERE enabled AND id = ANY($1::uuid[])`,
          [mcpIds],
        )) as Array<{ id: string; code: string; name: string; description: string | null }>)
      : [];
    const out: AvailableConnector[] = [];
    for (const grant of grants) {
      if (grant.connectorType === 'database') {
        const row = dbRows.find((r) => r.id === grant.connectorId);
        if (!row) continue;
        out.push({
          connectorType: 'database',
          connectorId: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          engine: row.engine,
          // Akses tulis efektif hanya bila konektor juga mengizinkan tulis.
          access: row.allow_write ? grant.access : 'read',
          allowWrite: row.allow_write,
          tableAllowlist: grant.tableAllowlist,
        });
      } else {
        const row = mcpRows.find((r) => r.id === grant.connectorId);
        if (!row) continue;
        out.push({
          connectorType: 'mcp',
          connectorId: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          engine: 'mcp',
          access: grant.access,
          allowWrite: true,
          tableAllowlist: null,
        });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
