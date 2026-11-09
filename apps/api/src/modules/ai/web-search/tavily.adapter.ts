import { malformed, requestJson, text } from './http';
import type { WebHit, WebPage, WebRequestContext, WebSearchAdapter } from './types';

const BASE_URL = 'https://api.tavily.com';

function post(path: string, body: unknown, ctx: WebRequestContext): Promise<unknown> {
  return requestJson(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctx.signal,
  });
}

export const tavilyAdapter: WebSearchAdapter = {
  id: 'tavily',
  label: 'Tavily',

  async search(query, ctx): Promise<WebHit[]> {
    const body = (await post('/search', { query, max_results: ctx.maxResults }, ctx)) as {
      results?: unknown;
    } | null;
    if (!Array.isArray(body?.results)) throw malformed();
    return (body.results as Array<Record<string, unknown>>).map((item) => ({
      title: text(item.title),
      url: text(item.url),
      snippet: text(item.content),
    }));
  },

  async extract(url, ctx): Promise<WebPage> {
    const body = (await post('/extract', { urls: url, format: 'markdown' }, ctx)) as {
      results?: unknown;
    } | null;
    // HTTP 200 tetap dapat berisi kegagalan per-URL di `failed_results`.
    const first = Array.isArray(body?.results)
      ? (body.results as Array<Record<string, unknown>>)[0]
      : undefined;
    const content = text(first?.raw_content);
    if (!content) throw malformed();
    return { url: text(first?.url) || url, title: '', content };
  },
};
