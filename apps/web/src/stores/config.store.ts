import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PublicConfigDto } from '@contributor/shared';
import { apiGet } from '@/api/http';

export const useConfigStore = defineStore('config', () => {
  const appName = ref('Contributor AI');
  const timezone = ref('Asia/Jakarta');
  const showTokenUsage = ref(true);
  const loaded = ref(false);
  let inflight: Promise<void> | null = null;

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const config = await apiGet<PublicConfigDto>('/config/public');
        appName.value = config.appName;
        timezone.value = config.timezone;
        showTokenUsage.value = config.showTokenUsage !== false;
        loaded.value = true;
      } catch {
        inflight = null;
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return { appName, timezone, showTokenUsage, loaded, load };
});
