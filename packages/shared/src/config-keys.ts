export interface AppConfigDefinition {
  key: string;
  description: string;
  isPublic: boolean;
  defaultValue: unknown;
}

/** Whitelisted application configuration keys. Values live in the app_config table. */
export const APP_CONFIG_KEYS = {
  appName: 'app.name',
  defaultLocale: 'app.default_locale',
  defaultTheme: 'app.default_theme',
  timezone: 'app.timezone',
  showTokenUsage: 'ai.show_token_usage',
  lockoutThreshold: 'security.lockout_threshold',
  lockoutMinutes: 'security.lockout_minutes',
  sessionIdleMinutes: 'security.session_idle_minutes',
  sessionAbsoluteHours: 'security.session_absolute_hours',
} as const;

export type AppConfigKey = (typeof APP_CONFIG_KEYS)[keyof typeof APP_CONFIG_KEYS];

export const APP_CONFIG_DEFINITIONS: readonly AppConfigDefinition[] = [
  {
    key: APP_CONFIG_KEYS.appName,
    description: 'Nama aplikasi yang tampil di antarmuka',
    isPublic: true,
    defaultValue: 'Contributor AI',
  },
  {
    key: APP_CONFIG_KEYS.defaultLocale,
    description: 'Bahasa antarmuka bawaan',
    isPublic: true,
    defaultValue: 'id',
  },
  {
    key: APP_CONFIG_KEYS.defaultTheme,
    description: 'Tema bawaan',
    isPublic: true,
    defaultValue: 'system',
  },
  {
    key: APP_CONFIG_KEYS.timezone,
    description: 'Zona waktu tampilan',
    isPublic: true,
    defaultValue: 'Asia/Jakarta',
  },
  {
    key: APP_CONFIG_KEYS.showTokenUsage,
    description: 'Tampilkan total token konteks dan output pada antarmuka chat (Ya/Tidak)',
    isPublic: true,
    defaultValue: true,
  },
  {
    key: APP_CONFIG_KEYS.lockoutThreshold,
    description: 'Jumlah kegagalan login sebelum akun terkunci',
    isPublic: false,
    defaultValue: 5,
  },
  {
    key: APP_CONFIG_KEYS.lockoutMinutes,
    description: 'Durasi kunci akun dalam menit',
    isPublic: false,
    defaultValue: 15,
  },
  {
    key: APP_CONFIG_KEYS.sessionIdleMinutes,
    description: 'Batas idle sesi dalam menit',
    isPublic: false,
    defaultValue: 480,
  },
  {
    key: APP_CONFIG_KEYS.sessionAbsoluteHours,
    description: 'Batas absolut umur sesi dalam jam',
    isPublic: false,
    defaultValue: 168,
  },
];
