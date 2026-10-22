import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RebrandBelead1700000014000 implements MigrationInterface {
  name = 'RebrandBelead1700000014000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Hanya menimpa nilai bawaan lama agar nama kustom dari admin tidak hilang.
    await queryRunner.query(
      `UPDATE app_config SET value = '"BeLead AI"' WHERE key = 'app.name' AND value = '"BARA"'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE app_config SET value = '"BARA"' WHERE key = 'app.name' AND value = '"BeLead AI"'`,
    );
  }
}
