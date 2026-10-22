import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useUiStore } from './ui.store';

describe('ui.store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('layar penuh nonaktif secara default dan dapat diubah', () => {
    const ui = useUiStore();
    expect(ui.fullscreen).toBe(false);
    ui.setFullscreen(true);
    expect(ui.fullscreen).toBe(true);
    ui.setFullscreen(false);
    expect(ui.fullscreen).toBe(false);
  });
});
