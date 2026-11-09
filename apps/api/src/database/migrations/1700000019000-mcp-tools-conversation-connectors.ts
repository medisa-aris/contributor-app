import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - Cache daftar tool server MCP beserta kebijakan per tool (aktif / butuh persetujuan).
 * - Konektor yang dipasang per percakapan (Multi Brain / Partner).
 * - Jejak pemanggilan tool pada pesan asisten.
 */
export class McpToolsConversationConnectors1700000019000 implements MigrationInterface {
  name = 'McpToolsConversationConnectors1700000019000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mcp_servers
        ADD COLUMN tools_cache jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN tools_synced_at timestamptz,
        ADD COLUMN tool_policies jsonb NOT NULL DEFAULT '{}'::jsonb;

      CREATE TABLE conversation_connectors (
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        connector_type connector_kind NOT NULL,
        connector_id uuid NOT NULL,
        access connector_access NOT NULL DEFAULT 'read',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (conversation_id, connector_type, connector_id)
      );

      ALTER TABLE conversation_messages ADD COLUMN tool_trace jsonb;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversation_messages DROP COLUMN IF EXISTS tool_trace;
      DROP TABLE IF EXISTS conversation_connectors;
      ALTER TABLE mcp_servers
        DROP COLUMN IF EXISTS tool_policies,
        DROP COLUMN IF EXISTS tools_synced_at,
        DROP COLUMN IF EXISTS tools_cache;
    `);
  }
}
