import type { ApiEnvelope, ApiErrorBody } from '@bara/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiErrorBody['error']['details'],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

const BASE_URL = '/api';

function backendOrigin(): string {
  if (typeof window === 'undefined') return '';
  const configured = window.localStorage.getItem('ca.api_origin');
  return configured ?? '';
}

function buildUrl(path: string): string {
  const origin = backendOrigin();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${BASE_URL}${normalized}`;
}

/** URL lengkap untuk endpoint API — dipakai klien yang butuh respons mentah (mis. SSE). */
export function apiUrl(path: string): string {
  return buildUrl(path);
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const method = options.method ?? 'GET';
  let url = buildUrl(path);

  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value === null || value === undefined || value === '') continue;
      params.set(key, String(value));
    }
    const queryString = params.toString();
    if (queryString) url += `?${queryString}`;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  return parseResponse<T>(response);
}

/** POST multipart/form-data (unggah berkas) — tanpa header Content-Type manual. */
export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: form,
  });
  const envelope = await parseResponse<T>(response);
  return envelope.data;
}

async function parseResponse<T>(response: Response): Promise<ApiEnvelope<T>> {
  if (response.status === 204) {
    return { data: undefined as T };
  }

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    const error = body?.error;
    if (response.status === 401) unauthorizedHandler?.();
    throw new ApiError(
      response.status,
      error?.code ?? 'internal_error',
      error?.message ?? 'Terjadi kesalahan pada server.',
      error?.details,
      error?.requestId,
    );
  }

  return (payload ?? { data: undefined as T }) as ApiEnvelope<T>;
}

export async function apiGet<T>(path: string, query?: RequestOptions['query']): Promise<T> {
  const envelope = await apiRequest<T>(path, { query });
  return envelope.data;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const envelope = await apiRequest<T>(path, { method: 'POST', body });
  return envelope.data;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const envelope = await apiRequest<T>(path, { method: 'PATCH', body });
  return envelope.data;
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const envelope = await apiRequest<T>(path, { method: 'PUT', body });
  return envelope.data;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const envelope = await apiRequest<T>(path, { method: 'DELETE' });
  return envelope.data;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function apiGetPaged<T>(
  path: string,
  query?: RequestOptions['query'],
): Promise<PaginatedResult<T>> {
  const envelope = await apiRequest<T[]>(path, { query });
  const meta = envelope.meta;
  return {
    items: envelope.data ?? [],
    total: meta?.total ?? envelope.data?.length ?? 0,
    page: meta?.page ?? 1,
    limit: meta?.pageSize ?? (envelope.data?.length || 25),
    totalPages: meta?.totalPages ?? 1,
  };
}
