import { apiDelete, apiGet, apiGetPaged, apiPatch, apiPost } from '@/api/http';
import type {
  AiProviderStatus,
  CredentialStatusRow,
  McpServerRow,
  RestConnectorRow,
} from './types';

export function getProviderStatus(): Promise<AiProviderStatus> {
  return apiGet<AiProviderStatus>('/integrations/providers');
}

export function getCredentialStatus(): Promise<CredentialStatusRow[]> {
  return apiGet<CredentialStatusRow[]>('/integrations/credentials');
}

export function listMcpServers(query: { page: number; pageSize: number }) {
  return apiGetPaged<McpServerRow>('/integrations/mcp-servers', query);
}

export function createMcpServer(input: {
  code: string;
  name: string;
  description?: string;
  baseUrl: string;
  authType: 'none' | 'api_key';
  apiKeyEnv?: string;
}): Promise<McpServerRow> {
  return apiPost<McpServerRow>('/integrations/mcp-servers', input);
}

export function updateMcpServer(
  id: string,
  input: {
    name?: string;
    description?: string;
    baseUrl?: string;
    authType?: 'none' | 'api_key';
    apiKeyEnv?: string;
    enabled?: boolean;
  },
): Promise<McpServerRow> {
  return apiPatch<McpServerRow>(`/integrations/mcp-servers/${id}`, input);
}

export function deleteMcpServer(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/integrations/mcp-servers/${id}`);
}

export function mcpHealthCheck(id: string): Promise<McpServerRow> {
  return apiPost<McpServerRow>(`/integrations/mcp-servers/${id}/health-check`);
}

export function listRestConnectors(query: { page: number; pageSize: number }) {
  return apiGetPaged<RestConnectorRow>('/integrations/rest-connectors', query);
}

export function createRestConnector(input: {
  code: string;
  name: string;
  description?: string;
  baseUrl: string;
  toolEndpoints: { name: string; method: 'GET' | 'POST'; path: string }[];
  authType: 'none' | 'api_key';
  apiKeyEnv?: string;
}): Promise<RestConnectorRow> {
  return apiPost<RestConnectorRow>('/integrations/rest-connectors', input);
}

export function updateRestConnector(
  id: string,
  input: {
    name?: string;
    description?: string;
    baseUrl?: string;
    toolEndpoints?: { name: string; method: 'GET' | 'POST'; path: string }[];
    authType?: 'none' | 'api_key';
    apiKeyEnv?: string;
    enabled?: boolean;
  },
): Promise<RestConnectorRow> {
  return apiPatch<RestConnectorRow>(`/integrations/rest-connectors/${id}`, input);
}

export function deleteRestConnector(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/integrations/rest-connectors/${id}`);
}

export function restHealthCheck(id: string): Promise<RestConnectorRow> {
  return apiPost<RestConnectorRow>(`/integrations/rest-connectors/${id}/health-check`);
}

export * from './types';
