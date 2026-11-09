import sql from 'mssql';
import {
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

/**
 * SQL Server. Tidak ada transaksi read-only native, jadi query baca dijalankan di dalam
 * transaksi yang selalu di-ROLLBACK. Tetap disarankan memakai login DB read-only.
 */
export class MssqlDriver implements DbDriver {
  readonly engine = 'mssql' as const;
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<sql.ConnectionPool> | null = null;

  constructor(private readonly config: DbConnectionConfig) {}

  private async getPool(timeoutMs: number): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    if (!this.connecting) {
      const pool = new sql.ConnectionPool({
        server: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.username,
        password: this.config.password,
        connectionTimeout: 10_000,
        requestTimeout: timeoutMs,
        pool: { max: 3, min: 0, idleTimeoutMillis: 60_000 },
        options: {
          encrypt: this.config.options.ssl ?? false,
          trustServerCertificate: this.config.options.trustServerCertificate ?? true,
          appName: 'ContributorAI-Connector',
        },
      });
      pool.on('error', () => undefined);
      this.connecting = pool
        .connect()
        .then((connected) => {
          this.pool = connected;
          return connected;
        })
        .finally(() => {
          this.connecting = null;
        });
    }
    return this.connecting;
  }

  async test(timeoutMs: number): Promise<string> {
    const result = await this.query('SELECT @@VERSION AS version', {
      readOnly: true,
      rowLimit: 1,
      timeoutMs,
    });
    return String(result.rows[0]?.version ?? 'SQL Server')
      .split('\n')[0]!
      .trim();
  }

  async listTables(schema: string | undefined, timeoutMs: number): Promise<DbTableInfo[]> {
    const filter = schema ? `WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}'` : '';
    const result = await this.query(
      `SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS name,
              CASE WHEN TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS type
         FROM INFORMATION_SCHEMA.TABLES ${filter}
        ORDER BY TABLE_SCHEMA, TABLE_NAME`,
      { readOnly: true, rowLimit: 1000, timeoutMs },
    );
    return result.rows as unknown as DbTableInfo[];
  }

  async describeTable(table: string, timeoutMs: number): Promise<DbColumnInfo[]> {
    const { schema, name } = splitTableName(table);
    const pool = await this.getPool(timeoutMs);
    const request = pool.request();
    request.input('name', sql.NVarChar, name);
    request.input('schema', sql.NVarChar, schema ?? null);
    const result = await request.query<{ name: string; type: string; nullable: string }>(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @name AND (@schema IS NULL OR TABLE_SCHEMA = @schema)
        ORDER BY ORDINAL_POSITION`,
    );
    return result.recordset.map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable === 'YES',
    }));
  }

  async query(text: string, options: DbQueryOptions): Promise<DbQueryResult> {
    const pool = await this.getPool(options.timeoutMs);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    let finished = false;
    try {
      const request = new sql.Request(transaction);
      (request as unknown as { timeout: number }).timeout = options.timeoutMs;
      // SET ROWCOUNT membatasi baris yang dikembalikan SELECT tanpa mengubah query.
      const body = options.readOnly ? `SET ROWCOUNT ${options.rowLimit + 1};\n${text}` : text;
      const result = await request.query(body);
      if (options.readOnly) {
        await transaction.rollback();
      } else {
        await transaction.commit();
      }
      finished = true;
      const recordset = (result.recordset ?? []) as unknown as Record<string, unknown>[];
      const { rows, truncated } = limitRows(normalizeRows(recordset), options.rowLimit);
      const columns = result.recordset ? Object.keys(result.recordset.columns ?? {}) : [];
      return {
        columns,
        rows,
        rowCount: rows.length,
        truncated,
        ...(options.readOnly
          ? {}
          : { affected: (result.rowsAffected ?? []).reduce((a, b) => a + b, 0) }),
      };
    } finally {
      if (!finished) await transaction.rollback().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.pool?.close();
    this.pool = null;
  }
}
