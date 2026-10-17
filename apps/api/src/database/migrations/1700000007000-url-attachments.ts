import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UrlAttachments1700000007000 implements MigrationInterface {
  name = 'UrlAttachments1700000007000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE conversation_attachments
  ADD COLUMN source_type varchar(10) NOT NULL DEFAULT 'file'
    CHECK (source_type IN ('file', 'url')),
  ADD COLUMN source_url text,
  ADD COLUMN summary text,
  ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE conversation_attachments
  ADD CONSTRAINT chk_conversation_attachments_source CHECK (
    (source_type = 'file' AND storage_path IS NOT NULL) OR
    (source_type = 'url' AND source_url IS NOT NULL)
  );
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DELETE FROM conversation_attachments WHERE source_type = 'url';
ALTER TABLE conversation_attachments DROP CONSTRAINT IF EXISTS chk_conversation_attachments_source;
ALTER TABLE conversation_attachments ALTER COLUMN storage_path SET NOT NULL;
ALTER TABLE conversation_attachments
  DROP COLUMN IF EXISTS summary,
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS source_type;
`);
  }
}
