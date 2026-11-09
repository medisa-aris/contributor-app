import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { AuthContext } from '../../common/types/auth-context';
import { paginated } from '../admin/common/pagination';
import {
  CompleteMcpOauthDto,
  CreateMcpServerDto,
  CreateRestConnectorDto,
  StartMcpOauthDto,
  UpdateMcpServerDto,
  UpdateRestConnectorDto,
} from './dto/integrations.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('integration-center')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @RequirePermission(PERMISSIONS.integrationsView)
  @Get('providers')
  providers() {
    return this.integrations.providerStatus();
  }

  @RequirePermission(PERMISSIONS.integrationsView)
  @Get('credentials')
  credentials() {
    return this.integrations.credentialStatus();
  }

  @RequirePermission(PERMISSIONS.integrationsView)
  @Get('mcp-servers')
  async listMcp(@Query() query: PaginationQueryDto) {
    const { items, total } = await this.integrations.listMcpServers({
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Post('mcp-servers')
  createMcp(@CurrentAuth() auth: AuthContext, @Body() dto: CreateMcpServerDto) {
    return this.integrations.createMcpServer(auth, dto);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Patch('mcp-servers/:id')
  updateMcp(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateMcpServerDto,
  ) {
    return this.integrations.updateMcpServer(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @HttpCode(200)
  @Post('mcp-servers/:id/oauth/start')
  startMcpOauth(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: StartMcpOauthDto,
  ) {
    return this.integrations.startMcpOauth(auth, id, dto.redirectUri);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @HttpCode(200)
  @Post('oauth/callback')
  completeMcpOauth(@CurrentAuth() auth: AuthContext, @Body() dto: CompleteMcpOauthDto) {
    return this.integrations.completeMcpOauth(auth, dto.state, dto.code);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @HttpCode(200)
  @Post('mcp-servers/:id/oauth/disconnect')
  disconnectMcpOauth(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.integrations.disconnectMcpOauth(auth, id);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Delete('mcp-servers/:id')
  async deleteMcp(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    await this.integrations.deleteMcpServer(auth, id);
    return { deleted: true };
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @HttpCode(200)
  @Post('mcp-servers/:id/health-check')
  mcpHealth(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.integrations.mcpHealthCheck(auth, id);
  }

  @RequirePermission(PERMISSIONS.integrationsView)
  @Get('rest-connectors')
  async listRest(@Query() query: PaginationQueryDto) {
    const { items, total } = await this.integrations.listRestConnectors({
      skip: query.skip,
      take: query.pageSize,
    });
    return paginated(items, { page: query.page, limit: query.pageSize, offset: query.skip }, total);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Post('rest-connectors')
  createRest(@CurrentAuth() auth: AuthContext, @Body() dto: CreateRestConnectorDto) {
    return this.integrations.createRestConnector(auth, dto);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Patch('rest-connectors/:id')
  updateRest(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateRestConnectorDto,
  ) {
    return this.integrations.updateRestConnector(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Delete('rest-connectors/:id')
  async deleteRest(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    await this.integrations.deleteRestConnector(auth, id);
    return { deleted: true };
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @HttpCode(200)
  @Post('rest-connectors/:id/health-check')
  restHealth(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.integrations.restHealthCheck(auth, id);
  }
}
