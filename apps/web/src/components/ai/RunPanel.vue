<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ToolTraceStep } from '@/api/ai/types';
import { formatTokens } from '@/api/models';
import { FINAL_RUN_STATUSES, type RunDto } from '@/api/runs';
import { CaBadge, CaButton, CaSpinner } from '@/components/ui';
import MarkdownContent from './MarkdownContent.vue';
import ToolTraceList from './ToolTraceList.vue';

/** Tampilan satu kerja panjang di percakapan (§14.10): status, langkah, token, waktu, kendali. */
const props = defineProps<{
  run: RunDto;
  text: string;
  steps: ToolTraceStep[];
  compactions: number;
  /** Pesan dari tool kirim_pembaruan, ditampilkan apa adanya. */
  progress?: string[];
  reconnecting?: boolean;
}>();
const emit = defineEmits<{ cancel: []; continue: [] }>();

const { t } = useI18n();
const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => {
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => window.clearInterval(timer));

const active = computed(() => !FINAL_RUN_STATUSES.includes(props.run.status));
const canContinue = computed(() => props.run.status === 'budget_exhausted' || props.run.status === 'deadline_exceeded');
const variant = computed(() => {
  switch (props.run.status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'budget_exhausted':
    case 'deadline_exceeded':
    case 'waiting_approval':
    case 'waiting_input':
      return 'warning';
    case 'cancelled':
      return 'neutral';
    default:
      return 'informative';
  }
});

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const elapsed = computed(() => {
  const start = props.run.startedAt ? new Date(props.run.startedAt).getTime() : new Date(props.run.createdAt).getTime();
  const end = props.run.finishedAt ? new Date(props.run.finishedAt).getTime() : now.value;
  return clock(end - start);
});
const limit = computed(() => {
  const start = props.run.startedAt ? new Date(props.run.startedAt).getTime() : new Date(props.run.createdAt).getTime();
  return clock(new Date(props.run.deadlineAt).getTime() - start);
});
const tokens = computed(() => props.run.tokensIn + props.run.tokensOut);
</script>

<template>
  <section class="run" :aria-label="t('runs.title')" aria-live="polite">
    <header class="run__head">
      <CaSpinner v-if="active" size="tiny" />
      <strong class="run__title">{{ t('runs.title') }}</strong>
      <CaBadge :variant="variant" size="small">{{ t(`runs.status.${run.status}`) }}</CaBadge>
      <span class="run__meta">{{ t('runs.steps', { n: run.iterations, max: run.maxIterations }) }}</span>
      <span class="run__meta">
        {{ t('runs.tokens', { n: formatTokens(tokens) }) }}<template v-if="run.tokenBudget"> / {{ formatTokens(run.tokenBudget) }}</template>
      </span>
      <span class="run__meta">{{ t('runs.time', { elapsed, limit }) }}</span>
      <span v-if="reconnecting" class="run__meta">{{ t('runs.reconnecting') }}</span>
      <span class="run__actions">
        <CaButton v-if="active" size="small" variant="secondary" @click="emit('cancel')">{{ t('runs.cancel') }}</CaButton>
        <CaButton v-if="canContinue" size="small" variant="primary" @click="emit('continue')">{{ t('runs.continue') }}</CaButton>
      </span>
    </header>
    <p v-if="run.error && !active" class="run__error">{{ run.error }}</p>
    <p v-if="compactions > 0" class="run__note">{{ t('runs.compacted', { n: compactions }) }}</p>
    <div v-if="progress && progress.length > 0" class="run__progress">
      <p class="run__note">{{ t('runs.progressTitle') }}</p>
      <div v-for="(item, index) in progress" :key="index" class="run__progress-item"><MarkdownContent :content="item" /></div>
    </div>
    <ToolTraceList v-if="steps.length > 0" :steps="steps" readonly />
    <div v-if="text" class="run__text"><MarkdownContent :content="text" /></div>
    <p class="run__hint">{{ t('runs.hint') }}</p>
  </section>
</template>

<style scoped>
.run {
  margin: var(--ca-space-3) var(--ca-space-6);
  padding: var(--ca-space-3) var(--ca-space-4);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-bg-surface);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}
.run__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-2) var(--ca-space-3);
}
.run__title {
  font-size: var(--ca-text-300);
}
.run__meta {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  font-variant-numeric: tabular-nums;
}
.run__actions {
  margin-left: auto;
  display: inline-flex;
  gap: var(--ca-space-2);
}
.run__error {
  margin: 0;
  color: var(--ca-danger-fg);
  font-size: var(--ca-text-200);
}
.run__note,
.run__hint {
  margin: 0;
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}
.run__progress {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}
.run__progress-item {
  border-left: 3px solid var(--ca-color-brand, #16a34a);
  padding-left: var(--ca-space-3);
}
.run__text {
  max-height: 320px;
  overflow: auto;
}
</style>
