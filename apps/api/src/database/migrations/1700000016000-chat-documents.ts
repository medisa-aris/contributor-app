import type { MigrationInterface, QueryRunner } from 'typeorm';

const PERMISSION = 'ai.documents.manage';
const MENU_KEY = 'nav.ai-workspace.documents';
/** Siapa pun yang boleh memakai Multi Brain / Partner boleh mengelola dokumen hasilnya. */
const SOURCE_PERMISSIONS = ['ai.secondbrain.query', 'ai.counterpart.analyze'];

export class ChatDocuments1700000016000 implements MigrationInterface {
  name = 'ChatDocuments1700000016000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE user_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
        message_id bigint,
        title varchar(200) NOT NULL,
        format varchar(10) NOT NULL
          CHECK (format IN ('md','txt','html','json','csv','xlsx','docx','pptx','pdf')),
        file_name varchar(255) NOT NULL,
        mime_type varchar(150) NOT NULL,
        size_bytes integer NOT NULL,
        storage_path varchar(400) NOT NULL,
        content_text text,
        preview_json jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_user_documents_user ON user_documents (user_id, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_user_documents_conversation ON user_documents (conversation_id)`,
    );

    await queryRunner.query(
      `INSERT INTO permissions (identifier, name, description, is_system)
       VALUES ($1, 'Mengelola Dokumen Saya',
               'Melihat, mengunduh, dan menghapus dokumen hasil percakapan AI milik sendiri', true)
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
       SELECT DISTINCT rp.role_id, target.id
         FROM role_permissions rp
         JOIN permissions src ON src.id = rp.permission_id
         CROSS JOIN (SELECT id FROM permissions WHERE identifier = $1) target
        WHERE src.identifier = ANY($2::text[])
       ON CONFLICT ON CONSTRAINT uq_role_permissions DO NOTHING`,
      [PERMISSION, SOURCE_PERMISSIONS],
    );
    await queryRunner.query(
      `INSERT INTO menu_items
         (key, application_id, module_id, label_default, i18n_key, icon,
          route_path, required_permission, sort_order, is_active, is_future)
       SELECT $1, m.application_id, m.id, 'Dokumen Saya', 'nav.aiWorkspace.documents', 'file',
              '/workspace/documents', $2,
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
    await queryRunner.query(`DROP TABLE IF EXISTS user_documents`);
  }
}
