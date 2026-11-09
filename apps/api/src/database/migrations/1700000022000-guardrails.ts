import type { MigrationInterface, QueryRunner } from 'typeorm';

const PERMISSION = 'ai.guardrails.manage';
const MENU_KEY = 'nav.administration.guardrails';

/** Guardrails: kamus terenkripsi per percakapan/tugas, izin khusus admin, menu, dan pengaturan. */
export class Guardrails1700000022000 implements MigrationInterface {
  name = 'Guardrails1700000022000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE guardrail_terms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
        task_id uuid REFERENCES ai_tasks(id) ON DELETE CASCADE,
        token varchar(64) NOT NULL,
        value_encrypted text NOT NULL,
        category varchar(40) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_guardrail_terms_scope CHECK (num_nonnulls(conversation_id, task_id) = 1),
        CONSTRAINT uq_guardrail_terms_conversation UNIQUE (conversation_id, token),
        CONSTRAINT uq_guardrail_terms_task UNIQUE (task_id, token)
      )
    `);
    await queryRunner.query(`
      INSERT INTO app_config (key, value, description, is_public) VALUES
        ('ai.guardrails_enabled', 'false', 'Masking data pribadi sebelum dikirim ke LLM', false),
        ('ai.guardrails_block_images', 'true', 'Blokir lampiran gambar saat Guardrails aktif', false)
      ON CONFLICT (key) DO NOTHING
    `);
    await queryRunner.query(
      `INSERT INTO permissions (identifier, name, description, is_system)
       VALUES ($1, 'Mengelola Guardrails',
               'Mengaktifkan masking data pribadi sebelum dikirim ke LLM dan mengatur kategorinya', true)
       ON CONFLICT (identifier) DO NOTHING`,
      [PERMISSION],
    );
    await queryRunner.query(
      `UPDATE permissions p
          SET application_id = a.id, module_id = m.id
         FROM applications a
         JOIN modules m ON m.application_id = a.id AND m.identifier = 'platform'
        WHERE a.identifier = 'administration' AND p.identifier = $1`,
      [PERMISSION],
    );
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
        WHERE p.identifier = $1 AND r.code = 'administrator'
       ON CONFLICT ON CONSTRAINT uq_role_permissions DO NOTHING`,
      [PERMISSION],
    );
    await queryRunner.query(
      `INSERT INTO menu_items
         (key, application_id, module_id, label_default, i18n_key, icon,
          route_path, required_permission, sort_order, is_active, is_future)
       SELECT $1, application_id, module_id, 'Guardrails', 'nav.administration.guardrails', 'shield',
              '/administration/guardrails', $2, sort_order + 1, true, false
         FROM menu_items
        WHERE key = 'nav.administration.providers'
       ON CONFLICT (key) DO NOTHING`,
      [MENU_KEY, PERMISSION],
    );
    await queryRunner.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM menu_items WHERE key = $1`, [MENU_KEY]);
    await queryRunner.query(`DELETE FROM permissions WHERE identifier = $1`, [PERMISSION]);
    await queryRunner.query(`DELETE FROM app_config WHERE key LIKE 'ai.guardrails\\_%'`);
    await queryRunner.query(`DROP TABLE IF EXISTS guardrail_terms`);
    await queryRunner.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`,
    );
  }
}
