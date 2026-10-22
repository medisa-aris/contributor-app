<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { AI_TASK_STATUSES, type AiTaskStatus, type ConversationMode } from '@bara/shared';
import {
  conversationDetail,
  deleteConversation,
  listConversations,
  listTasks,
  taskDetail,
  type ConversationDetail,
  type ConversationSummary,
  type TaskDetail,
  type TaskRow,
} from '@/api/ai';
import { ApiError } from '@/api/http';
import { usePagedList } from '@/composables/usePagedList';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaEmptyState,
  CaIcon,
  CaPageHeader,
  CaPagination,
  CaSelect,
  CaTable,
  CaTabs,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';
import MarkdownContent from '@/components/ai/MarkdownContent.vue';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const toast = useToastStore();

const tab = ref<'conversations' | 'tasks'>('conversations');

// ---- tab percakapan ----
const modeFilter = ref('');
const modeOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('common.all') },
  { value: 'second_brain', label: t('workspace.history.modeSecondBrain') },
  { value: 'counterpart', label: t('workspace.history.modeCounterpart') },
]);

const {
  items: convItems,
  total: convTotal,
  page: convPage,
  pageSize: convPageSize,
  loading: convLoading,
  error: convError,
  load: loadConversations,
  setFilter: setConvFilter,
  goPage: convGoPage,
} = usePagedList<ConversationSummary>((query) =>
  listConversations({
    mode: (query.mode as ConversationMode | undefined) ?? undefined,
    page: query.page,
    pageSize: query.pageSize,
  }),
);

watch(modeFilter, (value) => {
  setConvFilter({ mode: value || undefined });
});

const conversationColumns = computed<CaTableColumn[]>(() => [
  { key: 'title', label: t('workspace.history.columnTitle') },
  { key: 'mode', label: t('workspace.history.columnMode'), width: '150px' },
  { key: 'updated_at', label: t('workspace.history.columnUpdated'), width: '170px' },
  { key: 'actions', label: t('common.actions'), width: '200px' },
]);

function modeLabel(mode: ConversationMode): string {
  return mode === 'second_brain'
    ? t('workspace.history.modeSecondBrain')
    : t('workspace.history.modeCounterpart');
}

function modeVariant(mode: ConversationMode): 'brand' | 'informative' {
  return mode === 'second_brain' ? 'informative' : 'brand';
}

const conversationDialogOpen = ref(false);
const conversationLoading = ref(false);
const conversationSelected = ref<ConversationDetail | null>(null);

async function openConversation(id: string): Promise<void> {
  conversationDialogOpen.value = true;
  conversationLoading.value = true;
  try {
    conversationSelected.value = await conversationDetail(id);
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.loadFailed'),
      },
      5000,
    );
  } finally {
    conversationLoading.value = false;
  }
}

async function removeConversation(id: string): Promise<void> {
  try {
    await deleteConversation(id);
    toast.push({ variant: 'success', title: t('workspace.chat.conversationDeleted') });
    if (conversationSelected.value?.id === id) conversationDialogOpen.value = false;
    await loadConversations();
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
      },
      5000,
    );
  }
}

// ---- tab tugas ----
const statusFilter = ref('');
const statusOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('common.all') },
  ...AI_TASK_STATUSES.map((status) => ({
    value: status,
    label: t(`workspace.subordinate.status.${status}`),
  })),
]);

const {
  items: taskItems,
  total: taskTotal,
  page: taskPage,
  pageSize: taskPageSize,
  loading: taskLoading,
  error: taskError,
  load: loadTasks,
  setFilter: setTaskFilter,
  goPage: taskGoPage,
} = usePagedList<TaskRow>((query) =>
  listTasks({
    status: (query.status as AiTaskStatus | undefined) ?? undefined,
    page: query.page,
    pageSize: query.pageSize,
  }),
);

watch(statusFilter, (value) => {
  setTaskFilter({ status: value || undefined });
});

const taskColumns = computed<CaTableColumn[]>(() => [
  { key: 'title', label: t('workspace.history.columnTitle') },
  { key: 'status', label: t('workspace.history.columnStatus'), width: '150px' },
  { key: 'created_at', label: t('workspace.history.columnCreated'), width: '170px' },
]);

function statusVariant(
  status: AiTaskStatus,
): 'brand' | 'danger' | 'success' | 'warning' | 'informative' | 'neutral' {
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

function statusLabel(status: AiTaskStatus): string {
  return t(`workspace.subordinate.status.${status}`);
}

const taskDialogOpen = ref(false);
const taskLoadingDetail = ref(false);
const taskSelected = ref<TaskDetail | null>(null);

async function openTask(id: string): Promise<void> {
  taskDialogOpen.value = true;
  taskLoadingDetail.value = true;
  try {
    taskSelected.value = await taskDetail(id);
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.loadFailed'),
      },
      5000,
    );
  } finally {
    taskLoadingDetail.value = false;
  }
}

let conversationsLoaded = false;
let tasksLoaded = false;

watch(tab, () => {
  if (tab.value === 'conversations' && !conversationsLoaded) {
    conversationsLoaded = true;
    void loadConversations();
  }
  if (tab.value === 'tasks' && !tasksLoaded) {
    tasksLoaded = true;
    void loadTasks();
  }
});

onMounted(() => {
  conversationsLoaded = true;
  void loadConversations();
});
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('workspace.history.title')"
      :description="t('workspace.history.description')"
    />

    <CaTabs
      v-model="tab"
      :items="[
        { key: 'conversations', label: t('workspace.history.tabConversations') },
        { key: 'tasks', label: t('workspace.history.tabTasks') },
      ]"
    />

    <template v-if="tab === 'conversations'">
      <div class="history__filters">
        <div class="history__filter">
          <CaSelect v-model="modeFilter" :options="modeOptions" />
        </div>
        <div class="history__spacer" />
        <CaButton variant="secondary" :loading="convLoading" @click="loadConversations">
          {{ t('common.refresh') }}
        </CaButton>
      </div>

      <p v-if="convError" class="history__error" role="alert">{{ convError }}</p>

      <CaTable
        table-key="history-conversations"
        :columns="conversationColumns"
        :rows="convItems"
        :row-key="(row) => row.id"
        :loading="convLoading"
      >
        <template #cell-title="{ row }">
          <button type="button" class="history__title" @click="openConversation(row.id)">
            {{ row.title }}
          </button>
        </template>
        <template #cell-mode="{ row }">
          <CaBadge :variant="modeVariant(row.mode)">{{ modeLabel(row.mode) }}</CaBadge>
        </template>
        <template #cell-updated_at="{ row }">
          {{ formatDateTime(row.updated_at) }}
        </template>
        <template #cell-actions="{ row }">
          <div class="history__actions">
            <CaButton size="small" variant="subtle" @click="openConversation(row.id)">
              {{ t('common.details') }}
            </CaButton>
            <CaButton size="small" variant="transparent" @click="removeConversation(row.id)">
              {{ t('common.delete') }}
            </CaButton>
          </div>
        </template>
      </CaTable>

      <CaPagination
        :page="convPage"
        :limit="convPageSize"
        :total="convTotal"
        @change="convGoPage"
      />
    </template>

    <template v-else>
      <div class="history__filters">
        <div class="history__filter">
          <CaSelect v-model="statusFilter" :options="statusOptions" />
        </div>
        <div class="history__spacer" />
        <CaButton variant="secondary" :loading="taskLoading" @click="loadTasks">
          {{ t('common.refresh') }}
        </CaButton>
      </div>

      <p v-if="taskError" class="history__error" role="alert">{{ taskError }}</p>

      <CaTable
        table-key="history-tasks"
        :columns="taskColumns"
        :rows="taskItems"
        :row-key="(row) => row.id"
        :loading="taskLoading"
      >
        <template #cell-title="{ row }">
          <button type="button" class="history__title" @click="openTask(row.id)">
            {{ row.title }}
          </button>
        </template>
        <template #cell-status="{ row }">
          <CaBadge :variant="statusVariant(row.status)">{{ statusLabel(row.status) }}</CaBadge>
        </template>
        <template #cell-created_at="{ row }">
          {{ formatDateTime(row.created_at) }}
        </template>
      </CaTable>

      <CaPagination
        :page="taskPage"
        :limit="taskPageSize"
        :total="taskTotal"
        @change="taskGoPage"
      />
    </template>

    <CaDialog
      v-model:open="conversationDialogOpen"
      :title="conversationSelected?.title ?? t('common.details')"
      :subtitle="conversationSelected ? modeLabel(conversationSelected.mode) : ''"
      size="large"
    >
      <div v-if="conversationLoading && !conversationSelected" class="history__loading">
        <CaIcon name="sparkle" :size="20" />
      </div>
      <div v-else-if="conversationSelected" class="history__messages">
        <CaEmptyState
          v-if="conversationSelected.messages.length === 0"
          :title="t('workspace.chat.historyEmpty')"
        />
        <article
          v-for="message in conversationSelected.messages"
          :key="message.id"
          class="history__message"
          :class="`history__message--${message.role}`"
        >
          <p class="history__message-text">{{ message.content }}</p>
          <footer v-if="message.role === 'assistant'" class="history__message-meta">
            <span v-if="message.model">{{ message.model }}</span>
            <span v-if="message.created_at">{{ formatDateTime(message.created_at) }}</span>
          </footer>
        </article>
      </div>
      <template #footer>
        <CaButton
          v-if="conversationSelected"
          variant="outline"
          @click="removeConversation(conversationSelected.id)"
        >
          {{ t('common.delete') }}
        </CaButton>
        <CaButton variant="subtle" @click="conversationDialogOpen = false">
          {{ t('common.close') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="taskDialogOpen"
      :title="taskSelected?.title ?? t('common.details')"
      :subtitle="taskSelected ? statusLabel(taskSelected.status) : ''"
      size="large"
    >
      <div v-if="taskLoadingDetail && !taskSelected" class="history__loading">
        <CaIcon name="sparkle" :size="20" />
      </div>
      <div v-else-if="taskSelected" class="history__task">
        <dl class="history__task-meta">
          <div>
            <dt>{{ t('workspace.subordinate.instructionLabel') }}</dt>
            <dd class="history__task-instruction">{{ taskSelected.instruction }}</dd>
          </div>
          <div>
            <dt>{{ t('workspace.subordinate.metricsModel') }}</dt>
            <dd>{{ taskSelected.model ?? '—' }}</dd>
          </div>
        </dl>
        <template v-if="taskSelected.status === 'completed' && taskSelected.result">
          <h3 class="history__section">{{ t('workspace.subordinate.resultTitle') }}</h3>
          <div class="history__result"><MarkdownContent :content="taskSelected.result" /></div>
        </template>
        <template v-if="taskSelected.status === 'failed' && taskSelected.error_message">
          <h3 class="history__section">{{ t('workspace.subordinate.errorTitle') }}</h3>
          <p class="history__error-text">{{ taskSelected.error_message }}</p>
        </template>
        <h3 class="history__section">{{ t('workspace.subordinate.eventsTitle') }}</h3>
        <ol class="history__events">
          <li v-for="event in taskSelected.events" :key="event.id" class="history__event">
            <span class="history__event-dot" aria-hidden="true" />
            <div class="history__event-body">
              <div class="history__event-head">
                <CaBadge size="small" variant="neutral">{{ event.event_type }}</CaBadge>
                <span class="history__event-time">{{ formatDateTime(event.created_at) }}</span>
              </div>
              <p class="history__event-message">{{ event.message }}</p>
            </div>
          </li>
        </ol>
      </div>
      <template #footer>
        <CaButton variant="subtle" @click="taskDialogOpen = false">{{
          t('common.close')
        }}</CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.history__filters {
  display: flex;
  align-items: flex-end;
  gap: var(--ca-space-4);
  margin: var(--ca-space-4) 0;
}

.history__filter {
  width: 220px;
}

.history__spacer {
  flex: 1;
}

.history__error {
  margin: 0 0 var(--ca-space-4);
  color: var(--ca-danger-fg);
  font-size: var(--ca-text-200);
}

.history__title {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--ca-color-link);
  cursor: pointer;
  text-align: left;
}

.history__title:hover {
  text-decoration: underline;
}

.history__actions {
  display: flex;
  gap: var(--ca-space-2);
}

.history__loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-10);
  color: var(--ca-fg-3);
}

.history__messages {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  max-height: 60vh;
  overflow-y: auto;
}

.history__message {
  max-width: 85%;
  border-radius: var(--ca-radius-lg);
  padding: var(--ca-space-4) var(--ca-space-5);
}

.history__message--user {
  align-self: flex-end;
  background: var(--ca-color-brand-subtle);
}

.history__message--assistant {
  align-self: flex-start;
  background: var(--ca-bg-surface-3);
  border: 1px solid var(--ca-stroke-2);
}

.history__message-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  color: var(--ca-fg-1);
}

.history__message-meta {
  margin-top: var(--ca-space-2);
  display: flex;
  gap: var(--ca-space-3);
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.history__task-meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.history__task-meta dt {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.history__task-meta dd {
  margin: 2px 0 0;
  color: var(--ca-fg-1);
  font-size: var(--ca-text-200);
}

.history__task-instruction {
  white-space: pre-wrap;
  word-break: break-word;
}

.history__section {
  margin: var(--ca-space-6) 0 var(--ca-space-3);
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.history__result {
  margin: 0;
  padding: var(--ca-space-5);
  background: var(--ca-bg-surface-3);
  border-radius: var(--ca-radius-md);
  word-break: break-word;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  max-height: 280px;
  overflow-y: auto;
}

.history__error-text {
  margin: 0;
  padding: var(--ca-space-5);
  background: var(--ca-danger-bg);
  border-radius: var(--ca-radius-md);
  color: var(--ca-danger-fg);
  font-size: var(--ca-text-200);
  white-space: pre-wrap;
  word-break: break-word;
}

.history__events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.history__event {
  position: relative;
  display: flex;
  gap: var(--ca-space-4);
  padding: var(--ca-space-2) 0;
}

.history__event:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 20px;
  bottom: -6px;
  width: 2px;
  background: var(--ca-stroke-2);
}

.history__event-dot {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  margin-top: 4px;
  border-radius: var(--ca-radius-circular);
  background: var(--ca-fg-3);
}

.history__event-body {
  min-width: 0;
  flex: 1;
}

.history__event-head {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
}

.history__event-time {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-100);
}

.history__event-message {
  margin: var(--ca-space-1) 0 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
