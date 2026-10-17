import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AiChatAttachments1700000005000 implements MigrationInterface {
  name = 'AiChatAttachments1700000005000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE conversation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  file_name varchar(255) NOT NULL,
  mime_type varchar(150) NOT NULL,
  extension varchar(10) NOT NULL,
  size_bytes bigint NOT NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('document', 'image')),
  storage_path varchar(500) NOT NULL,
  extraction_status varchar(20) NOT NULL CHECK (extraction_status IN ('ready', 'image', 'failed')),
  extracted_chars integer NOT NULL DEFAULT 0,
  extracted_text text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversation_attachments_conv
  ON conversation_attachments (conversation_id, created_at);
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS idx_conversation_attachments_conv;
DROP TABLE IF EXISTS conversation_attachments;
`);
  }
}
