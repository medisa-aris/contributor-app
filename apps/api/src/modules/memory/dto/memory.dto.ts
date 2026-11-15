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
  MEMORY_ENTRY_TYPES,
  MEMORY_LIMITS,
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
}

export class SetContextDoorsDto {
  @IsArray()
  @ArrayMaxSize(MEMORY_LIMITS.maxOpenDoors)
  @IsUUID('4', { each: true })
  subjectIds: string[];
}
