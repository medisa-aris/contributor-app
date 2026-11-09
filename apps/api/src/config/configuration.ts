import { resolve } from 'node:path';

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
  aiUploadDir: string;
  aiProvider: string;
  aiModel: string;
  aiBaseUrl: string;
  aiTimeoutMs: number;
  openrouterApiKey: string | null;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  ollamaBaseUrl: string | null;
  tavilyApiKey: string | null;
  firecrawlApiKey: string | null;
  braveSearchApiKey: string | null;
  guardrailsSecretKey: string | null;
  webSearchMaxAttempts: number;
  webSearchTimeoutMs: number;
  webSearchMaxResults: number;
  webSearchMaxCallsPerTurn: number;
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
    aiUploadDir: resolve(process.env.AI_UPLOAD_DIR ?? resolve(process.cwd(), 'var', 'ai-uploads')),
    aiProvider: process.env.AI_PROVIDER ?? 'openrouter',
    aiModel: process.env.AI_MODEL ?? 'google/gemini-3.1-flash-lite',
    aiBaseUrl: process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1',
    aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 60000),
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? null,
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? null,
    tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || null,
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY?.trim() || null,
    braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY?.trim() || null,
    guardrailsSecretKey: process.env.GUARDRAILS_SECRET_KEY?.trim() || null,
    webSearchMaxAttempts: Number(process.env.WEB_SEARCH_MAX_ATTEMPTS || 3),
    webSearchTimeoutMs: Number(process.env.WEB_SEARCH_TIMEOUT_MS || 15000),
    webSearchMaxResults: Number(process.env.WEB_SEARCH_MAX_RESULTS || 5),
    webSearchMaxCallsPerTurn: Number(process.env.WEB_SEARCH_MAX_CALLS_PER_TURN || 5),
  },
});
