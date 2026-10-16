import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../../src/database/data-source-options';
import './setup-env';

export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL belum diisi — periksa apps/api/.env');
  }
  const dataSource = new DataSource({ ...buildDataSourceOptions(url), logging: ['error'] });
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    if (applied.length > 0) {
      console.log(`[test] migrasi diterapkan: ${applied.map((m) => m.name).join(', ')}`);
    }
  } finally {
    await dataSource.destroy();
  }
}
