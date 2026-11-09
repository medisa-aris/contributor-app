import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { McpClientService } from './mcp-client.service';
import { ConnectorAccessService } from './connector-access.service';
import { ConnectorToolsService } from './connector-tools.service';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [ConnectorsController],
  providers: [ConnectorAccessService, ConnectorsService, ConnectorToolsService, McpClientService],
  exports: [ConnectorAccessService, ConnectorsService, ConnectorToolsService, McpClientService],
})
export class ConnectorsModule {}
