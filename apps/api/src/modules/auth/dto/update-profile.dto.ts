import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { THEMES, type ThemePreference } from '@contributor/shared';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Nama tampilan minimal 2 karakter' })
  @MaxLength(150)
  displayName?: string;

  @IsOptional()
  @IsIn(['id', 'en'], { message: 'Locale harus id atau en' })
  locale?: string;

  @IsOptional()
  @IsIn([...THEMES], { message: 'Tema tidak dikenal' })
  theme?: ThemePreference;
}
