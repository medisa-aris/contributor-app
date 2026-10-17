export type KnowledgeAcl = {
  roles?: string[];
  departments?: string[];
};

export type KnowledgeSourceRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  origin: 'manual' | 'url' | 'upload';
  acl: KnowledgeAcl;
  doc_count: number | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeDocumentRow = {
  id: string;
  source_id: string;
  source_name: string | null;
  title: string;
  locator: string | null;
  status: 'pending' | 'indexed' | 'failed';
  index_error: string | null;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeCollectionRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  source_count: number | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeCollectionDetail = KnowledgeCollectionRow & {
  source_ids: string[];
};

export type KnowledgeSearchHit = {
  document_id: string;
  title: string;
  locator: string | null;
  snippet: string;
  rank: number;
  source_id: string;
  source_name: string;
  source_code: string;
};

export type DocumentContent = {
  title: string;
  content: string;
};
