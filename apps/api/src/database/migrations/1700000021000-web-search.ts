import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Pencarian web: opsi per percakapan/tugas, izin `ai.websearch.use`, dan urutan penyedia. */
export class WebSearch1700000021000 implements MigrationInterface {
  name = 'WebSearch1700000021000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations ADD COLUMN web_search boolean NOT NULL DEFAULT false;
      ALTER TABLE ai_tasks ADD COLUMN web_search boolean NOT NULL DEFAULT false;
    `);
    await queryRunner.query(`
      INSERT INTO app_config (key, value, description, is_public) VALUES
        ('ai.web_search_priority', '["tavily","firecrawl","brave"]',
         'Urutan prioritas penyedia pencarian web', false)
      ON CONFLICT (key) DO NOTHING
    `);
    await queryRunner.query(
      `INSERT INTO permissions (identifier, name, description, is_system) VALUES
         ('ai.websearch.use', 'Mencari di Internet',
          'Mengaktifkan pencarian web pada percakapan dan tugas AI (pertanyaan dikirim ke penyedia pencarian pihak ketiga)', true)
       ON CONFLICT (identifier) DO NOTHING`,
    );
    await queryRunner.query(
      `UPDATE permissions p
          SET application_id = a.id, module_id = m.id
         FROM applications a
         JOIN modules m ON m.application_id = a.id AND m.identifier = 'modes'
        WHERE a.identifier = 'ai-workspace'
          AND p.identifier = 'ai.websearch.use'`,
    );
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
         FROM roles r
         JOIN permissions p ON p.identifier = 'ai.websearch.use'
        WHERE r.code IN ('administrator', 'manager')
       ON CONFLICT ON CONSTRAINT uq_role_permissions DO NOTHING`,
    );
    await queryRunner.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM permissions WHERE identifier = 'ai.websearch.use'`);
    await queryRunner.query(`DELETE FROM app_config WHERE key = 'ai.web_search_priority'`);
    await queryRunner.query(`
      ALTER TABLE ai_tasks DROP COLUMN IF EXISTS web_search;
      ALTER TABLE conversations DROP COLUMN IF EXISTS web_search;
    `);
    await queryRunner.query(
      `UPDATE rbac_meta SET version = version + 1, updated_at = now() WHERE id = 1`,
    );
  }
}
