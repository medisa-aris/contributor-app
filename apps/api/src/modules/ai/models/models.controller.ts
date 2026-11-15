import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AI_PROVIDER_CODES,
  AUDIT_EVENTS,
  PERMISSIONS,
  type AiProviderCode,
  type AiProviderStatusDto,
} from '@bara/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentAuth } from '../../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import type { AuthContext } from '../../../common/types/auth-context';
import {
  CreateGrantDto,
  CreateModelsDto,
  DefaultLimitsDto,
  EffectiveQueryDto,
  GrantListQueryDto,
  PreferredModelDto,
  SetDefaultDto,
  TestModelDto,
  UpdateGrantDto,
  UpdateModelDto,
  UsageQueryDto,
} from './dto/models.dto';
import { GrantService } from './grant.service';
import { ModelAccessService } from './model-access.service';
import { quotaWindow } from './model-access';
import { ModelCatalogService } from './model-catalog.service';
import { ProviderRegistryService } from './provider-registry.service';
import { UsageLedgerService } from './usage-ledger.service';

function providerCode(code: string): AiProviderCode {
  if (!AI_PROVIDER_CODES.includes(code as AiProviderCode)) {
    throw new AppError(ERROR_CODES.notFound, 'Penyedia tidak dikenal.', 404);
  }
  return code as AiProviderCode;
}

/** Katalog model (admin), izin model (admin/leader), dan pilihan model (pengguna). */
@ApiTags('ai-models')
@Controller()
export class ModelsController {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly catalog: ModelCatalogService,
    private readonly access: ModelAccessService,
    private readonly grantsService: GrantService,
    private readonly ledger: UsageLedgerService,
  ) {}

  // ───────────────────────── Penyedia (baca saja; konfigurasi di .env) ─────────────────────────

  @RequirePermission(PERMISSIONS.providersHealthRead)
  @Get('admin/ai/providers')
  async providers(): Promise<AiProviderStatusDto[]> {
    const models = await this.catalog.list();
    return this.registry.all().map((p) => ({
      code: p.code,
      configured: p.configured,
      baseUrl: p.baseUrl,
      envVar: p.envVar,
      modelCount: models.filter((m) => m.provider === p.code).length,
      enabledModelCount: models.filter((m) => m.provider === p.code && m.status === 'enabled').length,
      lastCheck: this.registry.lastCheck(p.code),
    }));
  }

  /** Bentuk lama untuk satu rilis (alias GET /admin/providers). */
  @RequirePermission(PERMISSIONS.providersHealthRead)
  @Get('admin/providers')
  async legacyProviders() {
    const models = await this.catalog.list();
    const defaultModel = models.find((m) => m.isDefault) ?? null;
    return {
      defaultProvider: defaultModel?.provider ?? null,
      providers: this.registry.all().map((p) => ({
        name: p.code,
        configured: p.configured,
        model: defaultModel?.provider === p.code ? defaultModel.modelKey : null,
        baseUrl: p.baseUrl,
        isDefault: defaultModel?.provider === p.code,
      })),
    };
  }

  @RequirePermission(PERMISSIONS.modelsManage)
  @HttpCode(200)
  @Post('admin/ai/providers/:code/check')
  check(@Param('code') code: string) {
    return this.registry.check(providerCode(code));
  }

  // ───────────────────────── Katalog ─────────────────────────

  @RequirePermission(PERMISSIONS.modelsManage)
  @Get('admin/ai/providers/:code/discover')
  discover(@Param('code') code: string) {
    return this.catalog.discover(providerCode(code));
  }

  @RequirePermission(PERMISSIONS.modelsManage)
  @Get('admin/ai/models')
  async models() {
    return (await this.catalog.list()).map((m) => this.catalog.toDto(m));
  }

  @Audit(AUDIT_EVENTS.aiModelCreated)
  @RequirePermission(PERMISSIONS.modelsManage)
  @Post('admin/ai/models')
  async createModels(@CurrentAuth() auth: AuthContext, @Body() dto: CreateModelsDto) {
    return (await this.catalog.create(auth.user.id, dto.items)).map((m) => this.catalog.toDto(m));
  }

  @Audit(AUDIT_EVENTS.aiModelUpdated)
  @RequirePermission(PERMISSIONS.modelsManage)
  @Patch('admin/ai/models/:id')
  async updateModel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModelDto) {
    return this.catalog.toDto(await this.catalog.update(id, dto));
  }

  @Audit(AUDIT_EVENTS.aiModelTested)
  @RequirePermission(PERMISSIONS.modelsManage)
  @HttpCode(200)
  @Post('admin/ai/models/:id/test')
  async testModel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestModelDto,
  ) {
    const result = await this.catalog.test(id, { vision: dto.vision === true });
    for (const usage of result.usage) {
      await this.ledger.record({
        userId: auth.user.id,
        modelId: result.model.id,
        provider: result.model.provider,
        modelKey: result.model.modelKey,
        source: 'model_test',
        tokensIn: usage.tokensIn ?? 0,
        tokensOut: usage.tokensOut ?? 0,
        estimated: usage.tokensIn === null,
      });
    }
    return { model: this.catalog.toDto(result.model), probes: result.probes };
  }

  @Audit(AUDIT_EVENTS.aiModelEnabled, 'warn')
  @RequirePermission(PERMISSIONS.modelsManage)
  @HttpCode(200)
  @Post('admin/ai/models/:id/enable')
  async enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.toDto(await this.catalog.enable(id));
  }

  @Audit(AUDIT_EVENTS.aiModelDisabled, 'warn')
  @RequirePermission(PERMISSIONS.modelsManage)
  @HttpCode(200)
  @Post('admin/ai/models/:id/disable')
  async disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.toDto(await this.catalog.disable(id));
  }

  @Audit(AUDIT_EVENTS.aiModelDefaultChanged, 'warn')
  @RequirePermission(PERMISSIONS.modelsManage)
  @HttpCode(200)
  @Post('admin/ai/models/:id/default')
  async setDefault(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDefaultDto) {
    if (!dto.confirm) {
      throw new AppError(ERROR_CODES.validation, 'Konfirmasi diperlukan untuk mengganti model bawaan.', 400);
    }
    return this.catalog.toDto(await this.catalog.setDefault(id));
  }

  @Audit(AUDIT_EVENTS.aiModelDeleted, 'warn')
  @RequirePermission(PERMISSIONS.modelsManage)
  @HttpCode(204)
  @Delete('admin/ai/models/:id')
  async removeModel(@Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.remove(id);
  }

  @RequirePermission(PERMISSIONS.modelsManage)
  @Get('admin/ai/default-model-limits')
  defaultLimits() {
    return this.catalog.defaultLimits();
  }

  @Audit(AUDIT_EVENTS.aiDefaultModelLimitsUpdated, 'warn')
  @RequirePermission(PERMISSIONS.modelsManage)
  @Put('admin/ai/default-model-limits')
  setDefaultLimits(@CurrentAuth() auth: AuthContext, @Body() dto: DefaultLimitsDto) {
    return this.catalog.setDefaultLimits(auth.user.id, dto);
  }

  // ───────────────────────── Izin model (admin & leader) ─────────────────────────

  @RequirePermission(PERMISSIONS.modelsGrantManage)
  @Get('ai/model-grants')
  grants(@CurrentAuth() auth: AuthContext, @Query() query: GrantListQueryDto) {
    return this.grantsService.list(auth, query);
  }

  @Audit(AUDIT_EVENTS.aiGrantCreated, 'warn')
  @RequirePermission(PERMISSIONS.modelsGrantManage)
  @Post('ai/model-grants')
  createGrant(@CurrentAuth() auth: AuthContext, @Body() dto: CreateGrantDto) {
    return this.grantsService.create(auth, {
      ...dto,
      targetId: dto.targetType === 'everyone' ? null : dto.targetId,
    });
  }

  @Audit(AUDIT_EVENTS.aiGrantUpdated, 'warn')
  @RequirePermission(PERMISSIONS.modelsGrantManage)
  @Patch('ai/model-grants/:id')
  updateGrant(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGrantDto) {
    return this.grantsService.update(auth, id, dto);
  }

  @Audit(AUDIT_EVENTS.aiGrantDeleted, 'warn')
  @RequirePermission(PERMISSIONS.modelsGrantManage)
  @HttpCode(204)
  @Delete('ai/model-grants/:id')
  async removeGrant(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.grantsService.remove(auth, id);
  }

  @RequirePermission(PERMISSIONS.modelsGrantManage)
  @Get('ai/model-grants/reach')
  reach(@CurrentAuth() auth: AuthContext) {
    return this.grantsService.reach(auth);
  }

  @RequirePermission(PERMISSIONS.modelsGrantManage)
  @Get('ai/model-grants/effective')
  async effective(@CurrentAuth() auth: AuthContext, @Query() query: EffectiveQueryDto) {
    await this.grantsService.assertUserInReach(auth, query.userId);
    return this.access.effective(query.userId);
  }

  @RequirePermission(PERMISSIONS.modelsGrantManage)
  @Get('ai/model-grants/grantable-models')
  async grantableModels(@CurrentAuth() auth: AuthContext) {
    const caller = await this.grantsService.caller(auth);
    return (await this.catalog.list())
      .filter((m) => m.status === 'enabled' && !m.isDefault && (caller.scope === 'admin' || m.leaderGrantable))
      .map((m) => this.catalog.toDto(m));
  }

  @RequirePermission(PERMISSIONS.modelsGrantManage)
  @Get('ai/usage/team')
  async teamUsage(@CurrentAuth() auth: AuthContext, @Query() query: UsageQueryDto) {
    const caller = await this.grantsService.caller(auth);
    const userIds = caller.scope === 'admin' ? null : caller.reach.userIds;
    const window = quotaWindow(query.period, new Date(), await this.access.timezone());
    const totals = userIds && userIds.length === 0 ? [] : await this.ledger.totals(userIds, window.start, query.groupBy);
    const labels = await this.usageLabels(query.groupBy, totals.map((t) => t.key));
    return {
      period: query.period,
      since: window.start.toISOString(),
      resetsAt: window.end.toISOString(),
      rows: totals
        .map((row) => ({ key: row.key, label: labels.get(row.key) ?? '(dihapus)', tokens: row.tokens, limit: null }))
        .sort((a, b) => b.tokens - a.tokens),
    };
  }

  private async usageLabels(groupBy: 'user' | 'model', keys: string[]): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    if (groupBy === 'model') {
      return new Map((await this.catalog.list()).map((m) => [m.id, m.displayName]));
    }
    return this.grantsService.userNames(keys);
  }

  // ───────────────────────── Pengguna ─────────────────────────

  @RequirePermission(PERMISSIONS.workspaceAccess)
  @Get('ai/usage/me')
  usageMe(@CurrentAuth() auth: AuthContext) {
    return this.access.usageMe(auth.user.id);
  }

  @RequirePermission(PERMISSIONS.workspaceAccess)
  @Get('ai/models')
  userModels(@CurrentAuth() auth: AuthContext) {
    return this.access.userModels(auth.user.id);
  }

  @RequirePermission(PERMISSIONS.workspaceAccess)
  @HttpCode(200)
  @Put('ai/preferences/model')
  async setPreferred(@CurrentAuth() auth: AuthContext, @Body() dto: PreferredModelDto) {
    await this.access.setPreferred(auth.user.id, dto.modelId);
    return { modelId: dto.modelId };
  }
}
