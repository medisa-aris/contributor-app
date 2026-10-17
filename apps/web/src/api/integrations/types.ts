export type AiProviderStatus = {
  provider: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  credentials: { openrouter: boolean; openai: boolean; anthropic: boolean };
};

export type CredentialStatusRow = {
  env: string;
  configured: boolean;
};

export type McpServerRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  base_url: string;
  auth_type: 'none' | 'api_key';
  api_key_env: string | null;
  enabled: boolean;
  last_health_at: string | null;
  last_health_ok: boolean | null;
  last_health_detail: string | null;
  created_at: string;
  updated_at: string;
};

export type RestConnectorRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  base_url: string;
  tool_endpoints: { name: string; method: string; path: string }[];
  auth_type: 'none' | 'api_key';
  api_key_env: string | null;
  enabled: boolean;
  last_health_at: string | null;
  last_health_ok: boolean | null;
  last_health_detail: string | null;
  created_at: string;
  updated_at: string;
};
