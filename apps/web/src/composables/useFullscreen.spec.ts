import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { useFullscreen } from './useFullscreen';
import { useUiStore } from '@/stores/ui.store';

describe('useFullscreen', () => {
  beforeEach(() => setActivePinia(createPinia()));

  function mountHost() {
    let api!: ReturnType<typeof useFullscreen>;
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useFullscreen();
          return () => null;
        },
      }),
    );
    return { api, wrapper };
  }

  it('mengaktifkan layar penuh dan keluar dengan Escape', async () => {
    const { api } = mountHost();
    const ui = useUiStore();
    await api.setFullscreen(true);
    expect(ui.fullscreen).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(ui.fullscreen).toBe(false);
  });

  it('mengembalikan tata letak saat komponen dilepas', async () => {
    const { api, wrapper } = mountHost();
    await api.setFullscreen(true);
    wrapper.unmount();
    expect(useUiStore().fullscreen).toBe(false);
  });
});
