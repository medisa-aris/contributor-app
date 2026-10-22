import { apiGet } from '@/api/http';
import type {
  MindMapOrg,
  MindMapPersonThoughts,
  MindMapQuery,
  MindMapTopics,
} from './types';

function params(query: MindMapQuery): Record<string, string | number> {
  const all = query.modes.length === 0 || query.modes.length === 3;
  return all ? { days: query.days } : { days: query.days, modes: query.modes.join(',') };
}

export function mindMapOrg(query: MindMapQuery): Promise<MindMapOrg> {
  return apiGet<MindMapOrg>('/mind-map/org', params(query));
}

export function mindMapPersonThoughts(
  userId: string,
  query: MindMapQuery,
): Promise<MindMapPersonThoughts> {
  return apiGet<MindMapPersonThoughts>(`/mind-map/people/${userId}/thoughts`, params(query));
}

export function mindMapTopics(q: string, query: MindMapQuery): Promise<MindMapTopics> {
  return apiGet<MindMapTopics>('/mind-map/topics', { ...params(query), q });
}
