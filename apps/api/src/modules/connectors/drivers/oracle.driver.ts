import oracledb from 'oracledb';
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

/** Oracle Database lewat node-oracledb mode thin (tanpa Oracle Instant Client). */
export class OracleDriver implements DbDriver {
  readonly engine = 'oracle' as const;
  private pool: oracledb.Pool | null = null;

  constructor(private readonly config: DbConnectionConfig) {}

  private connectString(): string {
    const { host, port, database, options } = this.config;
    if (options.oracleSid) {
      return `(DESCRIPTION=(ADDRESS=(PROTOCOL=${options.ssl ? 'TCPS' : 'TCP'})(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${database})))`;
    }
    return `${options.ssl ? 'tcps://' : ''}${host}:${port}/${database}`;
  }

  private async getPool(): Promise<oracledb.Pool> {
    if (this.pool) return this.pool;
    this.pool = await oracledb.createPool({
      user: this.config.username,
      password: this.config.password,
      connectString: this.connectString(),
      poolMin: 0,
      poolMax: 3,
      poolTimeout: 60,
      queueTimeout: 10_000,
    });
    return this.pool;
  }

  private async withConnection<T>(
    timeoutMs: number,
    fn: (conn: oracledb.Connection) => Promise<T>,
  ): Promise<T> {
    const conn = await (await this.getPool()).getConnection();
    conn.callTimeout = timeoutMs;
    try {
      return await fn(conn);
    } finally {
      await conn.close().catch(() => undefined);
    }
  }

  async test(timeoutMs: number): Promise<string> {
    return this.withConnection(timeoutMs, async (conn) => {
      await conn.execute('SELECT 1 FROM DUAL');
      return `Oracle ${conn.oracleServerVersionString ?? ''}`.trim();
    });
  }

  async listTables(schema: string | undefined, timeoutMs: number): Promise<DbTableInfo[]> {
    return this.withConnection(timeoutMs, async (conn) => {
      const owner = (schema ?? this.config.options.schema ?? this.config.username).toUpperCase();
      const result = await conn.execute<{ SCHEMA: string; NAME: string; TYPE: string }>(
        `SELECT owner AS "SCHEMA", table_name AS "NAME", 'table' AS "TYPE" FROM all_tables WHERE owner = :owner
         UNION ALL
         SELECT owner, view_name, 'view' FROM all_views WHERE owner = :owner
         ORDER BY 2`,
        { owner },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: 1000 },
      );
      return (result.rows ?? []).map((row) => ({
        schema: row.SCHEMA,
        name: row.NAME,
        type: row.TYPE === 'view' ? 'view' : 'table',
      }));
    });
  }

  async describeTable(table: string, timeoutMs: number): Promise<DbColumnInfo[]> {
    const { schema, name } = splitTableName(table);
    return this.withConnection(timeoutMs, async (conn) => {
      const result = await conn.execute<{ NAME: string; TYPE: string; NULLABLE: string }>(
        `SELECT column_name AS "NAME", data_type AS "TYPE", nullable AS "NULLABLE"
           FROM all_tab_columns
          WHERE table_name = :name AND owner = :owner
          ORDER BY column_id`,
        {
          name: name.toUpperCase(),
          owner: (schema ?? this.config.options.schema ?? this.config.username).toUpperCase(),
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows ?? []).map((row) => ({
        name: row.NAME,
        type: row.TYPE,
        nullable: row.NULLABLE === 'Y',
      }));
    });
  }

  async query(sql: string, options: DbQueryOptions): Promise<DbQueryResult> {
    return this.withConnection(options.timeoutMs, async (conn) => {
      if (options.readOnly) await conn.execute('SET TRANSACTION READ ONLY');
      try {
        const result = await conn.execute<Record<string, unknown>>(sql, [], {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: options.rowLimit + 1,
          autoCommit: false,
        });
        if (options.readOnly) {
          await conn.rollback();
        } else {
          await conn.commit();
        }
        const { rows, truncated } = limitRows(normalizeRows(result.rows ?? []), options.rowLimit);
        return {
          columns: (result.metaData ?? []).map((meta) => meta.name),
          rows,
          rowCount: rows.length,
          truncated,
          ...(options.readOnly ? {} : { affected: result.rowsAffected ?? 0 }),
        };
      } catch (error) {
        await conn.rollback().catch(() => undefined);
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    await this.pool?.close(0);
    this.pool = null;
  }
}
