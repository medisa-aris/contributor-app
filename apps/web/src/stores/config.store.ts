import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PublicConfigDto } from '@bara/shared';
import { apiGet } from '@/api/http';

export const useConfigStore = defineStore('config', () => {
  const appName = ref('ContributorAI');
  const timezone = ref('Asia/Jakarta');
  const showTokenUsage = ref(true);
  const environment = ref<'DEV' | 'PROD'>('PROD');
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
        environment.value = config.environment === 'DEV' ? 'DEV' : 'PROD';
        loaded.value = true;
      } catch {
        inflight = null;
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return { appName, timezone, showTokenUsage, environment, loaded, load };
});
