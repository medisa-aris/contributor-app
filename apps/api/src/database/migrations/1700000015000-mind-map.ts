import type { MigrationInterface, QueryRunner } from 'typeorm';

const PERMISSION = 'ai.mindmap.team.read';
const MENU_KEY = 'nav.ai-workspace.mind-map';
const GRANTED_ROLE_CODES = ['administrator', 'manager'];

export class MindMap1700000015000 implements MigrationInterface {
  name = 'MindMap1700000015000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO permissions (identifier, name, description, is_system)
       VALUES ($1, 'Melihat Peta Pikiran Tim',
               'Melihat judul percakapan dan tugas AI anggota tim dalam cakupan departemen', true)
       ON CONFLICT (identifier) DO NOTHING`,
      [PERMISSION],
    );
    await queryRunner.query(
      `UPDATE permissions p
          SET application_id = a.id, module_id = m.id
         FROM applications a
         JOIN modules m ON m.application_id = a.id AND m.identifier = 'workspace'
        WHERE a.identifier = 'ai-workspace' AND p.identifier = $1`,
      [PERMISSION],
    );
    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
        WHERE p.identifier = $1 AND r.code = ANY($2::text[])
       ON CONFLICT ON CONSTRAINT uq_role_permissions DO NOTHING`,
      [PERMISSION, GRANTED_ROLE_CODES],
    );
    await queryRunner.query(
      `INSERT INTO menu_items
         (key, application_id, module_id, label_default, i18n_key, icon,
          route_path, required_permission, sort_order, is_active, is_future)
       SELECT $1, m.application_id, m.id, 'Peta Pikiran', 'nav.aiWorkspace.mindMap', 'people',
              '/workspace/mind-map', $2,
              COALESCE((SELECT max(sort_order) FROM menu_items WHERE module_id = m.id), 0) + 1,
              true, false
         FROM modules m
         JOIN applications a ON a.id = m.application_id
        WHERE a.identifier = 'ai-workspace' AND m.identifier = 'workspace'
       ON CONFLICT (key) DO NOTHING`,
      [MENU_KEY, PERMISSION],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM menu_items WHERE key = $1`, [MENU_KEY]);
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE identifier = $1)`,
      [PERMISSION],
    );
    await queryRunner.query(`DELETE FROM permissions WHERE identifier = $1`, [PERMISSION]);
  }
}
