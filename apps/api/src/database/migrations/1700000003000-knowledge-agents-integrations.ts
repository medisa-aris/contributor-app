import type { MigrationInterface, QueryRunner } from 'typeorm';

export class KnowledgeAgentsIntegrations1700000003000 implements MigrationInterface {
  name = 'KnowledgeAgentsIntegrations1700000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TYPE knowledge_origin AS ENUM ('manual', 'url', 'upload');
CREATE TYPE knowledge_doc_status AS ENUM ('pending', 'indexed', 'failed');
CREATE TYPE agent_status AS ENUM ('active', 'inactive');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE connector_auth_type AS ENUM ('none', 'api_key');

CREATE TABLE knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) UNIQUE NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  origin knowledge_origin NOT NULL DEFAULT 'manual',
  acl jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) UNIQUE NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_collection_sources (
  collection_id uuid NOT NULL REFERENCES knowledge_collections(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, source_id)
);

CREATE TABLE knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  title varchar(300) NOT NULL,
  locator varchar(500),
  content text NOT NULL,
  status knowledge_doc_status NOT NULL DEFAULT 'pending',
  index_error text,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_knowledge_documents_source ON knowledge_documents (source_id, created_at DESC);
CREATE INDEX idx_knowledge_documents_fts ON knowledge_documents
  USING gin (to_tsvector('simple', title || ' ' || content));

CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) UNIQUE NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  instruction text NOT NULL,
  tool_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb,
  require_approval boolean NOT NULL DEFAULT false,
  status agent_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_tasks ADD COLUMN agent_id uuid NULL REFERENCES agents(id) ON DELETE SET NULL;

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  agent_id uuid NULL REFERENCES agents(id) ON DELETE SET NULL,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary text NOT NULL,
  status approval_status NOT NULL DEFAULT 'pending',
  decided_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_approvals_pending ON approvals (status, created_at DESC) WHERE status = 'pending';
CREATE INDEX idx_approvals_task ON approvals (task_id);

CREATE TABLE mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) UNIQUE NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  base_url varchar(500) NOT NULL,
  auth_type connector_auth_type NOT NULL DEFAULT 'none',
  api_key_env varchar(120),
  enabled boolean NOT NULL DEFAULT true,
  last_health_at timestamptz,
  last_health_ok boolean,
  last_health_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rest_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) UNIQUE NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  base_url varchar(500) NOT NULL,
  tool_endpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  auth_type connector_auth_type NOT NULL DEFAULT 'none',
  api_key_env varchar(120),
  enabled boolean NOT NULL DEFAULT true,
  last_health_at timestamptz,
  last_health_ok boolean,
  last_health_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS rest_connectors;
DROP TABLE IF EXISTS mcp_servers;
DROP TABLE IF EXISTS approvals;
ALTER TABLE ai_tasks DROP COLUMN IF EXISTS agent_id;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS knowledge_documents;
DROP TABLE IF EXISTS knowledge_collection_sources;
DROP TABLE IF EXISTS knowledge_collections;
DROP TABLE IF EXISTS knowledge_sources;
DROP TYPE IF EXISTS connector_auth_type;
DROP TYPE IF EXISTS approval_status;
DROP TYPE IF EXISTS agent_status;
DROP TYPE IF EXISTS knowledge_doc_status;
DROP TYPE IF EXISTS knowledge_origin;
`);
  }
}
