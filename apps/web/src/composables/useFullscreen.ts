import { onBeforeUnmount, onMounted } from 'vue';
import { useUiStore } from '@/stores/ui.store';

/**
 * Mode layar penuh aplikasi (menyembunyikan sidebar/header lewat ui.store) yang juga
 * meminta layar penuh peramban bila tersedia. Escape dan keluar dari layar penuh
 * peramban otomatis mengembalikan tata letak.
 */
export function useFullscreen() {
  const ui = useUiStore();

  async function setFullscreen(value: boolean): Promise<void> {
    ui.setFullscreen(value);
    try {
      if (value && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      else if (!value && document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      // Layar penuh peramban opsional; tata letak tetap bekerja tanpanya.
    }
  }

  function onFullscreenChange(): void {
    if (!document.fullscreenElement && ui.fullscreen) ui.setFullscreen(false);
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && ui.fullscreen) void setFullscreen(false);
  }

  onMounted(() => {
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeydown);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('keydown', onKeydown);
    void setFullscreen(false);
  });

  return { ui, setFullscreen };
}
