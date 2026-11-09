import { Pool, type PoolClient } from 'pg';
import {
  WRAPPABLE,
  limitRows,
  normalizeRows,
  splitTableName,
  type DbColumnInfo,
  type DbConnectionConfig,
  type DbDriver,
  type DbQueryOptions,
  type DbQueryResult,
  type DbTableInfo,
} from './types';

export class PostgresDriver implements DbDriver {
  readonly engine = 'postgres' as const;
  private readonly pool: Pool;

  constructor(private readonly config: DbConnectionConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      max: 3,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'ContributorAI-Connector',
      ...(config.options.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    // Kesalahan koneksi idle tidak boleh menjatuhkan proses.
    this.pool.on('error', () => undefined);
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async test(timeoutMs: number): Promise<string> {
    return this.withClient(async (client) => {
      await client.query(`SET statement_timeout = ${Math.round(timeoutMs)}`);
      const result = await client.query<{ version: string }>('SELECT version() AS version');
      return result.rows[0]?.version ?? 'PostgreSQL';
    });
  }

  async listTables(schema: string | undefined, timeoutMs: number): Promise<DbTableInfo[]> {
    const result = await this.query(
      `SELECT table_schema AS schema, table_name AS name,
              CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS type
         FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          ${schema ? `AND table_schema = '${schema.replace(/'/g, "''")}'` : ''}
        ORDER BY table_schema, table_name`,
      { readOnly: true, rowLimit: 1000, timeoutMs },
    );
    return result.rows as unknown as DbTableInfo[];
  }

  async describeTable(table: string, timeoutMs: number): Promise<DbColumnInfo[]> {
    const { schema, name } = splitTableName(table);
    return this.withClient(async (client) => {
      await client.query('BEGIN READ ONLY');
      try {
        await client.query(`SET LOCAL statement_timeout = ${Math.round(timeoutMs)}`);
        const result = await client.query<{ name: string; type: string; nullable: boolean }>(
          `SELECT column_name AS name, data_type AS type, is_nullable = 'YES' AS nullable
             FROM information_schema.columns
            WHERE table_name = $1 AND ($2::text IS NULL OR table_schema = $2)
            ORDER BY ordinal_position`,
          [name, schema ?? this.config.options.schema ?? null],
        );
        return result.rows;
      } finally {
        await client.query('ROLLBACK');
      }
    });
  }

  async query(sql: string, options: DbQueryOptions): Promise<DbQueryResult> {
    return this.withClient(async (client) => {
      await client.query(options.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
      let committed = false;
      try {
        await client.query(`SET LOCAL statement_timeout = ${Math.round(options.timeoutMs)}`);
        const text =
          options.readOnly && WRAPPABLE.test(sql)
            ? `SELECT * FROM (${sql}) AS _contributor_q LIMIT ${options.rowLimit + 1}`
            : sql;
        const result = await client.query<Record<string, unknown>>(text);
        if (!options.readOnly) {
          await client.query('COMMIT');
          committed = true;
        }
        const { rows, truncated } = limitRows(normalizeRows(result.rows ?? []), options.rowLimit);
        return {
          columns: (result.fields ?? []).map((field) => field.name),
          rows,
          rowCount: rows.length,
          truncated,
          ...(options.readOnly ? {} : { affected: result.rowCount ?? 0 }),
        };
      } finally {
        if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
