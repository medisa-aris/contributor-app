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
    <div v-else class="tb__lanes">
      <section v-for="lane in lanes" :key="lane.key" class="tb__lane" :class="`tb__lane--${lane.key}`">
        <header class="tb__lane-head">
          <span>{{ t(`subordinate.tasks.lane.${lane.key}`) }}</span>
          <CaBadge size="small">{{ lane.items.length }}</CaBadge>
        </header>
        <ul class="tb__cards">
          <li v-for="task in lane.items" :key="task.id">
            <button type="button" class="tb__card" @click="emit('open', task.id)">
              <span class="tb__card-title">{{ task.title }}</span>
              <span class="tb__card-meta">
                <AgentAvatar
                  v-if="task.agent_name || task.group_name"
                  :name="task.group_name ?? task.agent_name ?? ''"
                  :color="task.group_name ? '#475569' : colorFor(task.agent_id)"
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

.tb__lanes {
  display: grid;
  grid-template-columns: repeat(5, minmax(200px, 1fr));
  gap: var(--ca-space-3);
  overflow-x: auto;
  padding-bottom: var(--ca-space-2);
}

.tb__lane {
  background: var(--ca-bg-canvas, rgba(0, 0, 0, 0.03));
  border-radius: var(--ca-radius-large, 10px);
  padding: var(--ca-space-3);
  min-height: 160px;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.tb__lane--action {
  box-shadow: inset 0 3px 0 var(--ca-border-warning, #e0b252);
}

.tb__lane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--ca-text-200);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-2);
}

.tb__cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
  max-height: 60vh;
  overflow-y: auto;
}

.tb__card {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  padding: var(--ca-space-3);
  border-radius: var(--ca-radius-medium, 8px);
  border: 1px solid var(--ca-border-subtle, var(--ca-border));
  background: var(--ca-bg-surface, #fff);
  cursor: pointer;
  color: var(--ca-fg-1);
}

.tb__card:hover {
  border-color: var(--ca-border-brand, var(--ca-fg-3));
}

.tb__card-title {
  font-weight: var(--ca-font-weight-medium);
  font-size: var(--ca-text-300);
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
  gap: 6px;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.tb__card-foot {
  justify-content: space-between;
}

@media (max-width: 960px) {
  .tb__lanes {
    grid-template-columns: repeat(5, 240px);
  }
}
</style>
