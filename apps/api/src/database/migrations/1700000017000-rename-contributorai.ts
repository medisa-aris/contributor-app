import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameContributorai1700000017000 implements MigrationInterface {
  name = 'RenameContributorai1700000017000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Hanya menimpa nilai bawaan sebelumnya agar nama kustom dari admin tidak hilang.
    await queryRunner.query(
      `UPDATE app_config SET value = '"ContributorAI"'
        WHERE key = 'app.name' AND value IN ('"BeLead AI"', '"BARA"')`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE app_config SET value = '"BeLead AI"' WHERE key = 'app.name' AND value = '"ContributorAI"'`,
    );
  }
}
