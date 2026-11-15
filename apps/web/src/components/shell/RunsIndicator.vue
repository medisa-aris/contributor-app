<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { listRuns, type RunDto } from '@/api/runs';
import { useAuthStore } from '@/stores/auth.store';
import { CaMenu, CaSpinner } from '@/components/ui';

/** "Proses berjalan" (§14.10): jumlah kerja panjang aktif milik pengguna, tautan ke percakapannya. */
const { t } = useI18n();
const auth = useAuthStore();
const router = useRouter();
const runs = ref<RunDto[]>([]);
let timer: number | undefined;

async function refresh(): Promise<void> {
  if (!auth.can('ai.workspace.access') || document.hidden) return;
  try {
    runs.value = (await listRuns('active')).filter((run) => run.kind === 'conversation_turn');
  } catch {
    runs.value = [];
  }
}

const items = computed(() =>
  runs.value.map((run) => ({
    key: run.id,
    label: `${run.conversationTitle ?? run.prompt?.slice(0, 40) ?? '—'} · ${t(`runs.status.${run.status}`)}`,
  })),
);

async function open(key: string): Promise<void> {
  const run = runs.value.find((r) => r.id === key);
  if (!run?.conversationId) return;
  const page = run.mode === 'counterpart' ? 'counterpart' : 'second-brain';
  await router.push({ path: `/workspace/${page}`, query: { c: run.conversationId } });
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(() => void refresh(), 20_000);
});
onBeforeUnmount(() => window.clearInterval(timer));
</script>

<template>
  <CaMenu v-if="runs.length > 0" :items="items" align="end" @select="open">
    <template #trigger>
      <button type="button" class="runs-ind" :aria-label="t('runs.indicator', { n: runs.length })">
        <CaSpinner size="tiny" />
        <span>{{ t('runs.indicator', { n: runs.length }) }}</span>
      </button>
    </template>
  </CaMenu>
</template>

<style scoped>
.runs-ind {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-2);
  padding: 4px 10px;
  border: 1px solid var(--ca-stroke-2);
  border-radius: 999px;
  background: var(--ca-color-brand-subtle);
  color: var(--ca-fg-1);
  font: inherit;
  font-size: var(--ca-text-200);
  cursor: pointer;
}
.runs-ind:focus-visible {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}
</style>
