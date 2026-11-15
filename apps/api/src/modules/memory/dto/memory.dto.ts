import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
} from 'class-validator';
import {
  MEMORY_DIGEST_PERIODS,
  MEMORY_ENTRY_TYPES,
  MEMORY_LIMITS,
  type MemoryDigestPeriod,
  type MemoryReviewDecision,
  type MemoryEntryStatus,
  type MemoryEntryType,
  type MemorySensitivity,
} from '@bara/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const SENSITIVITIES = ['shareable', 'private'] as const;

export class MemoryEntryListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(MEMORY_ENTRY_TYPES)
  type?: MemoryEntryType;

  @IsOptional()
  @IsIn(['active', 'superseded', 'archived'])
  status?: MemoryEntryStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class CreateMemoryEntryDto {
  @IsIn(MEMORY_ENTRY_TYPES)
  type: MemoryEntryType;

  @IsString()
  @MinLength(3)
  @MaxLength(MEMORY_LIMITS.maxContentLength)
  content: string;

  @IsOptional()
  @IsIn(SENSITIVITIES)
  sensitivity?: MemorySensitivity;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  importance?: number;
}

export class UpdateMemoryEntryDto {
  @IsOptional()
  @IsIn(MEMORY_ENTRY_TYPES)
  type?: MemoryEntryType;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(MEMORY_LIMITS.maxContentLength)
  content?: string;

  @IsOptional()
  @IsIn(SENSITIVITIES)
  sensitivity?: MemorySensitivity;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  importance?: number;
}

export class SetMemoryDoorDto {
  @IsBoolean()
  enabled: boolean;

  @IsArray()
  @ArrayMaxSize(MEMORY_ENTRY_TYPES.length)
  @IsIn(MEMORY_ENTRY_TYPES, { each: true })
  exposedTypes: MemoryEntryType[];

  /** Atasan juga dapat membuka pintu agent pribadi saya (R6). */
  @IsOptional()
  @IsBoolean()
  exposeAgents?: boolean;

  /** Tahan catatan baru di kotak tinjauan sebelum dapat dibagikan. */
  @IsOptional()
  @IsBoolean()
  reviewRequired?: boolean;
}

export class ReviewMemoryEntriesDto {
  @IsIn(['approve', 'private', 'delete'])
  decision: MemoryReviewDecision;

  /** Kosong/tidak ada = semua catatan di kotak tinjauan. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  entryIds?: string[];
}

export class MemoryDigestRequestDto {
  @IsArray()
  @ArrayMaxSize(MEMORY_LIMITS.maxOpenDoors)
  @IsUUID('4', { each: true })
  subjectIds: string[];

  @IsOptional()
  @Type(() => Number)
  @IsIn(MEMORY_DIGEST_PERIODS)
  days?: MemoryDigestPeriod;
}

export class SetContextDoorsDto {
  @IsArray()
  @ArrayMaxSize(MEMORY_LIMITS.maxOpenDoors)
  @IsUUID('4', { each: true })
  subjectIds: string[];
}
