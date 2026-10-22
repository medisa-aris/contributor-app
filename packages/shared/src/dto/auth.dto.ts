import type { ThemePreference } from '../enums';

export interface PreferencesDto {
  theme: ThemePreference;
  locale: string;
}

export interface SessionInfoDto {
  expiresAt: string;
  createdAt: string;
}

export interface AuthUserDto {
  id: string;
  email: string;
  displayName: string;
  departmentId: string | null;
  departmentName: string | null;
  jobTitle: string | null;
  isSuperadmin: boolean;
}

export interface MeDto {
  user: AuthUserDto;
  permissions: string[];
  csrfToken: string;
  preferences: PreferencesDto;
  session: SessionInfoDto;
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface ChangePasswordRequestDto {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateProfileRequestDto {
  displayName?: string;
  locale?: string;
  theme?: ThemePreference;
}

export interface PublicConfigDto {
  appName: string;
  defaultLocale: string;
  defaultTheme: ThemePreference;
  timezone: string;
  showTokenUsage: boolean;
}
