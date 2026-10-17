import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS, PERMISSIONS } from '@contributor/shared';
import type { PublicConfigDto } from '@contributor/shared';
import { DataSource } from 'typeorm';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { ConfigUpdateDto } from './dto/misc.dto';

@ApiTags('config')
@Controller()
export class ConfigController {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  @Public()
  @Get('config/public')
  async publicConfig(): Promise<PublicConfigDto> {
    const rows = (await this.dataSource.query(
      `SELECT key, value FROM app_config WHERE is_public = true`,
    )) as { key: string; value: unknown }[];
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      appName: String(map.get('app.name') ?? 'Contributor AI'),
      defaultLocale: String(map.get('app.default_locale') ?? 'id'),
      defaultTheme: (map.get('app.default_theme') ?? 'system') as PublicConfigDto['defaultTheme'],
      timezone: String(map.get('app.timezone') ?? 'Asia/Jakarta'),
      showTokenUsage: map.get('ai.show_token_usage') !== false,
    };
  }

  @RequirePermission(PERMISSIONS.configRead)
  @Get('admin/config')
  async list() {
    return (await this.dataSource.query(
      `SELECT key, value, description, is_public, updated_at, updated_by FROM app_config ORDER BY key`,
    )) as unknown[];
  }

  @Audit(AUDIT_EVENTS.configUpdated, 'warn')
  @RequirePermission(PERMISSIONS.configManage)
  @Put('admin/config/:key')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: string,
    @Body() dto: ConfigUpdateDto,
  ) {
    const rows = updatedRows<{ key: string }>(
      await this.dataSource.query(
        `UPDATE app_config SET value = $2::jsonb, updated_at = now(), updated_by = $3
          WHERE key = $1
          RETURNING key`,
        [key, JSON.stringify(dto.value), auth.user.id],
      ),
    );
    if (rows.length === 0) throw new AppError(ERROR_CODES.notFound, 'Konfigurasi tidak ditemukan.', 404);
    return { key, value: dto.value };
  }
}
