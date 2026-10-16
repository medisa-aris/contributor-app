import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Kata sandi saat ini wajib diisi' })
  @MaxLength(200)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Kata sandi baru minimal 8 karakter' })
  @MaxLength(200)
  newPassword: string;
}
