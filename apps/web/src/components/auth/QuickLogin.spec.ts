import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from '@/stores/config.store';
import QuickLogin from './QuickLogin.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

describe('QuickLogin', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  const mountPanel = () => mount(QuickLogin, { global: { plugins: [pinia] } });

  it('tertutup sampai server memastikan DEV', () => {
    expect(mountPanel().find('.quick-login').exists()).toBe(false);
  });

  it('tidak tampil saat API berjalan sebagai PROD', () => {
    useConfigStore().environment = 'PROD';
    expect(mountPanel().find('.quick-login').exists()).toBe(false);
  });

  it('tampil saat API berjalan sebagai DEV', () => {
    useConfigStore().environment = 'DEV';
    expect(mountPanel().find('.quick-login').exists()).toBe(true);
  });
});
