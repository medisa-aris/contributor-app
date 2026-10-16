import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/configure-app';
import { DATA_SOURCE } from '../../../src/database/database.module';

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
}

/** App Nest penuh (guard global aktif) yang menunjuk ke contributor_ai_test. */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  const dataSource = app.get<DataSource>(DATA_SOURCE);
  return { app, dataSource };
}
