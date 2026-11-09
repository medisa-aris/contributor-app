import { defineStore } from 'pinia';
import { ref } from 'vue';

/** Status UI lintas halaman, mis. mode layar penuh yang menyembunyikan sidebar dan header. */
export const useUiStore = defineStore('ui', () => {
  const fullscreen = ref(false);

  function setFullscreen(value: boolean): void {
    fullscreen.value = value;
  }

  return { fullscreen, setFullscreen };
});
