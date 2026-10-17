import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatExperience1700000004000 implements MigrationInterface {
  name = 'ChatExperience1700000004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE conversations ADD COLUMN starred_at timestamptz;
CREATE INDEX idx_conversations_user_starred
  ON conversations (user_id, starred_at DESC)
  WHERE starred_at IS NOT NULL;
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS idx_conversations_user_starred;
ALTER TABLE conversations DROP COLUMN IF EXISTS starred_at;
`);
  }
}
