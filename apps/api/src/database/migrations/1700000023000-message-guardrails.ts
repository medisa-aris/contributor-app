import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Ringkasan masking per pesan asisten: jumlah per kategori, tanpa nilainya. */
export class MessageGuardrails1700000023000 implements MigrationInterface {
  name = 'MessageGuardrails1700000023000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversation_messages ADD COLUMN guardrails jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversation_messages DROP COLUMN IF EXISTS guardrails`);
  }
}
