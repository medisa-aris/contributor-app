import { malformed, requestJson, text } from './http';
import {
  WebProviderError,
  type WebHit,
  type WebPage,
  type WebRequestContext,
  type WebSearchAdapter,
} from './types';

const BASE_URL = 'https://api.firecrawl.dev/v2';

async function post(
  path: string,
  body: unknown,
  ctx: WebRequestContext,
): Promise<Record<string, unknown>> {
  const result = (await requestJson(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctx.signal,
  })) as { success?: unknown; data?: unknown } | null;
  if (result?.success === false) {
    throw new WebProviderError('technical', 'Penyedia melaporkan kegagalan.');
  }
  if (!result?.data || typeof result.data !== 'object') throw malformed();
  return result.data as Record<string, unknown>;
}

export const firecrawlAdapter: WebSearchAdapter = {
  id: 'firecrawl',
  label: 'Firecrawl',

  async search(query, ctx): Promise<WebHit[]> {
    const data = await post('/search', { query, limit: ctx.maxResults }, ctx);
    if (!Array.isArray(data.web)) return [];
    return (data.web as Array<Record<string, unknown>>).map((item) => ({
      title: text(item.title),
      url: text(item.url),
      snippet: text(item.description),
    }));
  },

  async extract(url, ctx): Promise<WebPage> {
    const data = await post('/scrape', { url, formats: ['markdown'] }, ctx);
    const content = text(data.markdown);
    if (!content) throw malformed();
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    return { url: text(metadata.sourceURL) || url, title: text(metadata.title), content };
  },
};
