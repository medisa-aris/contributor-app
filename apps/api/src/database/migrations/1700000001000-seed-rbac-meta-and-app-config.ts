import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedRbacMetaAndAppConfig1700000001000 implements MigrationInterface {
  name = 'SeedRbacMetaAndAppConfig1700000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
INSERT INTO rbac_meta (id, version) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;

INSERT INTO app_config (key, value, description, is_public) VALUES
  ('app.name', '"Contributor AI"', 'Nama aplikasi yang tampil di antarmuka', true),
  ('app.default_locale', '"id"', 'Bahasa antarmuka bawaan', true),
  ('app.default_theme', '"system"', 'Tema bawaan', true),
  ('app.timezone', '"Asia/Jakarta"', 'Zona waktu tampilan', true),
  ('security.lockout_threshold', '5', 'Jumlah kegagalan login sebelum akun terkunci', false),
  ('security.lockout_minutes', '15', 'Durasi kunci akun dalam menit', false),
  ('security.session_idle_minutes', '480', 'Batas idle sesi dalam menit', false),
  ('security.session_absolute_hours', '168', 'Batas absolut umur sesi dalam jam', false)
ON CONFLICT (key) DO NOTHING;
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DELETE FROM app_config WHERE key IN (
  'app.name', 'app.default_locale', 'app.default_theme', 'app.timezone',
  'security.lockout_threshold', 'security.lockout_minutes',
  'security.session_idle_minutes', 'security.session_absolute_hours'
);
DELETE FROM rbac_meta WHERE id = 1;
`);
  }
}
