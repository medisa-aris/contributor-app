import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GUARDRAIL_CATEGORY_IDS, GUARDRAIL_LIMITS, PERMISSIONS } from '@bara/shared';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentAuth } from '../../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../../common/types/auth-context';
import { GuardrailsService } from './guardrails.service';

export class UpdateGuardrailsDto {
  @IsBoolean()
  enabled: boolean;

  @IsBoolean()
  blockImages: boolean;

  @IsArray()
  @ArrayUnique()
  @IsIn(GUARDRAIL_CATEGORY_IDS, { each: true })
  categories: string[];

  @IsArray()
  @ArrayMaxSize(GUARDRAIL_LIMITS.maxTerms)
  @IsString({ each: true })
  @MinLength(2, { each: true })
  @MaxLength(GUARDRAIL_LIMITS.maxTermLength, { each: true })
  terms: string[];
}

/** Pengaturan Guardrails; kunci rahasia tetap di .env dan tidak pernah dikembalikan. */
@ApiTags('admin-guardrails')
@Controller('admin/guardrails')
export class GuardrailsAdminController {
  constructor(private readonly guardrails: GuardrailsService) {}

  @RequirePermission(PERMISSIONS.guardrailsManage)
  @Get()
  get() {
    return this.guardrails.getSettings();
  }

  @RequirePermission(PERMISSIONS.guardrailsManage)
  @Put()
  update(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateGuardrailsDto) {
    return this.guardrails.updateSettings(dto, auth.user.id);
  }
}
