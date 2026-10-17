import { apiDelete, apiGet, apiGetPaged, apiPatch, apiPost, apiPut } from '@/api/http';
import type {
  DocumentContent,
  KnowledgeCollectionDetail,
  KnowledgeCollectionRow,
  KnowledgeDocumentRow,
  KnowledgeSearchHit,
  KnowledgeSourceRow,
} from './types';

export function listSources(query: { page: number; pageSize: number }) {
  return apiGetPaged<KnowledgeSourceRow>('/knowledge/sources', query);
}

export function createSource(input: {
  code: string;
  name: string;
  description?: string;
  origin: 'manual' | 'url' | 'upload';
  acl?: { roles?: string[]; departments?: string[] };
}): Promise<KnowledgeSourceRow> {
  return apiPost<KnowledgeSourceRow>('/knowledge/sources', input);
}

export function updateSource(
  id: string,
  input: { name?: string; description?: string; acl?: { roles?: string[]; departments?: string[] } },
): Promise<KnowledgeSourceRow> {
  return apiPatch<KnowledgeSourceRow>(`/knowledge/sources/${id}`, input);
}

export function deleteSource(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/knowledge/sources/${id}`);
}

export function listDocuments(query: {
  sourceId?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  return apiGetPaged<KnowledgeDocumentRow>('/knowledge/documents', query);
}

export function documentContent(id: string): Promise<DocumentContent> {
  return apiGet<DocumentContent>(`/knowledge/documents/${id}/content`);
}

export function createDocument(input: {
  sourceId: string;
  title: string;
  locator?: string;
  content: string;
}): Promise<KnowledgeDocumentRow> {
  return apiPost<KnowledgeDocumentRow>('/knowledge/documents', input);
}

export function updateDocument(
  id: string,
  input: { title?: string; locator?: string; content?: string; status?: string },
): Promise<KnowledgeDocumentRow> {
  return apiPatch<KnowledgeDocumentRow>(`/knowledge/documents/${id}`, input);
}

export function deleteDocument(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/knowledge/documents/${id}`);
}

export function listCollections(query: { page: number; pageSize: number }) {
  return apiGetPaged<KnowledgeCollectionRow>('/knowledge/collections', query);
}

export function collectionDetail(id: string): Promise<KnowledgeCollectionDetail> {
  return apiGet<KnowledgeCollectionDetail>(`/knowledge/collections/${id}`);
}

export function createCollection(input: {
  code: string;
  name: string;
  description?: string;
}): Promise<KnowledgeCollectionDetail> {
  return apiPost<KnowledgeCollectionDetail>('/knowledge/collections', input);
}

export function updateCollection(
  id: string,
  input: { name?: string; description?: string },
): Promise<KnowledgeCollectionDetail> {
  return apiPatch<KnowledgeCollectionDetail>(`/knowledge/collections/${id}`, input);
}

export function deleteCollection(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/knowledge/collections/${id}`);
}

export function setCollectionSources(
  id: string,
  sourceIds: string[],
): Promise<KnowledgeCollectionDetail> {
  return apiPut<KnowledgeCollectionDetail>(`/knowledge/collections/${id}/sources`, { sourceIds });
}

export function searchKnowledge(input: {
  query: string;
  sourceIds?: string[];
  collectionId?: string;
}): Promise<{ hits: KnowledgeSearchHit[]; total: number }> {
  return apiPost<{ hits: KnowledgeSearchHit[]; total: number }>('/knowledge/search', input);
}

export * from './types';
