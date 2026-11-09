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

  const guardrailsKey = raw.GUARDRAILS_SECRET_KEY;
  if (guardrailsKey && Buffer.from(String(guardrailsKey), 'base64').length !== 32) {
    errors.push('GUARDRAILS_SECRET_KEY must be 32 bytes encoded as base64');
  }

  for (const key of [
    'WEB_SEARCH_MAX_ATTEMPTS',
    'WEB_SEARCH_TIMEOUT_MS',
    'WEB_SEARCH_MAX_RESULTS',
    'WEB_SEARCH_MAX_CALLS_PER_TURN',
  ]) {
    const value = raw[key];
    if (value === undefined || value === '') continue;
    if (!Number.isInteger(Number(value)) || Number(value) <= 0) {
      errors.push(`${key} must be a positive integer`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
  }
  return raw;
}
