export type DbEngine = 'postgres' | 'mysql' | 'mssql' | 'oracle';

export const DB_ENGINES: readonly DbEngine[] = ['postgres', 'mysql', 'mssql', 'oracle'];

export const DEFAULT_PORTS: Record<DbEngine, number> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  oracle: 1521,
};

export interface DbConnectionOptions {
  /** Aktifkan TLS ke server database. */
  ssl?: boolean;
  /** SQL Server: percayai sertifikat self-signed. */
  trustServerCertificate?: boolean;
  /** Skema bawaan untuk list_tables (postgres: public, mssql: dbo, oracle: user). */
  schema?: string;
  /** Oracle: pakai service name (default) atau SID. */
  oracleSid?: boolean;
}

export interface DbConnectionConfig {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  options: DbConnectionOptions;
}

export interface DbQueryOptions {
  readOnly: boolean;
  rowLimit: number;
  timeoutMs: number;
}

export interface DbQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Jumlah baris yang dikembalikan (setelah dipotong). */
  rowCount: number;
  /** true bila hasil melebihi rowLimit dan dipotong. */
  truncated: boolean;
  /** Jumlah baris yang terpengaruh untuk query tulis. */
  affected?: number;
}

export interface DbTableInfo {
  schema: string;
  name: string;
  type: 'table' | 'view';
}

export interface DbColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

export interface DbDriver {
  readonly engine: DbEngine;
  /** Uji koneksi; kembalikan versi server. */
  test(timeoutMs: number): Promise<string>;
  listTables(schema: string | undefined, timeoutMs: number): Promise<DbTableInfo[]>;
  describeTable(table: string, timeoutMs: number): Promise<DbColumnInfo[]>;
  query(sql: string, options: DbQueryOptions): Promise<DbQueryResult>;
  close(): Promise<void>;
}

/** Pisahkan `schema.table` menjadi bagian-bagiannya (tanpa kutip). */
export function splitTableName(table: string): { schema?: string; name: string } {
  const parts = table
    .split('.')
    .map((part) => part.trim().replace(/^["`[]|["`\]]$/g, ''))
    .filter(Boolean);
  if (parts.length >= 2) return { schema: parts[parts.length - 2], name: parts[parts.length - 1]! };
  return { name: parts[0] ?? '' };
}

/** Normalisasi nilai baris agar aman diserialisasi ke JSON (BigInt, Buffer, Date). */
export function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<biner ${value.length} byte>`;
  if (typeof value === 'object' && value && 'toJSON' in value) return value;
  return value;
}

export function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = normalizeValue(value);
    return out;
  });
}

export function limitRows(
  rows: Record<string, unknown>[],
  rowLimit: number,
): { rows: Record<string, unknown>[]; truncated: boolean } {
  return rows.length > rowLimit
    ? { rows: rows.slice(0, rowLimit), truncated: true }
    : { rows, truncated: false };
}

/** Statement yang aman dibungkus sebagai subquery untuk membatasi jumlah baris. */
export const WRAPPABLE = /^\s*\(?\s*(SELECT|WITH|VALUES|TABLE)\b/i;
