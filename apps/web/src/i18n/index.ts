import { createI18n } from 'vue-i18n';
import { id } from './locales/id';

export const SUPPORTED_LOCALES = ['id'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'id';

export function createAppI18n(locale: AppLocale = DEFAULT_LOCALE) {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale,
    fallbackLocale: DEFAULT_LOCALE,
    messages: { id },
  });
}

export type AppI18n = ReturnType<typeof createAppI18n>;

/** Singleton untuk dipakai di luar komponen (router guard, dsb). */
export const appI18n: AppI18n = createAppI18n();
