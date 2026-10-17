import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AiTokenUsageConfig1700000006000 implements MigrationInterface {
  name = 'AiTokenUsageConfig1700000006000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
INSERT INTO app_config (key, value, description, is_public) VALUES
  ('ai.show_token_usage', 'true', 'Tampilkan total token konteks dan output pada antarmuka chat (Ya/Tidak)', true)
ON CONFLICT (key) DO NOTHING;
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM app_config WHERE key = 'ai.show_token_usage'`);
  }
}
