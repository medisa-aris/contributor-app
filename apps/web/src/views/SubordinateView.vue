<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { AI_TASK_STATUSES, type AiTaskStatus } from '@contributor/shared';
import { cancelTask, createTask, listTasks, runTask, taskDetail, type TaskDetail, type TaskRow } from '@/api/ai';
import { ApiError } from '@/api/http';
import { usePagedList } from '@/composables/usePagedList';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaField,
  CaIcon,
  CaInput,
  CaPageHeader,  CaPagination,
  CaSelect,
  CaTable,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const toast = useToastStore();

const { items, total, page, pageSize, loading, error, load, setFilter, goPage } = usePagedList<TaskRow>(
  listTasks,
  { pageSize: 10 },
);

const statusFilter = ref('');
const statusOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('common.all') },
  ...AI_TASK_STATUSES.map((status) => ({ value: status, label: statusLabel(status) })),
]);

watch(statusFilter, (value) => {
  setFilter({ status: (value || undefined) as AiTaskStatus | undefined });
});

function statusLabel(status: AiTaskStatus): string {
  return t(`workspace.subordinate.status.${status}`);
}

function statusVariant(status: AiTaskStatus): 'brand' | 'danger' | 'success' | 'warning' | 'informative' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'running':
      return 'brand';
    case 'awaiting_approval':
      return 'warning';
    case 'validating':
      return 'informative';
    default:
      return 'neutral';
  }
}

const OPEN_STATUSES: readonly AiTaskStatus[] = ['created', 'validating', 'awaiting_approval', 'running'];
const RUNNABLE_STATUSES: readonly AiTaskStatus[] = ['created', 'failed', 'cancelled'];

const columns = computed<CaTableColumn[]>(() => [
  { key: 'title', label: t('workspace.subordinate.columnTitle') },
  { key: 'status', label: t('workspace.subordinate.columnStatus'), width: '150px' },
  { key: 'created_at', label: t('workspace.subordinate.columnCreated'), width: '170px' },
  { key: 'duration_ms', label: t('workspace.subordinate.columnDuration'), width: '110px' },
  { key: 'actions', label: t('common.actions'), width: '190px' },
]);

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} md`;
  return `${(ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`;
}

// ---- formulir pembuatan tugas ----
const formOpen = ref(false);
const title = ref('');
const instruction = ref('');
const titleError = ref('');
const instructionError = ref('');
const creating = ref(false);

function openForm(): void {
  title.value = '';
  instruction.value = '';
  titleError.value = '';
  instructionError.value = '';
  formOpen.value = true;
}

async function submitCreate(): Promise<void> {
  titleError.value = title.value.trim().length >= 3 ? '' : t('workspace.subordinate.titleRequired');
  instructionError.value =
    instruction.value.trim().length >= 5 ? '' : t('workspace.subordinate.instructionRequired');
  if (titleError.value || instructionError.value) return;

  creating.value = true;
  try {
    await createTask({ title: title.value.trim(), instruction: instruction.value.trim() });
    formOpen.value = false;
    toast.push({ variant: 'success', title: t('workspace.subordinate.created') });
    await load();
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
      },
      5000,
    );
  } finally {
    creating.value = false;
  }
}

// ---- aksi jalankan / batalkan ----
const actingId = ref<string | null>(null);

async function run(id: string): Promise<void> {
  actingId.value = id;
  try {
    await runTask(id);
    toast.push({ variant: 'success', title: t('workspace.subordinate.runStarted') });
    await load();
    void refreshUntilSettled();
    if (detail.value?.id === id) void refreshDetail();
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
      },
      5000,
    );
  } finally {
    actingId.value = null;
  }
}

async function cancel(id: string): Promise<void> {
  actingId.value = id;
  try {
    await cancelTask(id);
    toast.push({ variant: 'success', title: t('workspace.subordinate.cancelled') });
    await load();
    if (detail.value?.id === id) void refreshDetail();
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
      },
      5000,
    );
  } finally {
    actingId.value = null;
  }
}

// Polling ringan: selama ada tugas terbuka, daftar disegarkan tiap 2 detik.
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pollCount = 0;

async function refreshUntilSettled(): Promise<void> {
  clearTimeout(pollTimer);
  pollCount = 0;
  await pollOnce();
}

async function pollOnce(): Promise<void> {
  await load();
  const hasOpen = items.value.some((task) => OPEN_STATUSES.includes(task.status));
  pollCount += 1;
  if (hasOpen && pollCount < 120) {
    pollTimer = setTimeout(() => void pollOnce(), 2000);
  }
}

// ---- detail tugas + jejak eksekusi ----
const detailOpen = ref(false);
const detail = ref<TaskDetail | null>(null);
const detailLoading = ref(false);
let detailTimer: ReturnType<typeof setTimeout> | undefined;

async function openDetail(id: string): Promise<void> {
  detailOpen.value = true;
  detailLoading.value = true;
  clearTimeout(detailTimer);
  try {
    detail.value = await taskDetail(id);
    scheduleDetailRefresh();
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.loadFailed'),
      },
      5000,
    );
  } finally {
    detailLoading.value = false;
  }
}

function scheduleDetailRefresh(): void {
  clearTimeout(detailTimer);
  if (detail.value && OPEN_STATUSES.includes(detail.value.status) && detailOpen.value) {
    detailTimer = setTimeout(() => void refreshDetail(), 2000);
  }
}

async function refreshDetail(): Promise<void> {
  if (!detail.value) return;
  try {
    detail.value = await taskDetail(detail.value.id);
    scheduleDetailRefresh();
  } catch {
    clearTimeout(detailTimer);
  }
}

watch(detailOpen, (open) => {
  if (!open) {
    clearTimeout(detailTimer);
    detail.value = null;
  }
});

function eventVariant(eventType: string): 'brand' | 'danger' | 'success' | 'warning' | 'informative' | 'neutral' {
  if (eventType === 'completed') return 'success';
  if (eventType === 'failed') return 'danger';
  if (eventType === 'cancelled') return 'warning';
  if (eventType === 'running') return 'brand';
  return 'informative';
}

function payloadText(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return '';
  }
}

onMounted(() => {
  void load();
});

onBeforeUnmount(() => {
  clearTimeout(pollTimer);
  clearTimeout(detailTimer);
});
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('workspace.subordinate.title')"
      :description="t('workspace.subordinate.description')"
    >
      <template #actions>
        <CaButton variant="primary" @click="openForm">
          {{ t('workspace.subordinate.addButton') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <div class="tasks__filters">
      <div class="tasks__filter">
        <CaSelect v-model="statusFilter" :options="statusOptions" />
      </div>
      <div class="tasks__spacer" />
      <CaButton variant="secondary" :loading="loading" @click="load">
        {{ t('common.refresh') }}
      </CaButton>
    </div>

    <p v-if="error" class="tasks__error" role="alert">{{ error }}</p>

    <CaTable
      table-key="ai-tasks"
      :columns="columns"
      :rows="items"
      :row-key="(row) => row.id"
      :loading="loading"
    >
      <template #cell-title="{ row }">
        <button type="button" class="tasks__title" @click="openDetail(row.id)">
          {{ row.title }}
        </button>
      </template>
      <template #cell-status="{ row }">
        <CaBadge :variant="statusVariant(row.status)">{{ statusLabel(row.status) }}</CaBadge>
      </template>
      <template #cell-created_at="{ row }">
        {{ formatDateTime(row.created_at) }}
      </template>
      <template #cell-duration_ms="{ row }">
        {{ formatDuration(row.duration_ms) }}
      </template>
      <template #cell-actions="{ row }">
        <div class="tasks__actions">
          <CaButton
            v-if="RUNNABLE_STATUSES.includes(row.status)"
            size="small"
            variant="primary"
            :loading="actingId === row.id"
            @click="run(row.id)"
          >
            <template #icon-start>
              <CaIcon name="play" :size="14" />
            </template>
            {{ t('workspace.subordinate.run') }}
          </CaButton>
          <CaButton
            v-if="OPEN_STATUSES.includes(row.status)"
            size="small"
            variant="outline"
            :disabled="actingId === row.id"
            @click="cancel(row.id)"
          >
            <template #icon-start>
              <CaIcon name="stop" :size="14" />
            </template>
            {{ t('workspace.subordinate.cancel') }}
          </CaButton>
          <CaButton size="small" variant="subtle" @click="openDetail(row.id)">
            {{ t('common.details') }}
          </CaButton>
        </div>
      </template>
    </CaTable>

    <CaPagination :page="page" :limit="pageSize" :total="total" @change="goPage" />

    <CaDialog
      v-model:open="formOpen"
      :title="t('workspace.subordinate.createTitle')"
      :subtitle="t('workspace.subordinate.createSubtitle')"
      size="medium"
    >
      <div class="tasks__form">
        <CaField :label="t('workspace.subordinate.formTitle')" :error="titleError" required>
          <CaInput v-model="title" :invalid="!!titleError" />
        </CaField>
        <CaField
          :label="t('workspace.subordinate.formInstruction')"
          :hint="t('workspace.subordinate.formInstructionHint')"
          :error="instructionError"
          required
        >
          <textarea
            v-model="instruction"
            class="tasks__textarea"
            rows="6"
            :class="{ 'tasks__textarea--invalid': !!instructionError }"
          />
        </CaField>
      </div>
      <template #footer>
        <CaButton variant="subtle" @click="formOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="creating" @click="submitCreate">
          {{ t('workspace.subordinate.create') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="detailOpen"
      :title="detail?.title ?? t('common.details')"
      :subtitle="detail ? statusLabel(detail.status) : ''"
      size="large"
    >
      <div v-if="detailLoading && !detail" class="tasks__detail-loading">
        <CaIcon name="sparkle" :size="20" />
      </div>
      <div v-else-if="detail" class="tasks__detail">
        <div class="tasks__detail-head">
          <CaBadge :variant="statusVariant(detail.status)">{{ statusLabel(detail.status) }}</CaBadge>
          <span class="tasks__detail-time">{{ formatDateTime(detail.created_at) }}</span>
        </div>

        <dl class="tasks__meta">
          <div class="tasks__meta-row">
            <dt>{{ t('workspace.subordinate.instructionLabel') }}</dt>
            <dd class="tasks__instruction">{{ detail.instruction }}</dd>
          </div>
          <div class="tasks__meta-row">
            <dt>{{ t('workspace.subordinate.metricsModel') }}</dt>
            <dd>{{ detail.model ?? '—' }}</dd>
          </div>
          <div class="tasks__meta-row">
            <dt>{{ t('workspace.subordinate.metricsTokens') }}</dt>
            <dd>
              {{
                detail.tokens_in === null
                  ? '—'
                  : `${detail.tokens_in} → ${detail.tokens_out ?? 0}`
              }}
            </dd>
          </div>
          <div class="tasks__meta-row">
            <dt>{{ t('workspace.subordinate.metricsDuration') }}</dt>
            <dd>{{ formatDuration(detail.duration_ms) }}</dd>
          </div>
        </dl>

        <template v-if="detail.status === 'completed' && detail.result">
          <h3 class="tasks__section">{{ t('workspace.subordinate.resultTitle') }}</h3>
          <p class="tasks__result">{{ detail.result }}</p>
        </template>

        <template v-if="detail.status === 'failed' && detail.error_message">
          <h3 class="tasks__section">{{ t('workspace.subordinate.errorTitle') }}</h3>
          <p class="tasks__error-text">{{ detail.error_message }}</p>
        </template>

        <h3 class="tasks__section">{{ t('workspace.subordinate.eventsTitle') }}</h3>
        <ol class="tasks__events">
          <li v-for="event in detail.events" :key="event.id" class="tasks__event">
            <span class="tasks__event-dot" :class="`tasks__event-dot--${eventVariant(event.event_type)}`" />
            <div class="tasks__event-body">
              <div class="tasks__event-head">
                <CaBadge size="small" :variant="eventVariant(event.event_type)">
                  {{ event.event_type }}
                </CaBadge>
                <span class="tasks__event-time">{{ formatDateTime(event.created_at) }}</span>
              </div>
              <p class="tasks__event-message">{{ event.message }}</p>
              <code v-if="Object.keys(event.payload).length" class="tasks__event-payload">
                {{ payloadText(event.payload) }}
              </code>
            </div>
          </li>
        </ol>
      </div>
      <template #footer>
        <CaButton
          v-if="detail && RUNNABLE_STATUSES.includes(detail.status)"
          variant="primary"
          :loading="actingId === detail.id"
          @click="run(detail.id)"
        >
          {{ t('workspace.subordinate.run') }}
        </CaButton>
        <CaButton
          v-if="detail && OPEN_STATUSES.includes(detail.status)"
          variant="outline"
          :disabled="actingId === detail.id"
          @click="cancel(detail.id)"
        >
          {{ t('workspace.subordinate.cancel') }}
        </CaButton>
        <CaButton variant="subtle" @click="detailOpen = false">{{ t('common.close') }}</CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.tasks__filters {
  display: flex;
  align-items: flex-end;
  gap: var(--ca-space-4);
  margin-bottom: var(--ca-space-4);
}

.tasks__filter {
  width: 220px;
}

.tasks__spacer {
  flex: 1;
}

.tasks__error {
  margin: 0 0 var(--ca-space-4);
  color: var(--ca-danger-fg);
  font-size: var(--ca-text-200);
}

.tasks__title {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--ca-color-link);
  cursor: pointer;
  text-align: left;
}

.tasks__title:hover {
  text-decoration: underline;
}

.tasks__actions {
  display: flex;
  gap: var(--ca-space-2);
  flex-wrap: wrap;
}

.tasks__form {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-5);
}

.tasks__textarea {
  width: 100%;
  resize: vertical;
  min-height: 120px;
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  padding: var(--ca-space-3) var(--ca-space-4);
  font-family: var(--ca-font-family);
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  outline: none;
}

.tasks__textarea:focus-visible {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}

.tasks__textarea--invalid {
  border-color: var(--ca-danger-fg);
}

.tasks__detail-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-10);
  color: var(--ca-fg-3);
}

.tasks__detail-head {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  margin-bottom: var(--ca-space-5);
}

.tasks__detail-time {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.tasks__meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.tasks__meta-row {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: var(--ca-space-4);
}

.tasks__meta-row dt {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.tasks__meta-row dd {
  margin: 0;
  color: var(--ca-fg-1);
  font-size: var(--ca-text-200);
}

.tasks__instruction {
  white-space: pre-wrap;
  word-break: break-word;
}

.tasks__section {
  margin: var(--ca-space-7) 0 var(--ca-space-3);
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.tasks__result {
  margin: 0;
  padding: var(--ca-space-5);
  background: var(--ca-bg-surface-3);
  border-radius: var(--ca-radius-md);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  color: var(--ca-fg-1);
  max-height: 320px;
  overflow-y: auto;
}

.tasks__error-text {
  margin: 0;
  padding: var(--ca-space-5);
  background: var(--ca-color-danger-bg);
  border-radius: var(--ca-radius-md);
  color: var(--ca-danger-fg);
  font-size: var(--ca-text-200);
  white-space: pre-wrap;
  word-break: break-word;
}

.tasks__events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.tasks__event {
  position: relative;
  display: flex;
  gap: var(--ca-space-4);
  padding: var(--ca-space-3) 0;
}

.tasks__event:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 22px;
  bottom: -6px;
  width: 2px;
  background: var(--ca-stroke-2);
}

.tasks__event-dot {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  margin-top: 4px;
  border-radius: var(--ca-radius-circular);
  background: var(--ca-fg-3);
}

.tasks__event-dot--success {
  background: var(--ca-success-stroke);
}

.tasks__event-dot--danger {
  background: var(--ca-danger-stroke);
}

.tasks__event-dot--warning {
  background: var(--ca-warning-stroke);
}

.tasks__event-dot--brand {
  background: var(--ca-color-brand);
}

.tasks__event-dot--informative {
  background: var(--ca-info-stroke);
}

.tasks__event-body {
  min-width: 0;
  flex: 1;
}

.tasks__event-head {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
}

.tasks__event-time {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-100);
}

.tasks__event-message {
  margin: var(--ca-space-1) 0 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
  white-space: pre-wrap;
  word-break: break-word;
}

.tasks__event-payload {
  display: block;
  margin-top: var(--ca-space-2);
  font-family: var(--ca-font-family-mono);
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
