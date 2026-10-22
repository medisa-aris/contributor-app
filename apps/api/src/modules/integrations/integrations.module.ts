import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { McpOauthService } from './mcp-oauth.service';
import { IntegrationsService } from './integrations.service';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, McpOauthService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
