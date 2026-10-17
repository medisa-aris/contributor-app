import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/configure-app';
import { DATA_SOURCE } from '../../../src/database/database.module';
import { AiGatewayService } from '../../../src/modules/ai/gateway.service';
import {
  assertPublicUrl,
  WebSourceService,
  type WebSourceResult,
} from '../../../src/modules/ai/web-source.service';

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
}

export interface MockAiGateway {
  chat: jest.Mock;
  stream: jest.Mock;
  activeModel: jest.Mock;
}

export interface MockWebSource {
  fetch: jest.Mock;
}

export function createMockAiGateway(): MockAiGateway {
  return {
    chat: jest.fn(),
    stream: jest.fn(),
    activeModel: jest.fn().mockReturnValue('model-uji'),
  };
}

/** Crawler palsu yang tetap memvalidasi URL seperti produksi (termasuk proteksi SSRF). */
export function createMockWebSource(page?: Partial<WebSourceResult>): MockWebSource {
  const defaults: WebSourceResult = {
    finalUrl: 'https://93.184.216.34/artikel-uji',
    title: 'Artikel Uji',
    text: 'Artikel uji menjelaskan kebijakan cuti tahunan 12 hari kerja bagi karyawan.',
    contentType: 'text/html',
    bytes: 512,
  };
  return {
    fetch: jest.fn(async (rawUrl: string) => {
      const url = await assertPublicUrl(rawUrl);
      return {
        ...defaults,
        finalUrl: url.toString(),
        ...page,
      };
    }),
  };
}

/** App Nest penuh (guard global aktif) yang menunjuk ke contributor_ai_test. */
export async function createTestApp(options?: {
  mockAi?: MockAiGateway;
  webSource?: MockWebSource;
}): Promise<TestContext> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options?.mockAi) {
    builder = builder.overrideProvider(AiGatewayService).useValue(options.mockAi);
  }
  if (options?.webSource) {
    builder = builder.overrideProvider(WebSourceService).useValue(options.webSource);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  const dataSource = app.get<DataSource>(DATA_SOURCE);
  return { app, dataSource };
}
