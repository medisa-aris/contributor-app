import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserJobTitle1700000013000 implements MigrationInterface {
  name = 'UserJobTitle1700000013000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN job_title varchar(150)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS job_title`);
  }
}
