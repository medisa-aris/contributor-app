import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableMemoryVector } from '../memory-vector';

const SELF_PERMISSION = 'ai.memory.self.manage';
const DOORS_PERMISSION = 'ai.memory.doors.open';
const MENU_KEY = 'nav.ai-workspace.memory';

/**
 * Memori terpusat dengan pintu (docs/LLM-requirement.md):
 * - Kepala departemen (`departments.head_user_id`) sebagai dasar jangkauan atasan.
 * - Buku memori per subjek (orang/agent), catatan, pintu (izin pemilik), pintu terbuka per
 *   percakapan/tugas, dan log akses.
 * - Kolom embedding + indeks HNSW hanya dibuat bila ekstensi pgvector tersedia; tanpa itu
 *   memori memakai pencarian teks penuh (lihat `npm run db:memory-vector`).
 */
export class CentralMemory1700000025000 implements MigrationInterface {
  name = 'CentralMemory1700000025000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE departments
        ADD COLUMN head_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX idx_departments_head ON departments (head_user_id) WHERE head_user_id IS NOT NULL;

      CREATE TYPE memory_subject_kind AS ENUM ('user', 'agent');
      CREATE TYPE memory_entry_type AS ENUM ('profile', 'preference', 'fact', 'decision', 'episode', 'skill');
      CREATE TYPE memory_sensitivity AS ENUM ('shareable', 'private');
      CREATE TYPE memory_entry_status AS ENUM ('active', 'superseded', 'archived');
      CREATE TYPE memory_source_kind AS ENUM ('conversation', 'task', 'manual', 'agent_profile');
      CREATE TYPE memory_access_action AS ENUM ('door_opened', 'door_closed', 'entries_read');

      CREATE TABLE memory_subjects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind memory_subject_kind NOT NULL,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
        owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((kind = 'user' AND user_id IS NOT NULL AND agent_id IS NULL)
            OR (kind = 'agent' AND agent_id IS NOT NULL AND user_id IS NULL))
      );
      CREATE UNIQUE INDEX uq_memory_subjects_user ON memory_subjects (user_id) WHERE user_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_memory_subjects_agent ON memory_subjects (agent_id) WHERE agent_id IS NOT NULL;
      CREATE INDEX idx_memory_subjects_owner ON memory_subjects (owner_user_id);

      CREATE TABLE memory_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_id uuid NOT NULL REFERENCES memory_subjects(id) ON DELETE CASCADE,
        type memory_entry_type NOT NULL,
        content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
        importance smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
        confidence real NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
        sensitivity memory_sensitivity NOT NULL DEFAULT 'shareable',
        status memory_entry_status NOT NULL DEFAULT 'active',
        supersedes_id uuid REFERENCES memory_entries(id) ON DELETE SET NULL,
        valid_from timestamptz NOT NULL DEFAULT now(),
        valid_to timestamptz,
        source_kind memory_source_kind NOT NULL,
        source_id uuid,
        source_message_id bigint,
        edited_by_owner boolean NOT NULL DEFAULT false,
        tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
        embedding_model varchar(150),
        last_used_at timestamptz,
        use_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_memory_entries_subject ON memory_entries (subject_id, status, created_at DESC);
      CREATE INDEX idx_memory_entries_tsv ON memory_entries USING gin (tsv);

      CREATE TABLE memory_doors (
        subject_id uuid PRIMARY KEY REFERENCES memory_subjects(id) ON DELETE CASCADE,
        enabled boolean NOT NULL DEFAULT false,
        exposed_types memory_entry_type[] NOT NULL
          DEFAULT ARRAY['profile', 'fact', 'decision', 'skill']::memory_entry_type[],
        updated_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE conversation_memory_doors (
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        subject_id uuid NOT NULL REFERENCES memory_subjects(id) ON DELETE CASCADE,
        opened_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opened_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (conversation_id, subject_id)
      );

      CREATE TABLE task_memory_doors (
        task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
        subject_id uuid NOT NULL REFERENCES memory_subjects(id) ON DELETE CASCADE,
        opened_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opened_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (task_id, subject_id)
      );

      CREATE TABLE memory_access_log (
        id bigserial PRIMARY KEY,
        subject_id uuid NOT NULL REFERENCES memory_subjects(id) ON DELETE CASCADE,
        actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action memory_access_action NOT NULL,
        context_kind varchar(20) NOT NULL CHECK (context_kind IN ('conversation', 'task')),
        context_id uuid NOT NULL,
        entry_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_memory_access_subject ON memory_access_log (subject_id, created_at DESC);

      -- Jejak ekstraksi: kuota harian per pengguna dan observabilitas.
      CREATE TABLE memory_extraction_runs (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_kind memory_source_kind NOT NULL,
        source_id uuid NOT NULL,
        added integer NOT NULL DEFAULT 0,
        updated integer NOT NULL DEFAULT 0,
        superseded integer NOT NULL DEFAULT 0,
        tokens_in integer,
        tokens_out integer,
        error text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_memory_extraction_runs_user ON memory_extraction_runs (user_id, created_at DESC);

      -- Penanda sampai pesan mana percakapan sudah dicatat, agar ekstraksi tahan restart.
      ALTER TABLE conversations ADD COLUMN memory_watermark bigint NOT NULL DEFAULT 0;
      ALTER TABLE ai_tasks ADD COLUMN memory_extracted_at timestamptz;
      ALTER TABLE conversation_messages ADD COLUMN memory_refs jsonb;
    `);

    // Percakapan dan tugas lama tidak dicatat ulang secara massal.
    await queryRunner.query(`
      UPDATE conversations c
         SET memory_watermark = COALESCE((SELECT max(m.id) FROM conversation_messages m WHERE m.conversation_id = c.id), 0);
      UPDATE ai_tasks SET memory_extracted_at = now() WHERE status = 'completed';
    `);

    await enableMemoryVector(queryRunner);

    await queryRunner.query(`
      INSERT INTO app_config (key, value, description, is_public) VALUES
        ('ai.memory_enabled', 'true', 'Memori terpusat: catat memori dari percakapan/tugas dan gunakan saat menjawab (Ya/Tidak)', true),
        ('ai.memory_embedding_model', '"openai/text-embedding-3-small"', 'Model embedding untuk pencarian semantik memori (dipakai bila pgvector tersedia)', false),
        ('ai.memory_extractor_model', '""', 'Model untuk mengekstrak catatan memori; kosong = model chat aktif', false),
        ('ai.memory_max_context_tokens', '1500', 'Batas token memori yang disisipkan ke prompt per jawaban', false),
        ('ai.memory_max_extractions_per_day', '50', 'Batas ekstraksi memori per pengguna per hari', false),
        ('ai.memory_retention_days', '0', 'Arsipkan catatan memori jenis peristiwa setelah N hari; 0 = tidak pernah', false)
      ON CONFLICT (key) DO NOTHING
    `);

    await queryRunner.query(
      `INSERT INTO permissions (identifier, name, description, is_system) VALUES
         ($1, 'Mengelola Memori Saya',
          'Melihat, mengubah, dan menghapus catatan memori milik sendiri serta mengatur pintu memori', true),
         ($2, 'Membuka Pintu Memori Tim',
          'Membuka pintu memori bawahan (orang atau agent) yang sudah diizinkan pemiliknya, untuk memperluas memori AI', true)
       ON CONFLICT (identifier) DO NOTHING`,
      [SELF_PERMISSION, DOORS_PERMISSION],
    );
    await queryRunner.query(
      `UPDATE permissions p
          SET application_id = a.id, module_id = m.id
         FROM applications a
         JOIN modules m ON m.application_id = a.id AND m.identifier = 'workspace'
        WHERE a.identifier = 'ai-workspace' AND p.identifier = ANY($1::text[])`,
      [[SELF_PERMISSION, DOORS_PERMISSION]],
    );
    // Memori sendiri: setiap peran yang sudah boleh membuka Ruang Kerja AI.
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT rp.role_id, p.id
         FROM role_permissions rp
         JOIN permissions w ON w.id = rp.permission_id AND w.identifier = 'ai.workspace.access'
         JOIN permissions p ON p.identifier = $1
       ON CONFLICT ON CONSTRAINT uq_role_permissions DO NOTHING`,
      [SELF_PERMISSION],
    );
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
        WHERE p.identifier = $1 AND r.code IN ('administrator', 'manager')
       ON CONFLICT ON CONSTRAINT uq_role_permissions DO NOTHING`,
      [DOORS_PERMISSION],
    );
    await queryRunner.query(
      `INSERT INTO menu_items
         (key, application_id, module_id, label_default, i18n_key, icon,
          route_path, required_permission, sort_order, is_active, is_future)
       SELECT $1, m.application_id, m.id, 'Memori Saya', 'nav.aiWorkspace.memory', 'book',
              '/workspace/memory', $2,
              COALESCE((SELECT max(sort_order) FROM menu_items WHERE module_id = m.id), 0) + 1,
              true, false
         FROM modules m
         JOIN applications a ON a.id = m.application_id
        WHERE a.identifier = 'ai-workspace' AND m.identifier = 'workspace'
       ON CONFLICT (key) DO NOTHING`,
      [MENU_KEY, SELF_PERMISSION],
    );
    await queryRunner.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`,
    );

    // Memori teks bebas agent pribadi → catatan profil di buku memori agent.
    await queryRunner.query(`
      INSERT INTO memory_subjects (kind, agent_id, owner_user_id)
      SELECT 'agent', a.id, a.owner_user_id
        FROM agents a
       WHERE a.owner_user_id IS NOT NULL AND NOT a.is_template
         AND btrim(coalesce(a.memory, '')) <> ''
      ON CONFLICT DO NOTHING;

      INSERT INTO memory_doors (subject_id, enabled, updated_by)
      SELECT s.id, true, s.owner_user_id FROM memory_subjects s WHERE s.kind = 'agent'
      ON CONFLICT DO NOTHING;

      INSERT INTO memory_entries (subject_id, type, content, importance, confidence, source_kind)
      SELECT s.id, 'profile', left(item, 1000), 4, 1, 'agent_profile'
        FROM memory_subjects s
        JOIN agents a ON a.id = s.agent_id
        CROSS JOIN LATERAL regexp_split_to_table(a.memory, E'\\n+') AS line
        CROSS JOIN LATERAL (SELECT btrim(regexp_replace(line, '^[-*•\\s]+', '')) AS item) cleaned
       WHERE item <> '';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM menu_items WHERE key = $1`, [MENU_KEY]);
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE permission_id IN
         (SELECT id FROM permissions WHERE identifier = ANY($1::text[]))`,
      [[SELF_PERMISSION, DOORS_PERMISSION]],
    );
    await queryRunner.query(`DELETE FROM permissions WHERE identifier = ANY($1::text[])`, [
      [SELF_PERMISSION, DOORS_PERMISSION],
    ]);
    await queryRunner.query(`DELETE FROM app_config WHERE key LIKE 'ai.memory_%'`);
    await queryRunner.query(`
      ALTER TABLE conversation_messages DROP COLUMN IF EXISTS memory_refs;
      ALTER TABLE ai_tasks DROP COLUMN IF EXISTS memory_extracted_at;
      ALTER TABLE conversations DROP COLUMN IF EXISTS memory_watermark;
      DROP TABLE IF EXISTS memory_extraction_runs;
      DROP TABLE IF EXISTS memory_access_log;
      DROP TABLE IF EXISTS task_memory_doors;
      DROP TABLE IF EXISTS conversation_memory_doors;
      DROP TABLE IF EXISTS memory_doors;
      DROP TABLE IF EXISTS memory_entries;
      DROP TABLE IF EXISTS memory_subjects;
      DROP TYPE IF EXISTS memory_access_action;
      DROP TYPE IF EXISTS memory_source_kind;
      DROP TYPE IF EXISTS memory_entry_status;
      DROP TYPE IF EXISTS memory_sensitivity;
      DROP TYPE IF EXISTS memory_entry_type;
      DROP TYPE IF EXISTS memory_subject_kind;
      DROP INDEX IF EXISTS idx_departments_head;
      ALTER TABLE departments DROP COLUMN IF EXISTS head_user_id;
    `);
    await queryRunner.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`,
    );
  }
}
