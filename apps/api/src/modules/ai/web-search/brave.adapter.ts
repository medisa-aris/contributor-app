import { decodeHtmlEntities } from '../web-source.service';
import { malformed, requestJson, text } from './http';
import type { WebHit, WebSearchAdapter } from './types';

const SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

/** Brave menandai kata kunci dengan <strong> di dalam cuplikan. */
function plain(value: unknown): string {
  return decodeHtmlEntities(text(value).replace(/<[^>]+>/g, ''));
}

export const braveAdapter: WebSearchAdapter = {
  id: 'brave',
  label: 'Brave Search',

  async search(query, ctx): Promise<WebHit[]> {
    const params = new URLSearchParams({
      q: query,
      count: String(ctx.maxResults),
      extra_snippets: 'true',
    });
    const body = (await requestJson(`${SEARCH_URL}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Subscription-Token': ctx.apiKey },
      signal: ctx.signal,
    })) as { web?: { results?: unknown } } | null;
    if (!body || typeof body !== 'object') throw malformed();
    if (!Array.isArray(body.web?.results)) return [];
    return (body.web.results as Array<Record<string, unknown>>).map((item) => ({
      title: plain(item.title),
      url: text(item.url),
      snippet: [
        item.description,
        ...(Array.isArray(item.extra_snippets) ? item.extra_snippets : []),
      ]
        .map(plain)
        .filter(Boolean)
        .join(' … '),
    }));
  },
};
