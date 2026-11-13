import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@bara/shared';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/auth-context';
import type { OfficeSourceKind } from '../office/office-token';
import { OfficeStylesService } from './office-styles.service';

class CreateTemplateDto {
  @IsIn(['doc', 'att'])
  sourceKind!: OfficeSourceKind;

  @IsUUID()
  sourceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

function parseKind(value: string): OfficeSourceKind {
  if (value === 'doc' || value === 'att') return value;
  throw new AppError(ERROR_CODES.notFound, 'Sumber berkas tidak dikenal.', 404);
}

/** Inspektur gaya Office dan templat gaya milik pengguna. */
@ApiTags('ai-workspace')
@Controller('office-styles')
export class OfficeStylesController {
  constructor(private readonly styles: OfficeStylesService) {}

  @RequirePermission(PERMISSIONS.documentsManage)
  @Get(':kind/:id/profile')
  profile(
    @CurrentAuth() auth: AuthContext,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.styles.profile(auth, parseKind(kind), id);
  }

  @RequirePermission(PERMISSIONS.documentsManage)
  @Get('templates')
  list(@CurrentAuth() auth: AuthContext) {
    return this.styles.list(auth);
  }

  @RequirePermission(PERMISSIONS.documentsManage)
  @Post('templates')
  create(@CurrentAuth() auth: AuthContext, @Body() body: CreateTemplateDto) {
    return this.styles.create(auth, body.sourceKind, body.sourceId, body.name);
  }

  @RequirePermission(PERMISSIONS.documentsManage)
  @Get('templates/:id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.styles.get(auth, id);
  }

  @RequirePermission(PERMISSIONS.documentsManage)
  @HttpCode(204)
  @Delete('templates/:id')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.styles.remove(auth, id);
  }
}
