import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Contributor AI API')
    .setDescription(
      'Enterprise Employee AI Enablement Framework. Fase 1-3: autentikasi, RBAC, konfigurasi navigasi.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('ca_session', {
      type: 'apiKey',
      in: 'cookie',
      name: 'ca_session',
      description: 'Sesi server-side (HttpOnly). Mutasi juga butuh header X-CSRF-Token.',
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });
}
