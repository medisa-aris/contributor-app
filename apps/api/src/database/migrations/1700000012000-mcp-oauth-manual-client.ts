import type { MigrationInterface, QueryRunner } from 'typeorm';

export class McpOauthManualClient1700000012000 implements MigrationInterface {
  name = 'McpOauthManualClient1700000012000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE mcp_servers
  ADD COLUMN oauth_client_secret text,
  ADD COLUMN oauth_client_manual boolean NOT NULL DEFAULT false;
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE mcp_servers
  DROP COLUMN IF EXISTS oauth_client_secret,
  DROP COLUMN IF EXISTS oauth_client_manual;
`);
  }
}
