<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  agentTaskDetail,
  executeAgent,
  listAgents,
  listAgentTasks,
  type AgentRow,
  type AgentTaskDetail,
  type AgentTaskRow,
} from '@/api/agents';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { usePagedList } from '@/composables/usePagedList';
import { formatDateTime } from '@/utils/format';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaPagination,
  CaSelect,
  CaTable,
  CaTextarea,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const toast = useToastStore();

const canExecute = computed(() => auth.can('agents.execute'));

const agents = ref<AgentRow[]>([]);
const agentOptions = computed<CaSelectOption[]>(
  () =>
    agents.value
      .filter((a) => a.status === 'active')
      .map((a) => ({ value: a.id, label: a.name })),
);
const agentById = computed(() => new Map(agents.value.map((a) => [a.id, a])));

const selectedAgentId = ref('');
const instruction = ref('');
const title = ref('');
const running = ref(false);
const formError = ref('');

// --- Tugas terakhir yang dijalankan (dipantau) ---
const currentTask = ref<AgentTaskDetail | null>(null);
const detailError = ref('');
let pollTimer: ReturnType<typeof setInterval> | null = null;

const ACTIVE_STATUSES = new Set(['created', 'validating', 'awaiting_approval', 'running']);

function taskStatusKey(status: string): string {
  const map: Record<string, string> = {
    created: 'created',
    validating: 'validating',
    awaiting_approval: 'awaiting_approval',
    running: 'running',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
  };
  return map[status] ?? 'created';
}

function taskVariant(status: string): 'success' | 'warning' | 'danger' | 'informative' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'awaiting_approval') return 'warning';
  if (status === 'running' || status === 'validating') return 'informative';
  return 'neutral';
}

function taskLabel(status: string): string {
  return t(`workspace.subordinate.status.${taskStatusKey(status)}`);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function refreshCurrentTask(): Promise<void> {
  if (!currentTask.value) return;
  try {
    currentTask.value = await agentTaskDetail(currentTask.value.id);
    if (!ACTIVE_STATUSES.has(currentTask.value.status)) stopPolling();
  } catch (caught) {
    detailError.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
    stopPolling();
  }
}

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => void refreshCurrentTask(), 2500);
}

async function runAgent(): Promise<void> {
  formError.value = '';
  if (!selectedAgentId.value) {
    formError.value = t('agents.agentRequired');
    return;
  }
  if (instruction.value.trim().length < 5) {
    formError.value = t('agents.instructionRequired');
    return;
  }
  running.value = true;
  try {
    const result = await executeAgent(selectedAgentId.value, {
      instruction: instruction.value.trim(),
      title: title.value.trim() || undefined,
    });
    instruction.value = '';
    title.value = '';
    toast.push({
      variant: 'success',
      title: result.approvalId
        ? t('agents.executionQueuedApproval')
        : t('agents.executionStarted'),
    });
    currentTask.value = await agentTaskDetail(result.task.id);
    if (ACTIVE_STATUSES.has(currentTask.value.status)) startPolling();
  } catch (caught) {
    formError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    running.value = false;
  }
}

// --- Log tugas agen ---
const statusFilter = ref('');
const taskStatusOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('common.all') },
  { value: 'created', label: t('workspace.subordinate.status.created') },
  { value: 'awaiting_approval', label: t('workspace.subordinate.status.awaiting_approval') },
  { value: 'running', label: t('workspace.subordinate.status.running') },
  { value: 'completed', label: t('workspace.subordinate.status.completed') },
  { value: 'failed', label: t('workspace.subordinate.status.failed') },
  { value: 'cancelled', label: t('workspace.subordinate.status.cancelled') },
]);

const {
  items: taskItems,
  total: taskTotal,
  page: taskPage,
  pageSize: taskPageSize,
  loading: tasksLoading,
  error: tasksError,
  load: loadTasks,
  setFilter: setTaskFilter,
  goPage: goTaskPage,
} = usePagedList<AgentTaskRow>(listAgentTasks, { pageSize: 25 });

const taskColumns = computed<CaTableColumn[]>(() => [
  { key: 'title', label: t('agents.columnTaskTitle'), sortValue: (row) => row.title },
  { key: 'agent', label: t('agents.columnAgent') },
  { key: 'status', label: t('agents.columnStatus') },
  { key: 'created', label: t('agents.columnCreated'), sortValue: (row) => row.created_at },
]);

function applyTaskFilter(): void {
  setTaskFilter({
    status: statusFilter.value || undefined,
    agentId: selectedAgentId.value || undefined,
  });
}

// --- Dialog detail tugas ---
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailTask = ref<AgentTaskDetail | null>(null);

async function openTaskDetail(row: AgentTaskRow): Promise<void> {
  detailOpen.value = true;
  detailLoading.value = true;
  detailTask.value = null;
  try {
    detailTask.value = await agentTaskDetail(row.id);
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.loadFailed'),
    });
    detailOpen.value = false;
  } finally {
    detailLoading.value = false;
  }
}

onMounted(async () => {
  void loadTasks();
  try {
    const result = await listAgents({ page: 1, pageSize: 100 });
    agents.value = result.items;
    const fromQuery = typeof route.query.agent === 'string' ? route.query.agent : '';
    if (fromQuery && agents.value.some((a) => a.id === fromQuery && a.status === 'active')) {
      selectedAgentId.value = fromQuery;
    } else {
      selectedAgentId.value = agents.value.find((a) => a.status === 'active')?.id ?? '';
    }
  } catch {
    agents.value = [];
  }
});

watch(statusFilter, () => applyTaskFilter());

onBeforeUnmount(() => stopPolling());
</script>

<template>
  <div>
    <CaPageHeader
      :title="t('agents.operationsTitle')"
      :description="t('agents.operationsDescription')"
    />

    <section v-if="canExecute" class="ops-panel">
      <h2 class="ops-panel__heading">{{ t('agents.runHeading') }}</h2>
      <p v-if="formError" class="admin-error" role="alert">{{ formError }}</p>
      <form class="ops-form" @submit.prevent="runAgent">
        <CaField :label="t('agents.formAgent')" required>
          <template #default="{ id, describedBy }">
            <CaSelect :id="id" v-model="selectedAgentId" :aria-describedby="describedBy" :options="agentOptions" />
          </template>
        </CaField>
        <CaField :label="t('agents.formTaskTitle')">
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="title" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('agents.formInstruction')" required class="ops-form__wide">
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="instruction" :aria-describedby="describedBy" :rows="4" />
          </template>
        </CaField>
        <div class="ops-form__actions">
          <CaButton variant="primary" type="submit" :loading="running">
            {{ t('agents.runAction') }}
          </CaButton>
          <CaBadge
            v-if="selectedAgentId && agentById.get(selectedAgentId)?.require_approval"
            variant="warning"
            size="small"
          >
            {{ t('agents.approvalRequired') }}
          </CaBadge>
        </div>
      </form>
    </section>

    <section v-if="currentTask" class="ops-current">
      <h2 class="ops-panel__heading">{{ t('agents.currentTaskHeading') }}</h2>
      <p v-if="detailError" class="admin-error" role="alert">{{ detailError }}</p>
      <div class="ops-current__head">
        <span class="ops-current__title">{{ currentTask.title }}</span>
        <CaBadge :variant="taskVariant(currentTask.status)" size="small">
          {{ taskLabel(currentTask.status) }}
        </CaBadge>
      </div>
      <dl class="ops-metrics">
        <div v-if="currentTask.model" class="ops-metrics__row">
          <dt>{{ t('workspace.subordinate.metricsModel') }}</dt>
          <dd class="admin-mono">{{ currentTask.model }}</dd>
        </div>
        <div
          v-if="currentTask.tokens_in !== null || currentTask.tokens_out !== null"
          class="ops-metrics__row"
        >
          <dt>{{ t('workspace.subordinate.metricsTokens') }}</dt>
          <dd class="admin-mono">{{ currentTask.tokens_in ?? 0 }} → {{ currentTask.tokens_out ?? 0 }}</dd>
        </div>
        <div v-if="currentTask.duration_ms !== null" class="ops-metrics__row">
          <dt>{{ t('workspace.subordinate.metricsDuration') }}</dt>
          <dd class="admin-mono">{{ currentTask.duration_ms }} ms</dd>
        </div>
      </dl>
      <div v-if="currentTask.result" class="ops-result">
        <h3 class="ops-result__title">{{ t('workspace.subordinate.resultTitle') }}</h3>
        <pre class="ops-result__body">{{ currentTask.result }}</pre>
      </div>
      <div v-if="currentTask.error_message" class="ops-result ops-result--error">
        <h3 class="ops-result__title">{{ t('workspace.subordinate.errorTitle') }}</h3>
        <pre class="ops-result__body">{{ currentTask.error_message }}</pre>
      </div>
      <div class="ops-form__actions">
        <CaButton size="small" variant="secondary" @click="refreshCurrentTask">
          {{ t('common.refresh') }}
        </CaButton>
      </div>
    </section>

    <section>
      <div class="ops-log-head">
        <h2 class="ops-panel__heading">{{ t('agents.tasksLogHeading') }}</h2>
        <div class="ops-log-filters">
          <CaSelect
            v-model="statusFilter"
            :options="taskStatusOptions"
            :aria-label="t('agents.columnStatus')"
          />
        </div>
      </div>
      <p v-if="tasksError" class="admin-error" role="alert">{{ tasksError }}</p>
      <CaTable
        table-key="agent-tasks"
        :columns="taskColumns"
        :rows="taskItems"
        :row-key="(row) => row.id"
        :loading="tasksLoading"
        :empty-title="t('table.empty')"
      >
        <template #cell-title="{ row }">
          <button type="button" class="ops-task-link" @click="openTaskDetail(row as AgentTaskRow)">
            {{ row.title }}
          </button>
        </template>
        <template #cell-agent="{ row }">
          {{ row.agent_name ?? '—' }}
        </template>
        <template #cell-status="{ row }">
          <CaBadge :variant="taskVariant((row as AgentTaskRow).status)" size="small">
            {{ taskLabel((row as AgentTaskRow).status) }}
          </CaBadge>
        </template>
        <template #cell-created="{ row }">
          {{ formatDateTime(row.created_at) }}
        </template>
      </CaTable>
      <CaPagination :page="taskPage" :limit="taskPageSize" :total="taskTotal" @change="goTaskPage" />
    </section>

    <CaDialog
      v-model:open="detailOpen"
      :title="detailTask?.title ?? t('common.details')"
      :subtitle="detailTask ? taskLabel(detailTask.status) : ''"
    >
      <div v-if="detailLoading" class="ops-detail-loading">{{ t('common.loading') }}</div>
      <template v-else-if="detailTask">
        <dl class="ops-metrics">
          <div class="ops-metrics__row">
            <dt>{{ t('agents.columnAgent') }}</dt>
            <dd>{{ detailTask.approval?.agent_name ?? '—' }}</dd>
          </div>
          <div v-if="detailTask.model" class="ops-metrics__row">
            <dt>{{ t('workspace.subordinate.metricsModel') }}</dt>
            <dd class="admin-mono">{{ detailTask.model }}</dd>
          </div>
          <div v-if="detailTask.duration_ms !== null" class="ops-metrics__row">
            <dt>{{ t('workspace.subordinate.metricsDuration') }}</dt>
            <dd class="admin-mono">{{ detailTask.duration_ms }} ms</dd>
          </div>
        </dl>
        <div v-if="detailTask.result" class="ops-result">
          <h3 class="ops-result__title">{{ t('workspace.subordinate.resultTitle') }}</h3>
          <pre class="ops-result__body">{{ detailTask.result }}</pre>
        </div>
        <div v-if="detailTask.error_message" class="ops-result ops-result--error">
          <h3 class="ops-result__title">{{ t('workspace.subordinate.errorTitle') }}</h3>
          <pre class="ops-result__body">{{ detailTask.error_message }}</pre>
        </div>
        <div class="ops-events">
          <h3 class="ops-result__title">{{ t('workspace.subordinate.eventsTitle') }}</h3>
          <ol v-if="detailTask.events.length > 0" class="ops-events__list">
            <li v-for="event in detailTask.events" :key="event.id" class="ops-events__item">
              <span class="ops-events__type">{{ event.event_type }}</span>
              <span class="ops-events__message">{{ event.message }}</span>
              <time class="ops-events__time">{{ formatDateTime(event.created_at) }}</time>
            </li>
          </ol>
          <p v-else class="ops-events__empty">{{ t('common.noData') }}</p>
        </div>
      </template>
      <template #footer>
        <CaButton variant="secondary" @click="detailOpen = false">{{ t('common.close') }}</CaButton>
      </template>
    </CaDialog>
  </div>
</template>

<style scoped>
.ops-panel__heading {
  margin: 0 0 var(--ca-space-4);
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.ops-panel,
.ops-current {
  margin-bottom: var(--ca-space-10);
  padding: var(--ca-space-6);
  border: 1px solid var(--ca-border-1);
  border-radius: var(--ca-radius-3);
  background: var(--ca-bg-2);
}

.ops-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ca-space-5);
}

.ops-form__wide {
  grid-column: 1 / -1;
}

.ops-form__actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
}

.ops-current__head {
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--ca-space-4);
}

.ops-current__title {
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.ops-metrics {
  margin: 0 0 var(--ca-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.ops-metrics__row {
  display: flex;
  gap: var(--ca-space-6);
  font-size: var(--ca-text-200);
}

.ops-metrics__row dt {
  width: 160px;
  flex-shrink: 0;
  color: var(--ca-fg-3);
}

.ops-metrics__row dd {
  margin: 0;
  color: var(--ca-fg-1);
}

.ops-result {
  margin-bottom: var(--ca-space-4);
}

.ops-result__title {
  margin: 0 0 var(--ca-space-2);
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.ops-result__body {
  margin: 0;
  padding: var(--ca-space-4);
  border-radius: var(--ca-radius-2);
  background: var(--ca-bg-3, var(--ca-bg-surface));
  border: 1px solid var(--ca-stroke-3);
  font-family: var(--ca-font-family-monospace, monospace);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-300);
  color: var(--ca-fg-1);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow-y: auto;
}

.ops-result--error .ops-result__body {
  border-color: var(--ca-danger-stroke);
}

.ops-log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
}

.ops-log-filters {
  width: 220px;
}

.ops-task-link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  color: var(--ca-color-link);
  cursor: pointer;
  text-align: start;
}

.ops-task-link:hover {
  text-decoration: underline;
}

.ops-detail-loading {
  padding: var(--ca-space-8) 0;
  text-align: center;
  color: var(--ca-fg-3);
}

.ops-events__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  max-height: 260px;
  overflow-y: auto;
}

.ops-events__item {
  display: flex;
  gap: var(--ca-space-3);
  align-items: baseline;
  font-size: var(--ca-text-200);
}

.ops-events__type {
  flex: none;
  font-family: var(--ca-font-family-monospace, monospace);
  color: var(--ca-color-brand);
}

.ops-events__message {
  flex: 1;
  color: var(--ca-fg-1);
}

.ops-events__time {
  flex: none;
  color: var(--ca-fg-3);
}

.ops-events__empty {
  margin: 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

@media (max-width: 900px) {
  .ops-form {
    grid-template-columns: 1fr;
  }
}
</style>
