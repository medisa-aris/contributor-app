import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ConfigUpdateDto {
  @IsDefined({ message: 'Nilai wajib diisi' })
  value: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class AuthzTestDto {
  @IsUUID('4')
  userId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  permission: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  resourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  resourceId?: string;

  @IsOptional()
  @IsUUID('4')
  resourceOwnerId?: string;
}

export type NavLevel = 'application' | 'module' | 'feature' | 'menu_item';

export class ReorderNavDto {
  @IsDefined()
  items: { id: string; type: NavLevel; sortOrder: number }[];
}

export class CreateApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  identifier: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateModuleDto {
  @IsUUID('4')
  applicationId: string;

  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  identifier: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateFeatureDto {
  @IsUUID('4')
  moduleId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  identifier: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateMenuItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  key: string;

  @IsUUID('4')
  applicationId: string;

  @IsOptional()
  @IsUUID('4')
  moduleId?: string | null;

  @IsOptional()
  @IsUUID('4')
  featureId?: string | null;

  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  labelDefault: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  i18nKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  routePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  requiredPermission?: string | null;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isFuture?: boolean;
}

export class UpdateApplicationDto extends PartialType(CreateApplicationDto) {}
export class UpdateModuleDto extends PartialType(CreateModuleDto) {}
export class UpdateFeatureDto extends PartialType(CreateFeatureDto) {}
export class UpdateMenuItemDto extends PartialType(CreateMenuItemDto) {}
