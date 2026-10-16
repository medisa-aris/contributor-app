import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { Client } from 'pg';

loadEnv({ path: join(__dirname, '../../.env') });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set (apps/api/.env)');
  }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  await client.connect();
  const result = await client.query<{ db: string; version: string }>(
    'select current_database() as db, version() as version',
  );
  const row = result.rows[0];
  console.log(`OK - connected to database "${row?.db}"`);
  console.log(`PostgreSQL: ${String(row?.version).split(' ').slice(0, 2).join(' ')}`);
  await client.end();
}

main().catch((err: Error) => {
  console.error(`DB check failed: ${err.message}`);
  process.exit(1);
});
