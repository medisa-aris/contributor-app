import type { MigrationInterface, QueryRunner } from 'typeorm';

/** [kunci menu, label sebelumnya, label baru] — hanya baris yang masih bernilai lama yang diubah. */
const MENU_LABELS: readonly [string, string, string][] = [
  ['nav.ai-workspace.second-brain', 'Pustaka', 'Multi Brain'],
  ['nav.ai-workspace.counterpart', 'Mitra Pikir', 'Partner'],
  ['nav.ai-workspace.subordinate', 'Asisten Eksekusi', 'Subordinate'],
];

/** [identifier, kolom, nilai sebelumnya, nilai baru] */
const PERMISSION_TEXT: readonly [string, 'name' | 'description', string, string][] = [
  ['ai.secondbrain.query', 'name', 'Bertanya ke Pustaka', 'Bertanya ke Multi Brain'],
  ['ai.secondbrain.query', 'description', 'Bertanya pengetahuan perusahaan lewat mode Pustaka', 'Bertanya pengetahuan perusahaan lewat mode Multi Brain'],
  ['ai.counterpart.analyze', 'name', 'Berdiskusi dengan Mitra Pikir', 'Berdiskusi dengan Partner'],
  ['ai.counterpart.analyze', 'description', 'Analisis dan debat konsep lewat mode Mitra Pikir', 'Analisis dan debat konsep lewat mode Partner'],
  ['ai.subordinate.execute', 'description', 'Eksekusi tugas lewat mode Asisten Eksekusi', 'Eksekusi tugas lewat mode Subordinate'],
];

const MODULE_DESCRIPTION: readonly [string, string] = [
  'Pustaka, Mitra Pikir, dan Asisten Eksekusi',
  'Multi Brain, Partner, dan Subordinate',
];

export class ModeLabelsEnglish1700000010000 implements MigrationInterface {
  name = 'ModeLabelsEnglish1700000010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.apply(queryRunner, false);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.apply(queryRunner, true);
  }

  private async apply(queryRunner: QueryRunner, reverse: boolean): Promise<void> {
    for (const [key, oldLabel, newLabel] of MENU_LABELS) {
      await queryRunner.query(
        `UPDATE menu_items SET label_default = $3, updated_at = now() WHERE key = $1 AND label_default = $2`,
        [key, reverse ? newLabel : oldLabel, reverse ? oldLabel : newLabel],
      );
    }
    for (const [id, column, oldText, newText] of PERMISSION_TEXT) {
      await queryRunner.query(
        `UPDATE permissions SET ${column} = $3 WHERE identifier = $1 AND ${column} = $2`,
        [id, reverse ? newText : oldText, reverse ? oldText : newText],
      );
    }
    const [oldDesc, newDesc] = MODULE_DESCRIPTION;
    await queryRunner.query(`UPDATE modules SET description = $2 WHERE description = $1`, [
      reverse ? newDesc : oldDesc,
      reverse ? oldDesc : newDesc,
    ]);
  }
}
