import type { DbConnectionConfig, DbDriver } from './types';

export * from './types';

/**
 * Buat driver sesuai engine. Driver dimuat secara lazy agar library berat (mssql/oracledb)
 * hanya dimuat bila konektor dengan engine itu benar-benar dipakai.
 */
export async function createDriver(config: DbConnectionConfig): Promise<DbDriver> {
  switch (config.engine) {
    case 'postgres': {
      const { PostgresDriver } = await import('./postgres.driver');
      return new PostgresDriver(config);
    }
    case 'mysql': {
      const { MysqlDriver } = await import('./mysql.driver');
      return new MysqlDriver(config);
    }
    case 'mssql': {
      const { MssqlDriver } = await import('./mssql.driver');
      return new MssqlDriver(config);
    }
    case 'oracle': {
      const { OracleDriver } = await import('./oracle.driver');
      return new OracleDriver(config);
    }
  }
}
