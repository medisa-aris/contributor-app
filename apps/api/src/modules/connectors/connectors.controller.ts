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
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@bara/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import type { ConnectorType } from './connector-access.service';
import { ConnectorsService } from './connectors.service';
import { McpClientService, type McpToolPolicy } from './mcp-client.service';
import {
  CreateConnectorGrantDto,
  CreateDbConnectorDto,
  UpdateDbConnectorDto,
} from './dto/connectors.dto';

function connectorType(raw: string): ConnectorType {
  if (raw === 'database' || raw === 'mcp') return raw;
  throw new AppError(ERROR_CODES.validation, 'Jenis konektor harus database atau mcp.', 400);
}

@ApiTags('integration-center')
@Controller()
export class ConnectorsController {
  constructor(
    private readonly connectors: ConnectorsService,
    private readonly mcp: McpClientService,
  ) {}

  // ── Admin: konektor database ──

  @RequirePermission(PERMISSIONS.integrationsView)
  @Get('integrations/db-connectors')
  list() {
    return this.connectors.listDb();
  }

  @RequirePermission(PERMISSIONS.integrationsView)
  @Get('integrations/db-connectors/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.connectors.dbDetail(id);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Post('integrations/db-connectors')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDbConnectorDto) {
    return this.connectors.createDb(auth, dto);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Patch('integrations/db-connectors/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDbConnectorDto,
  ) {
    return this.connectors.updateDb(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Delete('integrations/db-connectors/:id')
  @HttpCode(204)
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.connectors.deleteDb(auth, id);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Post('integrations/db-connectors/:id/test')
  test(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.connectors.testDb(auth, id);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Get('integrations/db-connectors/:id/tables')
  tables(@Param('id', ParseUUIDPipe) id: string) {
    return this.connectors.tablesDb(id);
  }

  // ── Admin: grant akses konektor (database & MCP) ──

  @RequirePermission(PERMISSIONS.integrationsView)
  @Get('integrations/connectors/:type/:id/grants')
  grants(@Param('type') type: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.connectors.listGrants(connectorType(type), id);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Post('integrations/connectors/:type/:id/grants')
  addGrant(
    @CurrentAuth() auth: AuthContext,
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateConnectorGrantDto,
  ) {
    return this.connectors.addGrant(auth, connectorType(type), id, dto);
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Delete('integrations/connectors/:type/:id/grants/:grantId')
  @HttpCode(204)
  async deleteGrant(
    @CurrentAuth() auth: AuthContext,
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
  ) {
    await this.connectors.deleteGrant(auth, connectorType(type), id, grantId);
  }

  // ── Admin: tool server MCP ──

  @RequirePermission(PERMISSIONS.integrationsView)
  @Get('integrations/mcp-servers/:id/tools')
  async mcpTools(@Param('id', ParseUUIDPipe) id: string) {
    const server = await this.mcp.server(id);
    return {
      syncedAt: server.tools_synced_at,
      tools: server.tools_cache,
      policies: server.tool_policies,
    };
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Post('integrations/mcp-servers/:id/tools/sync')
  async syncMcpTools(@Param('id', ParseUUIDPipe) id: string) {
    const server = await this.mcp.syncTools(id);
    return {
      syncedAt: server.tools_synced_at,
      tools: server.tools_cache,
      policies: server.tool_policies,
    };
  }

  @RequirePermission(PERMISSIONS.integrationsConfigure)
  @Put('integrations/mcp-servers/:id/tools/policies')
  async setMcpPolicies(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { policies?: unknown },
  ) {
    const raw = body?.policies;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AppError(
        ERROR_CODES.validation,
        'policies harus berupa objek { namaTool: { enabled, approval } }.',
        400,
      );
    }
    const policies: Record<string, McpToolPolicy> = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) {
      const policy = value as Partial<McpToolPolicy> | null;
      if (!policy || typeof policy.enabled !== 'boolean' || typeof policy.approval !== 'boolean') {
        throw new AppError(ERROR_CODES.validation, `Kebijakan tool ${name} tidak valid.`, 400);
      }
      policies[name.slice(0, 200)] = { enabled: policy.enabled, approval: policy.approval };
    }
    const server = await this.mcp.setPolicies(id, policies);
    return {
      syncedAt: server.tools_synced_at,
      tools: server.tools_cache,
      policies: server.tool_policies,
    };
  }

  // ── User: konektor yang boleh dipakai ──

  @RequirePermission(PERMISSIONS.connectorsUse)
  @Get('connectors/available')
  available(@CurrentAuth() auth: AuthContext) {
    return this.connectors.availableFor(auth.user.id);
  }
}
