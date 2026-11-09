import {
  createPool,
  type FieldPacket,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
} from 'mysql2/promise';
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

export class MysqlDriver implements DbDriver {
  readonly engine = 'mysql' as const;
  private readonly pool: Pool;

  constructor(private readonly config: DbConnectionConfig) {
    this.pool = createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      connectionLimit: 3,
      connectTimeout: 10_000,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false,
      ...(config.options.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }

  private async withConnection<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      return await fn(conn);
    } finally {
      conn.release();
    }
  }

  async test(timeoutMs: number): Promise<string> {
    const result = await this.query('SELECT VERSION() AS version', {
      readOnly: true,
      rowLimit: 1,
      timeoutMs,
    });
    return `MySQL ${String(result.rows[0]?.version ?? '')}`.trim();
  }

  async listTables(schema: string | undefined, timeoutMs: number): Promise<DbTableInfo[]> {
    const result = await this.query(
      `SELECT table_schema AS \`schema\`, table_name AS name,
              CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS type
         FROM information_schema.tables
        WHERE table_schema = ${schema ? `'${schema.replace(/'/g, "''")}'` : 'DATABASE()'}
        ORDER BY table_name`,
      { readOnly: true, rowLimit: 1000, timeoutMs },
    );
    return result.rows as unknown as DbTableInfo[];
  }

  async describeTable(table: string, timeoutMs: number): Promise<DbColumnInfo[]> {
    const { schema, name } = splitTableName(table);
    return this.withConnection(async (conn) => {
      const [rows] = await conn.query({
        sql: `SELECT column_name AS name, column_type AS type, is_nullable = 'YES' AS nullable
                FROM information_schema.columns
               WHERE table_name = ? AND table_schema = COALESCE(?, DATABASE())
               ORDER BY ordinal_position`,
        values: [name, schema ?? null],
        timeout: timeoutMs,
      });
      return (rows as Array<{ name: string; type: string; nullable: number }>).map((row) => ({
        name: row.name,
        type: row.type,
        nullable: Boolean(row.nullable),
      }));
    });
  }

  async query(sql: string, options: DbQueryOptions): Promise<DbQueryResult> {
    return this.withConnection(async (conn) => {
      await conn.query(options.readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION');
      let committed = false;
      try {
        const text =
          options.readOnly && WRAPPABLE.test(sql)
            ? `SELECT * FROM (${sql}) AS _contributor_q LIMIT ${options.rowLimit + 1}`
            : sql;
        const [result, fields] = await conn.query({ sql: text, timeout: options.timeoutMs });
        if (!options.readOnly) {
          await conn.commit();
          committed = true;
        }
        if (!Array.isArray(result)) {
          const header = result as ResultSetHeader;
          return {
            columns: [],
            rows: [],
            rowCount: 0,
            truncated: false,
            affected: header.affectedRows,
          };
        }
        const { rows, truncated } = limitRows(
          normalizeRows(result as Record<string, unknown>[]),
          options.rowLimit,
        );
        return {
          columns: ((fields ?? []) as FieldPacket[]).map((field) => field.name),
          rows,
          rowCount: rows.length,
          truncated,
        };
      } finally {
        if (!committed) await conn.rollback().catch(() => undefined);
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
