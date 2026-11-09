import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

const API_ENV_DIR = fileURLToPath(new URL('../api', import.meta.url));

/** Penanda yang tidak boleh ada di bundle bila login cepat dibuang. */
const QUICK_LOGIN_MARKERS = [
  '@bara.local',
  '@contributor.local',
  'HseDemo',
  'ManajerDemo',
  'StafDemo',
  'Kontrib-',
  'Masuk cepat',
  'quick-login',
];

/** `vite build` membuang login cepat kecuali diminta eksplisit dengan APP_ENV=DEV di shell. */
function quickLoginEnabled(command: 'build' | 'serve', mode: string): boolean {
  const value =
    command === 'build' ? process.env.APP_ENV : loadEnv(mode, API_ENV_DIR, 'APP_ENV').APP_ENV;
  return value?.trim().toUpperCase() === 'DEV';
}

/** Gagalkan build bila penanda login cepat masih ada di berkas apa pun yang akan dikirim. */
function forbidQuickLoginMarkers(): Plugin {
  return {
    name: 'forbid-quick-login-markers',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        const text = file.type === 'chunk' ? file.code : String(file.source);
        const found = QUICK_LOGIN_MARKERS.find((marker) => text.includes(marker));
        if (found)
          this.error(`Kode login cepat bocor ke build PROD: "${found}" di ${file.fileName}`);
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const quickLogin = quickLoginEnabled(command, mode);
  return {
    plugins: quickLogin ? [vue()] : [vue(), forbidQuickLoginMarkers()],
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __QUICK_LOGIN__: JSON.stringify(quickLogin),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.spec.ts'],
      passWithNoTests: false,
    },
  };
});
