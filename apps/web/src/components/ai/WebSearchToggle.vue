<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { webSearchStatus } from '@/api/ai';
import { useAuthStore } from '@/stores/auth.store';
import { CaIcon, CaSwitch } from '@/components/ui';

/** Hanya tampil bila pengguna berizin dan server punya minimal satu penyedia. */
defineProps<{ disabled?: boolean }>();
const enabled = defineModel<boolean>({ default: false });

const { t } = useI18n();
const auth = useAuthStore();
const available = ref(false);
const visible = computed(() => auth.can('ai.websearch.use') && available.value);

onMounted(async () => {
  if (!auth.can('ai.websearch.use')) return;
  try {
    available.value = (await webSearchStatus()).available;
  } catch {
    available.value = false;
  }
});
</script>

<template>
  <div v-if="visible" class="wsearch" :title="t('workspace.tools.webSearchHint')">
    <CaIcon name="search" :size="13" />
    <CaSwitch v-model="enabled" :disabled="disabled" :label="t('workspace.tools.webSearch')" />
  </div>
</template>

<style scoped>
.wsearch {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  padding: var(--ca-space-2) var(--ca-space-4) 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-2);
}
</style>
