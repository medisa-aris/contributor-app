import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Label mode lama → baru. Hanya baris yang masih bernilai lama yang diubah, agar sunting admin tetap aman. */
const MENU_LABELS: readonly [string, string, string][] = [
  ['nav.ai-workspace.second-brain', 'Otak Kedua', 'Pustaka'],
  ['nav.ai-workspace.counterpart', 'Mitra Berpikir', 'Mitra Pikir'],
];

const PERMISSIONS: readonly [string, string, string, string, string][] = [
  [
    'ai.secondbrain.query',
    'Bertanya ke Otak Kedua',
    'Bertanya ke Pustaka',
    'Bertanya pengetahuan perusahaan lewat mode Second Brain',
    'Bertanya pengetahuan perusahaan lewat mode Pustaka',
  ],
  [
    'ai.counterpart.analyze',
    'Berdiskusi dengan Mitra Berpikir',
    'Berdiskusi dengan Mitra Pikir',
    'Analisis dan debat konsep lewat mode Counterpart',
    'Analisis dan debat konsep lewat mode Mitra Pikir',
  ],
  [
    'ai.subordinate.execute',
    'Menjalankan Tugas Asisten',
    'Menjalankan Tugas Asisten',
    'Eksekusi tugas lewat mode Subordinate',
    'Eksekusi tugas lewat mode Asisten Eksekusi',
  ],
];

const MODULE_DESCRIPTION: readonly [string, string] = [
  'Second Brain, Counterpart, dan Subordinate',
  'Pustaka, Mitra Pikir, dan Asisten Eksekusi',
];

export class RebrandBaraModeLabels1700000009000 implements MigrationInterface {
  name = 'RebrandBaraModeLabels1700000009000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.apply(queryRunner, false);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.apply(queryRunner, true);
  }

  private async apply(queryRunner: QueryRunner, reverse: boolean): Promise<void> {
    for (const [key, oldLabel, newLabel] of MENU_LABELS) {
      const [from, to] = reverse ? [newLabel, oldLabel] : [oldLabel, newLabel];
      await queryRunner.query(
        `UPDATE menu_items SET label_default = $3, updated_at = now() WHERE key = $1 AND label_default = $2`,
        [key, from, to],
      );
    }
    for (const [id, oldName, newName, oldDesc, newDesc] of PERMISSIONS) {
      await queryRunner.query(
        `UPDATE permissions SET name = $3 WHERE identifier = $1 AND name = $2`,
        [id, reverse ? newName : oldName, reverse ? oldName : newName],
      );
      await queryRunner.query(
        `UPDATE permissions SET description = $3 WHERE identifier = $1 AND description = $2`,
        [id, reverse ? newDesc : oldDesc, reverse ? oldDesc : newDesc],
      );
    }
    const [oldDesc, newDesc] = MODULE_DESCRIPTION;
    await queryRunner.query(`UPDATE modules SET description = $2 WHERE description = $1`, [
      reverse ? newDesc : oldDesc,
      reverse ? oldDesc : newDesc,
    ]);
  }
}
