import { WebProviderError, type WebErrorKind } from './types';

const ACCOUNT_STATUSES = new Set([401, 402, 403, 432, 433]);
const TECHNICAL_STATUSES = new Set([408, 429, 434]);
const ACCOUNT_BODY_CODES = new Set(['SUBSCRIPTION_TOKEN_INVALID', 'QUOTA_LIMITED']);
const MAX_RETRY_AFTER_MS = 5000;

/** Kode di badan respons didahulukan karena status HTTP tidak selalu konsisten antar penyedia. */
export function classifyError(status: number, bodyCode?: string): WebErrorKind {
  if (bodyCode && ACCOUNT_BODY_CODES.has(bodyCode)) return 'account';
  if (ACCOUNT_STATUSES.has(status)) return 'account';
  if (TECHNICAL_STATUSES.has(status) || status >= 500) return 'technical';
  return 'bad_request';
}

function retryAfterMs(status: number, header: string | null): number | undefined {
  if (status !== 429 || !header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function bodyCode(body: unknown): string | undefined {
  const value = body as { code?: unknown; error?: { code?: unknown } } | null;
  const code = value?.error?.code ?? value?.code;
  return typeof code === 'string' ? code : undefined;
}

export async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    if (response.ok) throw new WebProviderError('technical', 'Respons bukan JSON yang valid.');
  }
  if (!response.ok) {
    const code = bodyCode(body);
    throw new WebProviderError(
      classifyError(response.status, code),
      `HTTP ${response.status}${code ? ` (${code})` : ''}`,
      retryAfterMs(response.status, response.headers.get('retry-after')),
    );
  }
  return body;
}

export function malformed(): WebProviderError {
  return new WebProviderError('technical', 'Format respons tidak dikenali.');
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
