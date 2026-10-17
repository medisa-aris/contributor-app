import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const CONNECTOR_AUTH_TYPES = ['none', 'api_key'] as const;
const HTTP_METHODS = ['GET', 'POST'] as const;

export class ToolEndpointDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsIn(HTTP_METHODS)
  method: 'GET' | 'POST';

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  path: string;
}

export class CreateMcpServerDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,79}$/)
  code: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsUrl({ require_tld: false })
  @MaxLength(500)
  baseUrl: string;

  @IsIn(CONNECTOR_AUTH_TYPES)
  authType: (typeof CONNECTOR_AUTH_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  apiKeyEnv?: string;
}

export class UpdateMcpServerDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsIn(CONNECTOR_AUTH_TYPES)
  authType?: (typeof CONNECTOR_AUTH_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  apiKeyEnv?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateRestConnectorDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,79}$/)
  code: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsUrl({ require_tld: false })
  @MaxLength(500)
  baseUrl: string;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ToolEndpointDto)
  toolEndpoints: ToolEndpointDto[];

  @IsIn(CONNECTOR_AUTH_TYPES)
  authType: (typeof CONNECTOR_AUTH_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  apiKeyEnv?: string;
}

export class UpdateRestConnectorDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ToolEndpointDto)
  toolEndpoints?: ToolEndpointDto[];

  @IsOptional()
  @IsIn(CONNECTOR_AUTH_TYPES)
  authType?: (typeof CONNECTOR_AUTH_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  apiKeyEnv?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
