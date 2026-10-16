import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { setupSwagger } from './common/swagger/setup-swagger';
import { configureApp } from './configure-app';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);
  setupSwagger(app);

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on http://localhost:${port} (OpenAPI: /api/docs)`);
}

void bootstrap();
