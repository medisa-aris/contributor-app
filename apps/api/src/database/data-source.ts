import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source-options';

loadEnv({ path: join(__dirname, '../../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env first.');
}

export const AppDataSource = new DataSource(buildDataSourceOptions(databaseUrl));
