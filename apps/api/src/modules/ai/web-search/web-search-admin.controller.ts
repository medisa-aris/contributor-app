import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS, PERMISSIONS } from '@bara/shared';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentAuth } from '../../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../../common/types/auth-context';
import { WEB_PROVIDER_IDS, type WebProviderId } from './types';
import { WebSearchService } from './web-search.service';

export class WebSearchPriorityDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(WEB_PROVIDER_IDS.length)
  @ArrayMaxSize(WEB_PROVIDER_IDS.length)
  @IsIn(WEB_PROVIDER_IDS, { each: true })
  order: WebProviderId[];
}

/** Urutan penyedia pencarian web; kredensial tetap di .env dan tidak pernah dikembalikan. */
@ApiTags('admin-web-search')
@Controller('admin/web-search')
export class WebSearchAdminController {
  constructor(private readonly webSearch: WebSearchService) {}

  @RequirePermission(PERMISSIONS.configRead)
  @Get('providers')
  providers() {
    return this.webSearch.providers();
  }

  @Audit(AUDIT_EVENTS.configUpdated, 'warn')
  @RequirePermission(PERMISSIONS.configManage)
  @Put('priority')
  setPriority(@CurrentAuth() auth: AuthContext, @Body() dto: WebSearchPriorityDto) {
    return this.webSearch.setPriority(dto.order, auth.user.id);
  }
}
