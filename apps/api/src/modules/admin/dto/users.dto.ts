import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail({}, { message: 'Email tidak valid' })
  @MaxLength(320)
  email: string;

  @IsString()
  @MinLength(2, { message: 'Nama minimal 2 karakter' })
  @MaxLength(200)
  displayName: string;

  @IsString()
  @MinLength(10, { message: 'Kata sandi minimal 10 karakter' })
  @MaxLength(200)
  password: string;

  @IsOptional()
  @IsUUID('4', { message: 'Departemen tidak valid' })
  departmentId?: string | null;

  @IsOptional()
  @IsBoolean()
  isSuperadmin?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsUUID('4')
  departmentId?: string | null;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  @IsOptional()
  @IsBoolean()
  isSuperadmin?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10, { message: 'Kata sandi minimal 10 karakter' })
  @MaxLength(200)
  newPassword: string;
}

export class RoleAssignmentDto {
  @IsUUID('4', { message: 'Peran tidak valid' })
  roleId: string;

  @IsIn(['global', 'department', 'own'])
  dataScope: 'global' | 'department' | 'own';

  @IsOptional()
  @IsUUID('4')
  departmentId?: string | null;
}
