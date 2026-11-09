import type { MigrationInterface, QueryRunner } from 'typeorm';

export class McpOauth1700000011000 implements MigrationInterface {
  name = 'McpOauth1700000011000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE connector_auth_type ADD VALUE IF NOT EXISTS 'oauth'`);
    await queryRunner.query(`
ALTER TABLE mcp_servers
  ADD COLUMN oauth_client_id varchar(300),
  ADD COLUMN oauth_metadata jsonb,
  ADD COLUMN oauth_access_token text,
  ADD COLUMN oauth_refresh_token text,
  ADD COLUMN oauth_expires_at timestamptz,
  ADD COLUMN oauth_scope text,
  ADD COLUMN oauth_connected_at timestamptz;

CREATE TABLE mcp_oauth_states (
  state varchar(100) PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS mcp_oauth_states;
ALTER TABLE mcp_servers
  DROP COLUMN IF EXISTS oauth_client_id,
  DROP COLUMN IF EXISTS oauth_metadata,
  DROP COLUMN IF EXISTS oauth_access_token,
  DROP COLUMN IF EXISTS oauth_refresh_token,
  DROP COLUMN IF EXISTS oauth_expires_at,
  DROP COLUMN IF EXISTS oauth_scope,
  DROP COLUMN IF EXISTS oauth_connected_at;
`);
    // Nilai enum 'oauth' tidak dapat dihapus dengan aman di PostgreSQL; dibiarkan.
  }
}
