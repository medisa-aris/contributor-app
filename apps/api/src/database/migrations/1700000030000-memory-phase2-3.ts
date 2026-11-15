import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Memori terpusat P2 + P3 (docs/LLM-requirement.md §11):
 * - P2: agent milik bawahan dalam jangkauan (R6, `memory_doors.expose_agents`), memori bersama antar-agent
 *   dalam grup (`agent_groups.share_memory`), dan kotak tinjauan (`memory_doors.review_required`,
 *   `memory_entries.needs_review`): catatan baru baru dapat dibagikan setelah disetujui pemiliknya.
 * - P3: ringkasan profil per subjek (`memory_subjects.summary`, hanya untuk pemiliknya), ringkasan tim
 *   dan tema memori di Peta Pikiran — keduanya tercatat di log akses tanpa konteks percakapan.
 */
export class MemoryPhase23_1700000030000 implements MigrationInterface {
  name = 'MemoryPhase23_1700000030000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE memory_doors
        ADD COLUMN expose_agents boolean NOT NULL DEFAULT false,
        ADD COLUMN review_required boolean NOT NULL DEFAULT false;

      ALTER TABLE memory_entries ADD COLUMN needs_review boolean NOT NULL DEFAULT false;
      CREATE INDEX idx_memory_entries_review ON memory_entries (subject_id, created_at DESC) WHERE needs_review;

      ALTER TABLE agent_groups ADD COLUMN share_memory boolean NOT NULL DEFAULT false;

      ALTER TABLE memory_subjects
        ADD COLUMN summary text,
        ADD COLUMN summary_at timestamptz,
        ADD COLUMN summary_entries integer NOT NULL DEFAULT 0;

      ALTER TABLE memory_access_log ALTER COLUMN context_id DROP NOT NULL;
      ALTER TABLE memory_access_log DROP CONSTRAINT IF EXISTS memory_access_log_context_kind_check;
      ALTER TABLE memory_access_log ADD CONSTRAINT memory_access_log_context_kind_check
        CHECK (context_kind IN ('conversation', 'task', 'digest', 'mind_map'));
    `);
    await queryRunner.query(`ALTER TYPE memory_access_action ADD VALUE IF NOT EXISTS 'digest_read'`);
    await queryRunner.query(`ALTER TYPE memory_access_action ADD VALUE IF NOT EXISTS 'themes_read'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Nilai enum tidak dapat dihapus; baris log P3 dibuang agar batasan lama dapat dipasang lagi.
    await queryRunner.query(`
      DELETE FROM memory_access_log WHERE context_kind IN ('digest', 'mind_map');
      ALTER TABLE memory_access_log DROP CONSTRAINT IF EXISTS memory_access_log_context_kind_check;
      ALTER TABLE memory_access_log ADD CONSTRAINT memory_access_log_context_kind_check
        CHECK (context_kind IN ('conversation', 'task'));
      ALTER TABLE memory_access_log ALTER COLUMN context_id SET NOT NULL;
      ALTER TABLE memory_subjects DROP COLUMN IF EXISTS summary, DROP COLUMN IF EXISTS summary_at,
        DROP COLUMN IF EXISTS summary_entries;
      ALTER TABLE agent_groups DROP COLUMN IF EXISTS share_memory;
      DROP INDEX IF EXISTS idx_memory_entries_review;
      ALTER TABLE memory_entries DROP COLUMN IF EXISTS needs_review;
      ALTER TABLE memory_doors DROP COLUMN IF EXISTS expose_agents, DROP COLUMN IF EXISTS review_required;
    `);
  }
}
