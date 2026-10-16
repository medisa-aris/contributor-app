/** Fail-fast environment validation — runs before the app starts serving. */
export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const nodeEnv = String(raw.NODE_ENV ?? 'development');

  const databaseUrl = raw.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    errors.push('DATABASE_URL is required (postgres://user:password@host:5432/database)');
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must start with postgres:// or postgresql://');
  }

  const port = raw.PORT === undefined || raw.PORT === '' ? 3000 : Number(raw.PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    errors.push('PORT must be a valid TCP port number');
  }

  const cookieSecure = raw.SESSION_COOKIE_SECURE;
  if (cookieSecure !== undefined && !['true', 'false'].includes(String(cookieSecure))) {
    errors.push('SESSION_COOKIE_SECURE must be "true" or "false"');
  }
  if (nodeEnv === 'production' && String(cookieSecure) !== 'true') {
    errors.push('SESSION_COOKIE_SECURE must be "true" when NODE_ENV=production');
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
  }
  return raw;
}
