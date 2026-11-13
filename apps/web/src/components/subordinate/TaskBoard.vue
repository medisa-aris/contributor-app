<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AiTaskStatus } from '@bara/shared';
import { ApiError } from '@/api/http';
import { listTasks } from '@/api/ai';
import type { AgentTaskRow, PersonalAgent } from '@/api/subordinate';
import { formatDateTime } from '@/utils/format';
import { CaBadge, CaButton, CaEmptyState, CaIcon, CaSpinner } from '@/components/ui';
import AgentAvatar from './AgentAvatar.vue';

/** Papan tugas berlajur ala Task Board: Antre, Berjalan, Perlu tindakan, Selesai, Gagal/Batal. */
const props = defineProps<{ agents: PersonalAgent[] }>();
const emit = defineEmits<{ open: [taskId: string]; create: [] }>();

const { t } = useI18n();

const tasks = ref<AgentTaskRow[]>([]);
const loading = ref(true);
const error = ref('');
let timer: number | undefined;

const LANES: { key: string; statuses: AiTaskStatus[] }[] = [
  { key: 'queued', statuses: ['created', 'validating'] },
  { key: 'running', statuses: ['running'] },
  { key: 'action', statuses: ['awaiting_approval', 'needs_input'] },
  { key: 'done', statuses: ['completed'] },
  { key: 'stopped', statuses: ['failed', 'cancelled'] },
];

const lanes = computed(() =>
  LANES.map((lane) => ({ ...lane, items: tasks.value.filter((task) => lane.statuses.includes(task.status)) })),
);

const doneCount = computed(() => lanes.value.find((lane) => lane.key === 'done')?.items.length ?? 0);
const donePct = computed(() =>
  tasks.value.length === 0 ? 0 : Math.round((doneCount.value / tasks.value.length) * 100),
);

const hasOpen = computed(() =>
  tasks.value.some((task) => ['created', 'validating', 'running'].includes(task.status)),
);

async function load(): Promise<void> {
  try {
    const result = await listTasks({ page: 1, pageSize: 100 });
    tasks.value = result.items as AgentTaskRow[];
    error.value = '';
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void load(), hasOpen.value ? 2500 : 15000);
}

onMounted(load);
onBeforeUnmount(() => window.clearTimeout(timer));

function colorFor(id: string | null): string | null {
  return props.agents.find((agent) => agent.id === id)?.avatar_color ?? null;
}

function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'informative' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'awaiting_approval' || status === 'needs_input') return 'warning';
  if (status === 'running') return 'informative';
  return 'neutral';
}

defineExpose({ reload: load });
</script>

<template>
  <section class="tb">
    <div class="tb__head">
      <p class="tb__intro">{{ t('subordinate.tasks.intro') }}</p>
      <div class="tb__actions">
        <CaButton variant="subtle" size="small" @click="load">
          <template #icon-start><CaIcon name="refresh" :size="13" /></template>
          {{ t('subordinate.tasks.refresh') }}
        </CaButton>
        <CaButton variant="primary" @click="emit('create')">{{ t('subordinate.tasks.create') }}</CaButton>
      </div>
    </div>
    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="tb__loading"><CaSpinner /></div>
    <CaEmptyState
      v-else-if="tasks.length === 0"
      :title="t('subordinate.tasks.emptyTitle')"
      :description="t('subordinate.tasks.emptyDescription')"
    />
    <template v-else>
    <section class="tb__flow" :aria-label="t('subordinate.tasks.flowLabel')">
      <div class="tb__flow-head">
        <h2 class="tb__flow-title">{{ t('subordinate.tasks.flowTitle', { n: tasks.length }) }}</h2>
        <span class="tb__muted">{{ t('subordinate.tasks.flowDone', { done: doneCount, n: tasks.length, pct: donePct }) }}</span>
      </div>
      <div class="tb__bar" aria-hidden="true">
        <span
          v-for="lane in lanes"
          :key="lane.key"
          class="tb__bar-seg"
          :class="`tb__bar-seg--${lane.key}`"
          :style="{ flexGrow: lane.items.length }"
        />
      </div>
      <dl class="tb__stages">
        <div v-for="lane in lanes" :key="lane.key" class="tb__stage">
          <dt class="tb__muted">{{ t(`subordinate.tasks.lane.${lane.key}`) }}</dt>
          <dd class="tb__stage-count">{{ lane.items.length }}</dd>
        </div>
      </dl>
    </section>
    <div class="tb__lanes">
      <section
        v-for="lane in lanes"
        :key="lane.key"
        class="tb__lane"
        :class="`tb__lane--${lane.key}`"
        :aria-label="t(`subordinate.tasks.lane.${lane.key}`)"
      >
        <header class="tb__lane-head">
          <span>{{ t(`subordinate.tasks.lane.${lane.key}`) }}</span>
          <span class="tb__lane-count">{{ lane.items.length }}</span>
        </header>
        <p v-if="lane.items.length === 0" class="tb__lane-empty">{{ t(`subordinate.tasks.laneEmpty.${lane.key}`) }}</p>
        <ul v-else class="tb__cards">
          <li v-for="task in lane.items" :key="task.id">
            <button type="button" class="tb__card" @click="emit('open', task.id)">
              <span class="tb__card-title">{{ task.title }}</span>
              <span class="tb__card-meta">
                <AgentAvatar
                  v-if="task.agent_name || task.group_name"
                  :name="task.group_name ?? task.agent_name ?? ''"
                  :color="task.group_name ? 'var(--ca-fg-3)' : colorFor(task.agent_id)"
                  :size="18"
                />
                <span>{{ task.group_name ?? task.agent_name ?? t('subordinate.tasks.targetGeneral') }}</span>
              </span>
              <span class="tb__card-foot">
                <CaBadge size="small" :variant="statusVariant(task.status)">{{ t(`workspace.subordinate.status.${task.status}`) }}</CaBadge>
                <span>{{ formatDateTime(task.updated_at) }}</span>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>
    </template>
  </section>
</template>

<style scoped>
.tb__head {
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--ca-space-4);
}

.tb__intro {
  margin: 0;
  max-width: 70ch;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.tb__actions {
  display: flex;
  gap: var(--ca-space-2);
  align-items: center;
}

.tb__loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-8) 0;
}

.tb__flow {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
  margin-bottom: var(--ca-space-12);
  padding: var(--ca-space-10);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  box-shadow: var(--ca-shadow-4);
}

.tb__flow-head {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--ca-space-4);
}

.tb__flow-title {
  font-size: var(--ca-text-500);
  line-height: var(--ca-line-500);
  font-weight: var(--ca-font-weight-semibold);
}

.tb__muted {
  color: var(--ca-fg-3);
}

.tb__bar {
  display: flex;
  height: 12px;
  border-radius: var(--ca-radius-md);
  overflow: hidden;
  background: var(--ca-bg-surface-2);
}

.tb__bar-seg {
  flex-basis: 0;
}

.tb__bar-seg--queued {
  background: var(--ca-chart-4);
}

.tb__bar-seg--running {
  background: var(--ca-chart-2);
}

.tb__bar-seg--action {
  background: var(--ca-chart-3);
}

.tb__bar-seg--done {
  background: var(--ca-chart-1);
}

.tb__bar-seg--stopped {
  background: var(--ca-danger-stroke);
}

.tb__stages {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--ca-space-6);
  margin: 0;
}

.tb__stage {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
}

.tb__stage dd {
  margin: 0;
}

.tb__stage-count {
  font-size: var(--ca-text-700);
  line-height: var(--ca-line-700);
  font-weight: var(--ca-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.tb__lanes {
  display: grid;
  grid-template-columns: repeat(5, minmax(200px, 1fr));
  gap: var(--ca-space-8);
  overflow-x: auto;
  padding-bottom: var(--ca-space-2);
}

.tb__lane {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  min-height: 420px;
  padding: var(--ca-space-6);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface-2);
  border: 1px solid var(--ca-stroke-2);
}

.tb__lane--action {
  box-shadow: inset 0 3px 0 var(--ca-warning-stroke);
}

.tb__lane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--ca-space-2) var(--ca-space-2);
  font-weight: var(--ca-font-weight-semibold);
}

.tb__lane-count {
  padding: 0 var(--ca-space-4);
  border-radius: var(--ca-radius-circular);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
}

.tb__lane-empty {
  padding: var(--ca-space-12) var(--ca-space-6);
  border: 1px dashed var(--ca-stroke-accessible);
  border-radius: var(--ca-radius-xl);
  color: var(--ca-fg-3);
  text-align: center;
}

.tb__cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  max-height: 60vh;
  overflow-y: auto;
}

.tb__card {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  text-align: left;
  padding: var(--ca-space-6);
  border-radius: var(--ca-radius-xl);
  border: 1px solid var(--ca-stroke-2);
  background: var(--ca-bg-surface);
  box-shadow: var(--ca-shadow-4);
  cursor: pointer;
  color: var(--ca-fg-1);
  font: inherit;
  transition: box-shadow var(--ca-duration-normal) var(--ca-curve-decelerate-mid);
}

.tb__card:hover {
  box-shadow: var(--ca-shadow-8);
}

.tb__card-title {
  font-weight: var(--ca-font-weight-semibold);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tb__card-meta,
.tb__card-foot {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.tb__card-foot {
  justify-content: space-between;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 960px) {
  .tb__lanes {
    grid-template-columns: repeat(5, 260px);
  }
}
</style>
