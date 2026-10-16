export interface ProviderHealthDto {
  provider: string;
  configured: boolean;
  status: 'ok' | 'error' | 'not_configured';
  model: string | null;
  latencyMs: number | null;
  detail: string | null;
  checkedAt: string;
}
