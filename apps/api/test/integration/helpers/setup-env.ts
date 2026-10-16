import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(__dirname, '..', '..', '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    const key = match?.[1];
    if (key && process.env[key] === undefined) {
      process.env[key] = match[2] ?? '';
    }
  }
}

process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.LOG_LEVEL = 'silent';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.SESSION_COOKIE_SECURE = 'false';
