export const WEB_PROVIDER_IDS = ['tavily', 'firecrawl', 'brave'] as const;
export type WebProviderId = (typeof WEB_PROVIDER_IDS)[number];

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebPage {
  url: string;
  title: string;
  content: string;
}

/**
 * - `account`: token kosong/salah atau masalah langganan; tidak diulang.
 * - `technical`: gangguan sementara; diulang sampai batas percobaan.
 * - `bad_request`: permintaan ditolak; tidak diulang.
 */
export type WebErrorKind = 'account' | 'technical' | 'bad_request';

/** Pesannya hanya memuat status/kode, tidak pernah isi respons penyedia. */
export class WebProviderError extends Error {
  constructor(
    public readonly kind: WebErrorKind,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'WebProviderError';
  }
}

export interface WebRequestContext {
  apiKey: string;
  signal: AbortSignal;
  maxResults: number;
}

export interface WebSearchAdapter {
  id: WebProviderId;
  label: string;
  search(query: string, ctx: WebRequestContext): Promise<WebHit[]>;
  /** Tidak semua penyedia dapat membaca halaman. */
  extract?(url: string, ctx: WebRequestContext): Promise<WebPage>;
}
