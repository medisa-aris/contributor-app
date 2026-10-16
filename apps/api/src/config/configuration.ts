export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  testDatabaseUrl: string | null;
  redisUrl: string | null;
  corsOrigins: string[];
  cookieSecure: boolean;
  sessionCookieName: string;
  logLevel: string;
  aiProvider: string;
  aiModel: string;
  aiBaseUrl: string;
  openrouterApiKey: string | null;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

export default (): { app: AppConfig } => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? '',
    testDatabaseUrl: process.env.TEST_DATABASE_URL ?? null,
    redisUrl: process.env.REDIS_URL ?? null,
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    cookieSecure: parseBoolean(process.env.SESSION_COOKIE_SECURE, false),
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'ca_session',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    aiProvider: process.env.AI_PROVIDER ?? 'openrouter',
    aiModel: process.env.AI_MODEL ?? 'gemini/gemini-3.1-flash-lite',
    aiBaseUrl: process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1',
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? null,
  },
});
