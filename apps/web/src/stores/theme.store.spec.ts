import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useThemeStore } from './theme.store';

function stubMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    setActivePinia(createPinia());
  });

  it('defaults to system mode and resolves from prefers-color-scheme', () => {
    stubMatchMedia(true);
    const store = useThemeStore();
    expect(store.mode).toBe('system');
    expect(store.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies explicit light mode and persists it', async () => {
    stubMatchMedia(false);
    const store = useThemeStore();
    store.setMode('light');
    await nextTick();
    expect(store.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('ca.theme')).toBe('light');
  });

  it('reads a stored mode on initialization', () => {
    localStorage.setItem('ca.theme', 'dark');
    stubMatchMedia(false);
    const store = useThemeStore();
    expect(store.mode).toBe('dark');
    expect(store.resolved).toBe('dark');
  });

  it('falls back to system for unknown stored values', () => {
    localStorage.setItem('ca.theme', 'neon');
    stubMatchMedia(false);
    const store = useThemeStore();
    expect(store.mode).toBe('system');
  });
});
