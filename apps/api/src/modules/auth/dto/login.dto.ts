import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email tidak valid' })
  @MaxLength(320)
  email: string;

  @IsString()
  @MinLength(1, { message: 'Kata sandi wajib diisi' })
  @MaxLength(200)
  password: string;
}
