import type { MigrationInterface, QueryRunner } from 'typeorm';

const MANAGE_PERMISSION = 'ai.models.manage';
const GRANT_PERMISSION = 'ai.models.grant.manage';
const ADMIN_MENU_KEY = 'nav.administration.models';
const GRANTS_MENU_KEY = 'nav.ai-workspace.model-grants';

/**
 * Multi-model per penyedia (docs/LLM-MultiModel-requirement.md):
 * - katalog model (`ai_models`) dengan satu model bawaan;
 * - izin model per orang / departemen / agent / semua orang dengan kuota harian atau mingguan;
 * - buku besar pemakaian token (`ai_usage_ledger`) sebagai satu-satunya sumber kuota;
 * - kolom pilihan model pada percakapan, pesan, tugas, agent, dan preferensi pengguna.
 *
 * Model bawaan diisi saat aplikasi berjalan dari AI_PROVIDER/AI_MODEL bila katalog kosong
 * (ModelCatalogService), sehingga migrasi tidak bergantung pada env.
 */
export class MultiModel1700000026000 implements MigrationInterface {
  name = 'MultiModel1700000026000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE ai_provider_code AS ENUM ('openrouter', 'openai', 'anthropic', 'ollama');
      CREATE TYPE ai_model_status AS ENUM ('draft', 'enabled', 'disabled');
      CREATE TYPE grant_target AS ENUM ('user', 'department', 'agent', 'everyone');
      CREATE TYPE quota_period AS ENUM ('day', 'week');
      CREATE TYPE ai_usage_source AS ENUM
        ('conversation', 'regenerate', 'task', 'agent_subtask', 'attachment_summary',
         'memory', 'model_test', 'system');

      CREATE TABLE ai_models (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider             ai_provider_code NOT NULL,
        model_key            varchar(200) NOT NULL,
        display_name         varchar(120) NOT NULL,
        description          text,
        status               ai_model_status NOT NULL DEFAULT 'draft',
        is_default           boolean NOT NULL DEFAULT false,
        leader_grantable     boolean NOT NULL DEFAULT true,
        supports_tools       boolean NOT NULL DEFAULT false,
        supports_vision      boolean NOT NULL DEFAULT false,
        supports_stream      boolean NOT NULL DEFAULT true,
        context_window       integer,
        max_output_tokens    integer,
        cost_tier            smallint CHECK (cost_tier BETWEEN 1 AND 3),
        last_test_at         timestamptz,
        last_test_ok         boolean,
        last_test_latency_ms integer,
        last_test_error      text,
        sort_order           integer NOT NULL DEFAULT 0,
        created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_ai_models_provider_key UNIQUE (provider, model_key),
        CONSTRAINT ck_ai_models_default_enabled CHECK (NOT is_default OR status = 'enabled')
      );
      CREATE UNIQUE INDEX uq_ai_models_default ON ai_models (is_default) WHERE is_default;

      CREATE TABLE ai_model_grants (
        id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        target_type             grant_target NOT NULL,
        target_id               uuid,
        include_sub_departments boolean NOT NULL DEFAULT true,
        model_id                uuid NOT NULL REFERENCES ai_models(id) ON DELETE CASCADE,
        token_limit             bigint CHECK (token_limit IS NULL OR token_limit > 0),
        period                  quota_period NOT NULL DEFAULT 'day',
        granted_scope           varchar(10) NOT NULL CHECK (granted_scope IN ('admin', 'leader')),
        note                    varchar(300),
        created_by              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        updated_by              uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at              timestamptz NOT NULL DEFAULT now(),
        updated_at              timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_ai_model_grants_target CHECK ((target_type = 'everyone') = (target_id IS NULL)),
        CONSTRAINT ck_ai_model_grants_leader CHECK (granted_scope = 'admin' OR target_type <> 'everyone')
      );
      CREATE UNIQUE INDEX uq_ai_model_grants
        ON ai_model_grants (target_type, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
                            model_id, period, granted_scope);
      CREATE INDEX idx_ai_model_grants_target ON ai_model_grants (target_type, target_id);

      CREATE TABLE ai_usage_ledger (
        id                  bigserial PRIMARY KEY,
        user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
        model_id            uuid REFERENCES ai_models(id) ON DELETE SET NULL,
        provider            ai_provider_code NOT NULL,
        model_key           varchar(200) NOT NULL,
        source              ai_usage_source NOT NULL,
        source_id           uuid,
        agent_id            uuid REFERENCES agents(id) ON DELETE SET NULL,
        tokens_in           integer NOT NULL DEFAULT 0,
        tokens_out          integer NOT NULL DEFAULT 0,
        estimated           boolean NOT NULL DEFAULT false,
        counts_toward_quota boolean NOT NULL DEFAULT true,
        created_at          timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ai_usage_user_model_time ON ai_usage_ledger (user_id, model_id, created_at)
        WHERE counts_toward_quota;
      CREATE INDEX idx_ai_usage_agent_model_time ON ai_usage_ledger (agent_id, model_id, created_at)
        WHERE counts_toward_quota AND agent_id IS NOT NULL;
      CREATE INDEX idx_ai_usage_time ON ai_usage_ledger (created_at);

      -- Versi katalog/izin untuk cache lintas instance (pola rbac_meta).
      CREATE TABLE ai_models_meta (
        id smallint PRIMARY KEY CHECK (id = 1),
        version bigint NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO ai_models_meta (id, version) VALUES (1, 1);

      ALTER TABLE conversations         ADD COLUMN model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
      ALTER TABLE conversation_messages ADD COLUMN model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
      ALTER TABLE ai_tasks              ADD COLUMN model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
      ALTER TABLE agents                ADD COLUMN model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
      ALTER TABLE users                 ADD COLUMN preferred_model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      INSERT INTO app_config (key, value, description, is_public) VALUES
        ('ai.default_model.token_limit', 'null', 'Batas token per pengguna untuk model bawaan (null = tanpa batas)', false),
        ('ai.default_model.period', '"day"', 'Periode batas token model bawaan (day/week)', false),
        ('ai.default_model.requests_per_minute', 'null', 'Batas permintaan per menit per pengguna untuk model bawaan (null = tanpa batas)', false)
      ON CONFLICT (key) DO NOTHING
    `);

    await queryRunner.query(
      `INSERT INTO permissions (identifier, name, description, is_system) VALUES
         ($1, 'Mengelola Model AI',
          'Menambah, menguji, mengaktifkan, dan menetapkan model bawaan dari penyedia yang dikonfigurasi di .env', true),
         ($2, 'Memberi Izin Model AI',
          'Memberi izin model AI dan kuota token kepada orang, departemen, atau agent dalam jangkauan; melihat pemakaian', true)
       ON CONFLICT (identifier) DO NOTHING`,
      [MANAGE_PERMISSION, GRANT_PERMISSION],
    );
    await queryRunner.query(
      `UPDATE permissions p SET application_id = a.id, module_id = m.id
         FROM applications a
         JOIN modules m ON m.application_id = a.id AND m.identifier = 'platform'
        WHERE a.identifier = 'administration' AND p.identifier = $1`,
      [MANAGE_PERMISSION],
    );
    await queryRunner.query(
      `UPDATE permissions p SET application_id = a.id, module_id = m.id
         FROM applications a
         JOIN modules m ON m.application_id = a.id AND m.identifier = 'workspace'
        WHERE a.identifier = 'ai-workspace' AND p.identifier = $1`,
      [GRANT_PERMISSION],
    );
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
        WHERE (p.identifier = $1 AND r.code = 'administrator')
           OR (p.identifier = $2 AND r.code IN ('administrator', 'manager'))
       ON CONFLICT ON CONSTRAINT uq_role_permissions DO NOTHING`,
      [MANAGE_PERMISSION, GRANT_PERMISSION],
    );
    await queryRunner.query(
      `INSERT INTO menu_items
         (key, application_id, module_id, label_default, i18n_key, icon,
          route_path, required_permission, sort_order, is_active, is_future)
       SELECT $1, application_id, module_id, 'Model AI', 'nav.administration.models', 'sparkle',
              '/administration/models', $2, sort_order, true, false
         FROM menu_items
        WHERE key = 'nav.administration.providers'
       ON CONFLICT (key) DO NOTHING`,
      [ADMIN_MENU_KEY, MANAGE_PERMISSION],
    );
    await queryRunner.query(
      `INSERT INTO menu_items
         (key, application_id, module_id, label_default, i18n_key, icon,
          route_path, required_permission, sort_order, is_active, is_future)
       SELECT $1, m.application_id, m.id, 'Izin Model Tim', 'nav.aiWorkspace.modelGrants', 'shield',
              '/workspace/model-grants', $2,
              COALESCE((SELECT max(sort_order) FROM menu_items WHERE module_id = m.id), 0) + 1,
              true, false
         FROM modules m
         JOIN applications a ON a.id = m.application_id
        WHERE a.identifier = 'ai-workspace' AND m.identifier = 'workspace'
       ON CONFLICT (key) DO NOTHING`,
      [GRANTS_MENU_KEY, GRANT_PERMISSION],
    );
    await queryRunner.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM menu_items WHERE key = ANY($1::text[])`, [
      [ADMIN_MENU_KEY, GRANTS_MENU_KEY],
    ]);
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE permission_id IN
         (SELECT id FROM permissions WHERE identifier = ANY($1::text[]))`,
      [[MANAGE_PERMISSION, GRANT_PERMISSION]],
    );
    await queryRunner.query(`DELETE FROM permissions WHERE identifier = ANY($1::text[])`, [
      [MANAGE_PERMISSION, GRANT_PERMISSION],
    ]);
    await queryRunner.query(`DELETE FROM app_config WHERE key LIKE 'ai.default\\_model.%'`);
    await queryRunner.query(`
      ALTER TABLE users                 DROP COLUMN IF EXISTS preferred_model_id;
      ALTER TABLE agents                DROP COLUMN IF EXISTS model_id;
      ALTER TABLE ai_tasks              DROP COLUMN IF EXISTS model_id;
      ALTER TABLE conversation_messages DROP COLUMN IF EXISTS model_id;
      ALTER TABLE conversations         DROP COLUMN IF EXISTS model_id;
      DROP TABLE IF EXISTS ai_models_meta;
      DROP TABLE IF EXISTS ai_usage_ledger;
      DROP TABLE IF EXISTS ai_model_grants;
      DROP TABLE IF EXISTS ai_models;
      DROP TYPE IF EXISTS ai_usage_source;
      DROP TYPE IF EXISTS quota_period;
      DROP TYPE IF EXISTS grant_target;
      DROP TYPE IF EXISTS ai_model_status;
      DROP TYPE IF EXISTS ai_provider_code;
    `);
    await queryRunner.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`,
    );
  }
}
