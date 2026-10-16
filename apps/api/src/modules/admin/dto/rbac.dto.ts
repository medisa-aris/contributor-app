import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_.-]{2,99}$/, {
    message: 'Kode peran hanya huruf kecil, angka, titik, strip, garis bawah',
  })
  code: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class ReplaceRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions: string[];
}

export class CreateGroupDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_.-]{2,49}$/, {
    message: 'Kode grup hanya huruf kecil, angka, titik, strip, garis bawah',
  })
  code: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class GroupMembersDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  userIds: string[];
}

export class CreateDepartmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._-]{2,50}$/, {
    message: 'Kode departemen hanya huruf, angka, titik, strip, garis bawah',
  })
  code: string;

  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{2,50}$/)
  code?: string;

  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;
}

export class CreatePolicyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsIn(['allow', 'deny'])
  effect: 'allow' | 'deny';

  @IsIn(['user', 'group', 'role'])
  subjectType: 'user' | 'group' | 'role';

  @IsUUID('4')
  subjectId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  permissionPattern: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  resourceType?: string | null;

  @IsOptional()
  @IsUUID('4')
  resourceId?: string | null;

  @IsOptional()
  priority?: number;

  @IsOptional()
  conditions?: Record<string, unknown>;

  @IsOptional()
  isActive?: boolean;
}

export class UpdatePolicyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  priority?: number;

  @IsOptional()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  resourceType?: string | null;

  @IsOptional()
  @IsUUID('4')
  resourceId?: string | null;

  @IsOptional()
  conditions?: Record<string, unknown>;
}
