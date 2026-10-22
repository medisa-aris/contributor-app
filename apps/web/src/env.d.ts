/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

/** Versi aplikasi dari apps/web/package.json (disuntikkan oleh Vite). */
declare const __APP_VERSION__: string;
