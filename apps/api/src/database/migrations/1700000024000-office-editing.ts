import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Penyuntingan dokumen lewat OnlyOffice dan templat gaya Office.
 * - user_documents: nomor versi + waktu ubah (kunci dokumen OnlyOffice = id + versi).
 * - user_document_versions: salinan berkas sebelum setiap simpanan, untuk pemulihan.
 * - document_templates: berkas sumber + profil gaya (tema, style, master, header/footer).
 */
export class OfficeEditing1700000024000 implements MigrationInterface {
  name = 'OfficeEditing1700000024000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_documents
        ADD COLUMN version integer NOT NULL DEFAULT 1,
        ADD COLUMN updated_at timestamptz
    `);
    await queryRunner.query(`
      CREATE TABLE user_document_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id uuid NOT NULL REFERENCES user_documents(id) ON DELETE CASCADE,
        version integer NOT NULL,
        storage_path varchar(400) NOT NULL,
        size_bytes integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (document_id, version)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE document_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_kind varchar(12) NOT NULL CHECK (source_kind IN ('upload','document')),
        source_id uuid,
        format varchar(10) NOT NULL CHECK (format IN ('docx','pptx','xlsx')),
        name varchar(200) NOT NULL,
        storage_path varchar(400) NOT NULL,
        size_bytes integer NOT NULL,
        profile_json jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_document_templates_user ON document_templates (user_id, created_at DESC)`,
    );
    await queryRunner.query(`ALTER TABLE conversation_attachments ADD COLUMN style_profile jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE conversation_attachments DROP COLUMN IF EXISTS style_profile`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS document_templates`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_document_versions`);
    await queryRunner.query(`ALTER TABLE user_documents DROP COLUMN IF EXISTS updated_at`);
    await queryRunner.query(`ALTER TABLE user_documents DROP COLUMN IF EXISTS version`);
  }
}
