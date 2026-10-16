import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { entities } from './entities';
import { SnakeNamingStrategy } from './naming.strategy';

export function buildDataSourceOptions(databaseUrl: string, verbose = false): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    migrationsRun: false,
    logging: verbose ? ['error', 'warn', 'schema', 'migration'] : ['error', 'warn', 'migration'],
    extra: {
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    },
  };
}
