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
  webSearchPriority: 'ai.web_search_priority',
  memoryEnabled: 'ai.memory_enabled',
  memoryEmbeddingModel: 'ai.memory_embedding_model',
  memoryExtractorModel: 'ai.memory_extractor_model',
  memoryMaxContextTokens: 'ai.memory_max_context_tokens',
  memoryMaxExtractionsPerDay: 'ai.memory_max_extractions_per_day',
  memoryRetentionDays: 'ai.memory_retention_days',
  defaultModelTokenLimit: 'ai.default_model.token_limit',
  defaultModelPeriod: 'ai.default_model.period',
  defaultModelRequestsPerMinute: 'ai.default_model.requests_per_minute',
  guardrailsEnabled: 'ai.guardrails_enabled',
  guardrailsBlockImages: 'ai.guardrails_block_images',
  guardrailsCategories: 'ai.guardrails_categories',
  guardrailsTerms: 'ai.guardrails_terms',
  lockoutThreshold: 'security.lockout_threshold',
  lockoutMinutes: 'security.lockout_minutes',
  sessionIdleMinutes: 'security.session_idle_minutes',
  sessionAbsoluteHours: 'security.session_absolute_hours',
} as const;

/** Batas model bawaan hanya boleh diubah lewat layar Model AI. */
export function isModelConfigKey(key: string): boolean {
  return key.startsWith('ai.default_model.');
}

/** Kunci Guardrails hanya boleh dibaca dan diubah lewat admin/guardrails. */
export function isGuardrailConfigKey(key: string): boolean {
  return key.startsWith('ai.guardrails_');
}

export type AppConfigKey = (typeof APP_CONFIG_KEYS)[keyof typeof APP_CONFIG_KEYS];

export const APP_CONFIG_DEFINITIONS: readonly AppConfigDefinition[] = [
  {
    key: APP_CONFIG_KEYS.appName,
    description: 'Nama aplikasi yang tampil di antarmuka',
    isPublic: true,
    defaultValue: 'ContributorAI',
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
    key: APP_CONFIG_KEYS.webSearchPriority,
    description: 'Urutan prioritas penyedia pencarian web',
    isPublic: false,
    defaultValue: ['tavily', 'firecrawl', 'brave'],
  },
  {
    key: APP_CONFIG_KEYS.memoryEnabled,
    description: 'Memori terpusat: catat memori dari percakapan/tugas dan gunakan saat menjawab (Ya/Tidak)',
    isPublic: true,
    defaultValue: true,
  },
  {
    key: APP_CONFIG_KEYS.memoryEmbeddingModel,
    description: 'Model embedding untuk pencarian semantik memori (dipakai bila pgvector tersedia)',
    isPublic: false,
    defaultValue: 'openai/text-embedding-3-small',
  },
  {
    key: APP_CONFIG_KEYS.memoryExtractorModel,
    description: 'Model untuk mengekstrak catatan memori; kosong = model chat aktif',
    isPublic: false,
    defaultValue: '',
  },
  {
    key: APP_CONFIG_KEYS.memoryMaxContextTokens,
    description: 'Batas token memori yang disisipkan ke prompt per jawaban',
    isPublic: false,
    defaultValue: 1500,
  },
  {
    key: APP_CONFIG_KEYS.memoryMaxExtractionsPerDay,
    description: 'Batas ekstraksi memori per pengguna per hari',
    isPublic: false,
    defaultValue: 50,
  },
  {
    key: APP_CONFIG_KEYS.memoryRetentionDays,
    description: 'Arsipkan catatan memori jenis peristiwa setelah N hari; 0 = tidak pernah',
    isPublic: false,
    defaultValue: 0,
  },
  {
    key: APP_CONFIG_KEYS.defaultModelTokenLimit,
    description: 'Batas token per pengguna untuk model bawaan (null = tanpa batas)',
    isPublic: false,
    defaultValue: null,
  },
  {
    key: APP_CONFIG_KEYS.defaultModelPeriod,
    description: 'Periode batas token model bawaan (day/week)',
    isPublic: false,
    defaultValue: 'day',
  },
  {
    key: APP_CONFIG_KEYS.defaultModelRequestsPerMinute,
    description: 'Batas permintaan per menit per pengguna untuk model bawaan (null = tanpa batas)',
    isPublic: false,
    defaultValue: null,
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
