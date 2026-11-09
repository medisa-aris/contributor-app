import { resolveAppEnv } from '../../src/config/configuration';
import { validateEnv } from '../../src/config/env.validation';

describe('APP_ENV', () => {
  it('APP_ENV menentukan lingkungan, tanpa peduli huruf besar-kecil', () => {
    expect(resolveAppEnv('DEV', 'production')).toBe('DEV');
    expect(resolveAppEnv('prod', 'development')).toBe('PROD');
  });

  it('kosong: NODE_ENV=production dianggap PROD, selain itu DEV', () => {
    expect(resolveAppEnv(undefined, 'production')).toBe('PROD');
    expect(resolveAppEnv('', 'development')).toBe('DEV');
    expect(resolveAppEnv(undefined, undefined)).toBe('DEV');
  });

  it('nilai selain DEV/PROD ditolak saat validasi', () => {
    const base = { DATABASE_URL: 'postgres://u:p@h:5432/d' };
    expect(() => validateEnv({ ...base, APP_ENV: 'STAGING' })).toThrow(/APP_ENV/);
    expect(() => validateEnv({ ...base, APP_ENV: 'PROD' })).not.toThrow();
  });

  it('APP_ENV=DEV ditolak bersama NODE_ENV=production', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgres://u:p@h:5432/d',
        NODE_ENV: 'production',
        SESSION_COOKIE_SECURE: 'true',
        APP_ENV: 'DEV',
      }),
    ).toThrow(/NODE_ENV=production/);
  });
});
