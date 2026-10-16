import { AppDataSource } from './data-source';

async function main(): Promise<void> {
  const dataSource = await AppDataSource.initialize();
  try {
    await dataSource.undoLastMigration({ transaction: 'each' });
    console.log('Reverted the last migration.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: Error) => {
  console.error(`Revert failed: ${err.message}`);
  process.exit(1);
});
