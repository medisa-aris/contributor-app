import { AppDataSource } from './data-source';

async function main(): Promise<void> {
  const dataSource = await AppDataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    if (applied.length === 0) {
      console.log('No pending migrations.');
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const migration of applied) {
        console.log(`  - ${migration.name}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: Error) => {
  console.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
