import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P3 multi-model: reservasi token agar permintaan paralel tidak melampaui kuota, dan opsi izin
 * untuk pindah otomatis ke model bawaan saat kuota model habis.
 */
export class QuotaReservations1700000028000 implements MigrationInterface {
  name = 'QuotaReservations1700000028000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ai_quota_reservations (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        model_id   uuid NOT NULL REFERENCES ai_models(id) ON DELETE CASCADE,
        agent_id   uuid REFERENCES agents(id) ON DELETE CASCADE,
        tokens     integer NOT NULL CHECK (tokens > 0),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ai_quota_reservations_user_model ON ai_quota_reservations (user_id, model_id, expires_at);
      CREATE INDEX idx_ai_quota_reservations_agent_model ON ai_quota_reservations (agent_id, model_id, expires_at)
        WHERE agent_id IS NOT NULL;
      ALTER TABLE ai_model_grants ADD COLUMN fallback_to_default boolean NOT NULL DEFAULT false;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_model_grants DROP COLUMN IF EXISTS fallback_to_default;
      DROP TABLE IF EXISTS ai_quota_reservations;
    `);
  }
}
