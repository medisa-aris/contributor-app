import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Memori terpusat P1 (lanjutan): catatan memori yang dipakai tugas, untuk sitasi di hasil tugas. */
export class MemoryTaskRefs1700000029000 implements MigrationInterface {
  name = 'MemoryTaskRefs1700000029000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS memory_refs jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ai_tasks DROP COLUMN IF EXISTS memory_refs`);
  }
}
