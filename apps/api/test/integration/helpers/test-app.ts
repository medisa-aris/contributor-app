import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/configure-app';
import { DATA_SOURCE } from '../../../src/database/database.module';
import { AiGatewayService } from '../../../src/modules/ai/gateway.service';

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
}

export interface MockAiGateway {
  chat: jest.Mock;
  stream: jest.Mock;
  activeModel: jest.Mock;
}

export function createMockAiGateway(): MockAiGateway {
  return {
    chat: jest.fn(),
    stream: jest.fn(),
    activeModel: jest.fn().mockReturnValue('model-uji'),
  };
}

/** App Nest penuh (guard global aktif) yang menunjuk ke contributor_ai_test. */
export async function createTestApp(options?: {
  mockAi?: MockAiGateway;
}): Promise<TestContext> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options?.mockAi) {
    builder = builder.overrideProvider(AiGatewayService).useValue(options.mockAi);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  const dataSource = app.get<DataSource>(DATA_SOURCE);
  return { app, dataSource };
}
