import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PublicConfigDto } from '@contributor/shared';
import { apiGet } from '@/api/http';

export const useConfigStore = defineStore('config', () => {
  const appName = ref('Contributor AI');
  const timezone = ref('Asia/Jakarta');
  const loaded = ref(false);
  let inflight: Promise<void> | null = null;

  async function load(): Promise<void> {
    if (loaded.value) return;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const config = await apiGet<PublicConfigDto>('/config/public');
        appName.value = config.appName;
        timezone.value = config.timezone;
        loaded.value = true;
      } catch {
        inflight = null;
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return { appName, timezone, loaded, load };
});
