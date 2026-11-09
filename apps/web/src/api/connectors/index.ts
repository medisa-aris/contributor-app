import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/api/http';
import type {
  AvailableConnector,
  ConnectorGrantRow,
  ConnectorType,
  DbConnectorInput,
  DbConnectorRow,
  DbTableInfo,
  GrantInput,
  McpToolPolicy,
  McpToolsState,
} from './types';

export * from './types';

export function listDbConnectors(): Promise<DbConnectorRow[]> {
  return apiGet<DbConnectorRow[]>('/integrations/db-connectors');
}

export function createDbConnector(input: DbConnectorInput): Promise<DbConnectorRow> {
  return apiPost<DbConnectorRow>('/integrations/db-connectors', input);
}

export function updateDbConnector(id: string, input: DbConnectorInput): Promise<DbConnectorRow> {
  return apiPatch<DbConnectorRow>(`/integrations/db-connectors/${id}`, input);
}

export function deleteDbConnector(id: string): Promise<void> {
  return apiDelete<void>(`/integrations/db-connectors/${id}`);
}

export function testDbConnector(id: string): Promise<DbConnectorRow> {
  return apiPost<DbConnectorRow>(`/integrations/db-connectors/${id}/test`);
}

export function listDbTables(id: string): Promise<DbTableInfo[]> {
  return apiGet<DbTableInfo[]>(`/integrations/db-connectors/${id}/tables`);
}

export function listConnectorGrants(type: ConnectorType, id: string): Promise<ConnectorGrantRow[]> {
  return apiGet<ConnectorGrantRow[]>(`/integrations/connectors/${type}/${id}/grants`);
}

export function addConnectorGrant(
  type: ConnectorType,
  id: string,
  input: GrantInput,
): Promise<ConnectorGrantRow[]> {
  return apiPost<ConnectorGrantRow[]>(`/integrations/connectors/${type}/${id}/grants`, input);
}

export function deleteConnectorGrant(type: ConnectorType, id: string, grantId: string): Promise<void> {
  return apiDelete<void>(`/integrations/connectors/${type}/${id}/grants/${grantId}`);
}

export function listAvailableConnectors(): Promise<AvailableConnector[]> {
  return apiGet<AvailableConnector[]>('/connectors/available');
}

export function getMcpTools(serverId: string): Promise<McpToolsState> {
  return apiGet<McpToolsState>(`/integrations/mcp-servers/${serverId}/tools`);
}

export function syncMcpTools(serverId: string): Promise<McpToolsState> {
  return apiPost<McpToolsState>(`/integrations/mcp-servers/${serverId}/tools/sync`);
}

export function setMcpToolPolicies(
  serverId: string,
  policies: Record<string, McpToolPolicy>,
): Promise<McpToolsState> {
  return apiPut<McpToolsState>(`/integrations/mcp-servers/${serverId}/tools/policies`, { policies });
}
