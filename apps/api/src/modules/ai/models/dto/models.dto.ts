import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AI_PROVIDER_CODES, type AiProviderCode, type GrantTarget, type QuotaPeriod } from '@bara/shared';

const PERIODS: QuotaPeriod[] = ['day', 'week'];
const TARGETS: GrantTarget[] = ['user', 'department', 'agent', 'everyone'];

export class NewModelItemDto {
  @IsIn(AI_PROVIDER_CODES)
  provider: AiProviderCode;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  modelKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional() @IsInt() @Min(1) contextWindow?: number;
  @IsOptional() @IsInt() @Min(1) maxOutputTokens?: number;
  @IsOptional() @IsBoolean() supportsTools?: boolean;
  @IsOptional() @IsBoolean() supportsVision?: boolean;
}

export class CreateModelsDto {
  @ValidateNested({ each: true })
  @Type(() => NewModelItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  items: NewModelItemDto[];
}

export class UpdateModelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) displayName?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsBoolean() leaderGrantable?: boolean;
  @IsOptional() @IsBoolean() supportsTools?: boolean;
  @IsOptional() @IsBoolean() supportsVision?: boolean;
  @IsOptional() @IsBoolean() supportsStream?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) contextWindow?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) maxOutputTokens?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(3) costTier?: 1 | 2 | 3 | null;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class TestModelDto {
  @IsOptional() @IsBoolean() vision?: boolean;
}

export class SetDefaultDto {
  @IsBoolean() confirm: boolean;
}

export class DefaultLimitsDto {
  @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) tokenLimit: number | null;
  @IsIn(PERIODS) period: QuotaPeriod;
  @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(10000) requestsPerMinute: number | null;
}

export class CreateGrantDto {
  @IsIn(TARGETS) targetType: GrantTarget;
  @ValidateIf((o: CreateGrantDto) => o.targetType !== 'everyone') @IsUUID() targetId: string | null;
  @IsOptional() @IsBoolean() includeSubDepartments?: boolean;
  @IsUUID() modelId: string;
  @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) tokenLimit: number | null;
  @IsIn(PERIODS) period: QuotaPeriod;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) note?: string | null;
}

export class UpdateGrantDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) tokenLimit?: number | null;
  @IsOptional() @IsIn(PERIODS) period?: QuotaPeriod;
  @IsOptional() @IsBoolean() includeSubDepartments?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) note?: string | null;
}

export class GrantListQueryDto {
  @IsOptional() @IsIn(TARGETS) targetType?: GrantTarget;
  @IsOptional() @IsUUID() targetId?: string;
  @IsOptional() @IsUUID() modelId?: string;
}

export class EffectiveQueryDto {
  @IsUUID() userId: string;
}

export class PreferredModelDto {
  @ValidateIf((_, v) => v !== null) @IsUUID() modelId: string | null;
}

export class UsageQueryDto {
  @IsIn(PERIODS) period: QuotaPeriod;
  @IsIn(['user', 'model']) groupBy: 'user' | 'model';
}
