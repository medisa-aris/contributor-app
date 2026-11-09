export type DbEngine = 'postgres' | 'mysql' | 'mssql' | 'oracle';
export type ConnectorType = 'database' | 'mcp';
export type ConnectorAccess = 'read' | 'read_write';
export type GrantSubjectType = 'user' | 'role' | 'department' | 'group';

export const DB_ENGINE_LABELS: Record<DbEngine, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mssql: 'SQL Server',
  oracle: 'Oracle',
};

export const DB_DEFAULT_PORTS: Record<DbEngine, number> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  oracle: 1521,
};

export interface DbConnectionOptions {
  ssl?: boolean;
  trustServerCertificate?: boolean;
  schema?: string;
  oracleSid?: boolean;
}

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

export interface DbConnectorInput {
  code?: string;
  name?: string;
  description?: string;
  engine?: DbEngine;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  options?: DbConnectionOptions;
  allowWrite?: boolean;
  rowLimit?: number;
  timeoutMs?: number;
  enabled?: boolean;
}

export interface DbTableInfo {
  schema: string;
  name: string;
  type: 'table' | 'view';
}

export interface ConnectorGrantRow {
  id: string;
  connector_type: ConnectorType;
  connector_id: string;
  subject_type: GrantSubjectType;
  subject_id: string;
  subject_label: string | null;
  access: ConnectorAccess;
  table_allowlist: string[] | null;
  created_at: string;
}

export interface GrantInput {
  subjectType: GrantSubjectType;
  subjectId: string;
  access: ConnectorAccess;
  tableAllowlist?: string[];
}

export interface AvailableConnector {
  connectorType: ConnectorType;
  connectorId: string;
  code: string;
  name: string;
  description: string | null;
  engine: string;
  access: ConnectorAccess;
  allowWrite: boolean;
  tableAllowlist: string[] | null;
}

/** Konektor yang dipasang pada agent atau percakapan. */
export interface ConnectorAttachment {
  connectorType: ConnectorType;
  connectorId: string;
  access: ConnectorAccess;
}

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export interface McpToolPolicy {
  enabled: boolean;
  approval: boolean;
}

export interface McpToolsState {
  syncedAt: string | null;
  tools: McpToolInfo[];
  policies: Record<string, McpToolPolicy>;
}
