import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'ca.theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function readStoredMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MEDIA_QUERY).matches
    : false;
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStoredMode());
  const systemDark = ref(systemPrefersDark());

  const resolved = computed<ResolvedTheme>(() =>
    mode.value === 'system' ? (systemDark.value ? 'dark' : 'light') : mode.value,
  );

  function setMode(next: ThemeMode): void {
    mode.value = next;
  }

  watch(
    mode,
    (value) => {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, value);
    },
    { immediate: true },
  );

  watch(
    resolved,
    (value) => {
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = value;
      }
    },
    { immediate: true },
  );

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const media = window.matchMedia(MEDIA_QUERY);
    media.addEventListener('change', (event) => {
      systemDark.value = event.matches;
    });
  }

  return { mode, resolved, setMode };
});
