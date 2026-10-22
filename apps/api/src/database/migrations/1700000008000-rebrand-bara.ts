import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RebrandBara1700000008000 implements MigrationInterface {
  name = 'RebrandBara1700000008000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE app_config SET value = '"BARA"' WHERE key = 'app.name'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE app_config SET value = '"Contributor AI"' WHERE key = 'app.name'`,
    );
  }
}
