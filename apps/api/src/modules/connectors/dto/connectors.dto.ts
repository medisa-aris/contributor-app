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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DB_ENGINES, type DbEngine } from '../drivers/types';

export class DbConnectorOptionsDto {
  @IsOptional()
  @IsBoolean()
  ssl?: boolean;

  @IsOptional()
  @IsBoolean()
  trustServerCertificate?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  schema?: string;

  @IsOptional()
  @IsBoolean()
  oracleSid?: boolean;
}

export class CreateDbConnectorDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,59}$/)
  code: string;

  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(DB_ENGINES)
  engine: DbEngine;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  database: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  username: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DbConnectorOptionsDto)
  options?: DbConnectorOptionsDto;

  @IsOptional()
  @IsBoolean()
  allowWrite?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  rowLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(300000)
  timeoutMs?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateDbConnectorDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  database?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  username?: string;

  /** Kosongkan (tidak dikirim) untuk mempertahankan password lama. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DbConnectorOptionsDto)
  options?: DbConnectorOptionsDto;

  @IsOptional()
  @IsBoolean()
  allowWrite?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  rowLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(300000)
  timeoutMs?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export const CONNECTOR_TYPES = ['database', 'mcp'] as const;
export const GRANT_SUBJECTS = ['user', 'role', 'department', 'group'] as const;
export const ACCESS_LEVELS = ['read', 'read_write'] as const;

export class CreateConnectorGrantDto {
  @IsIn(GRANT_SUBJECTS)
  subjectType: (typeof GRANT_SUBJECTS)[number];

  @IsUUID()
  subjectId: string;

  @IsIn(ACCESS_LEVELS)
  access: (typeof ACCESS_LEVELS)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  tableAllowlist?: string[];
}

export class ConnectorAttachmentDto {
  @IsIn(CONNECTOR_TYPES)
  connectorType: (typeof CONNECTOR_TYPES)[number];

  @IsUUID()
  connectorId: string;

  @IsIn(ACCESS_LEVELS)
  access: (typeof ACCESS_LEVELS)[number];
}

export class SetConnectorAttachmentsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConnectorAttachmentDto)
  connectors: ConnectorAttachmentDto[];
}
