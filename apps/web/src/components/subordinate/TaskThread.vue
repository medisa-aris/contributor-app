<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import type { TaskEventRow } from '@/api/ai/types';
import {
  agentTaskDetail,
  cancelAgentTask,
  decideAgentTaskApproval,
  FINAL_STATUSES,
  replyAgentTask,
  retryAgentTask,
  type AgentTaskDetail,
  type PersonalAgent,
} from '@/api/subordinate';
import { useToastStore } from '@/stores/toast.store';
import { formatDateTime, formatNumber } from '@/utils/format';
import { CaBadge, CaButton, CaDialog, CaIcon, CaSpinner, CaTextarea } from '@/components/ui';
import MarkdownContent from '@/components/ai/MarkdownContent.vue';
import AgentAvatar from './AgentAvatar.vue';

/**
 * Utas satu tugas agent/grup: pesan agent, langkah tool, delegasi, diskusi, persetujuan,
 * klarifikasi, dan hasil akhir. Polling inkremental (afterEventId) selama tugas belum final.
 */
const props = defineProps<{ taskId: string | null; agents: PersonalAgent[] }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const toast = useToastStore();

const task = ref<AgentTaskDetail | null>(null);
const events = ref<TaskEventRow[]>([]);
const loading = ref(false);
const error = ref('');
const replyText = ref('');
const busy = ref<string | null>(null);
const expandedTools = ref<Set<string>>(new Set());
let timer: number | undefined;

const isFinal = computed(() => (task.value ? FINAL_STATUSES.includes(task.value.status) : true));
const pendingApproval = computed(() => {
  if (task.value?.status !== 'awaiting_approval') return null;
  return [...events.value].reverse().find((e) => e.event_type === 'approval_required') ?? null;
});
const pendingQuestion = computed(() => {
  if (task.value?.status !== 'needs_input') return null;
  return [...events.value].reverse().find((e) => e.event_type === 'needs_input') ?? null;
});
const canReply = computed(
  () => task.value !== null && (task.value.status === 'needs_input' || isFinal.value) && task.value.group_mode !== 'discussion',
);

function colorFor(agentId: unknown): string | null {
  return props.agents.find((agent) => agent.id === agentId)?.avatar_color ?? null;
}

async function load(initial = false): Promise<void> {
  if (!props.taskId) return;
  if (initial) {
    loading.value = true;
    events.value = [];
    task.value = null;
  }
  try {
    const afterId = initial ? 0 : Number(events.value.at(-1)?.id ?? 0);
    const detail = await agentTaskDetail(props.taskId, afterId);
    task.value = detail;
    if (detail.events.length > 0) events.value = [...events.value, ...detail.events];
    error.value = '';
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
  schedule();
}

function schedule(): void {
  window.clearTimeout(timer);
  if (!open.value || isFinal.value || ['awaiting_approval', 'needs_input'].includes(task.value?.status ?? '')) return;
  timer = window.setTimeout(() => void load(), 1500);
}

watch(
  [open, () => props.taskId],
  ([value]) => {
    window.clearTimeout(timer);
    if (value && props.taskId) void load(true);
  },
  { immediate: true },
);

onBeforeUnmount(() => window.clearTimeout(timer));

async function act(key: string, fn: () => Promise<unknown>, success?: string): Promise<void> {
  busy.value = key;
  try {
    await fn();
    if (success) toast.push({ variant: 'success', title: success }, 3000);
    emit('changed');
    await load();
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') }, 5000);
  } finally {
    busy.value = null;
  }
}

function decide(decision: 'approved' | 'rejected'): void {
  const approvalId = pendingApproval.value?.payload.approvalId as string | undefined;
  if (!task.value || !approvalId) return;
  void act(
    decision,
    () => decideAgentTaskApproval(task.value!.id, approvalId, decision),
    decision === 'approved' ? t('workspace.tools.approvedToast') : t('workspace.tools.rejectedToast'),
  );
}

function sendReply(): void {
  const text = replyText.value.trim();
  if (!task.value || !text) return;
  void act('reply', async () => {
    await replyAgentTask(task.value!.id, text);
    replyText.value = '';
  });
}

function toggleTool(id: string): void {
  const next = new Set(expandedTools.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedTools.value = next;
}

function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'informative' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'awaiting_approval' || status === 'needs_input') return 'warning';
  if (status === 'running') return 'informative';
  return 'neutral';
}

/** Event yang ditampilkan sebagai baris timeline (event teknis disembunyikan). */
const timeline = computed(() =>
  events.value.filter((event) => !['validating'].includes(event.event_type)),
);

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
}

function statement(payload: Record<string, unknown>): string {
  const input = payload.input as Record<string, unknown> | undefined;
  if (typeof input?.sql === 'string') return input.sql;
  if (typeof payload.statement === 'string') return payload.statement;
  return input && Object.keys(input).length ? JSON.stringify(input, null, 2) : '';
}
</script>

<template>
  <CaDialog v-model:open="open" size="large" :title="task?.title ?? t('subordinate.tasks.loading')">
    <div v-if="loading" class="tt__loading"><CaSpinner /></div>
    <p v-else-if="error" class="admin-error" role="alert">{{ error }}</p>
    <template v-else-if="task">
      <div class="tt__meta">
        <CaBadge :variant="statusVariant(task.status)">{{ t(`workspace.subordinate.status.${task.status}`) }}</CaBadge>
        <span v-if="task.group_name">
          {{ t('subordinate.tasks.byGroup', { name: task.group_name }) }} ·
          {{ task.group_mode === 'discussion' ? t('subordinate.groups.modeDiscussion') : t('subordinate.groups.modeDelegate') }}
        </span>
        <span v-else-if="task.agent_name">{{ t('subordinate.tasks.byAgent', { name: task.agent_name }) }}</span>
        <span>{{ formatDateTime(task.created_at) }}</span>
        <span v-if="task.tokens_in !== null">
          {{ t('subordinate.tasks.tokens', { input: formatNumber(task.tokens_in ?? 0), output: formatNumber(task.tokens_out ?? 0) }) }}
        </span>
      </div>

      <div class="tt__instruction">
        <span class="tt__label">{{ t('workspace.subordinate.instructionLabel') }}</span>
        <p>{{ task.instruction }}</p>
      </div>

      <ol class="tt__timeline">
        <li v-for="event in timeline" :key="event.id" class="tt__event" :class="`tt__event--${event.event_type}`">
          <!-- Pesan agent / diskusi / hasil delegasi -->
          <template v-if="['message', 'discussion', 'delegate_result'].includes(event.event_type) && event.payload.agentName">
            <div class="tt__bubble">
              <AgentAvatar :name="str(event.payload.agentName)" :color="colorFor(event.payload.agentId)" :size="28" />
              <div class="tt__bubble-body">
                <div class="tt__bubble-head">
                  <strong>{{ str(event.payload.agentName) }}</strong>
                  <CaBadge v-if="event.payload.leader" size="small" variant="warning">Leader</CaBadge>
                  <span v-if="event.payload.round" class="tt__muted">{{ t('subordinate.tasks.round', { n: event.payload.round }) }}</span>
                  <span v-if="event.event_type === 'delegate_result'" class="tt__muted">{{ t('subordinate.tasks.delegateResult') }}</span>
                </div>
                <MarkdownContent :content="str(event.payload.content) || event.message" />
              </div>
            </div>
          </template>
          <!-- Delegasi -->
          <div v-else-if="event.event_type === 'delegated'" class="tt__line">
            <CaIcon name="send" :size="13" />
            <span>
              <strong>{{ t('subordinate.tasks.delegatedTo', { name: str(event.payload.agentName) }) }}</strong>
              {{ str(event.payload.instruction) }}
            </span>
          </div>
          <!-- Langkah tool -->
          <div v-else-if="event.event_type === 'tool_call' || event.event_type === 'tool_result'" class="tt__tool">
            <button type="button" class="tt__tool-head" @click="toggleTool(String(event.id))">
              <CaIcon name="plug" :size="12" />
              <span v-if="event.payload.agentName" class="tt__muted">{{ str(event.payload.agentName) }} ·</span>
              <span>{{ event.message }}</span>
              <CaBadge
                v-if="event.event_type === 'tool_result'"
                size="small"
                :variant="event.payload.status === 'ok' ? 'success' : event.payload.status === 'error' ? 'danger' : 'warning'"
              >
                {{ t(`workspace.tools.status.${str(event.payload.status) || 'ok'}`) }}
              </CaBadge>
            </button>
            <pre v-if="expandedTools.has(String(event.id)) && statement(event.payload)" class="tt__code">{{ statement(event.payload) }}</pre>
          </div>
          <!-- Persetujuan -->
          <div v-else-if="event.event_type === 'approval_required'" class="tt__approval">
            <div class="tt__line"><CaIcon name="shield" :size="14" /><strong>{{ t('workspace.tools.approvalTitle') }}</strong></div>
            <p v-if="event.payload.purpose" class="tt__muted">{{ str(event.payload.purpose) }}</p>
            <span v-if="event.payload.connector" class="tt__muted">{{ str(event.payload.connector) }}</span>
            <pre class="tt__code">{{ str(event.payload.statement) }}</pre>
            <div v-if="pendingApproval?.id === event.id" class="tt__approval-actions">
              <CaButton size="small" variant="primary" :loading="busy === 'approved'" :disabled="busy !== null" @click="decide('approved')">
                {{ t('workspace.tools.approve') }}
              </CaButton>
              <CaButton size="small" variant="secondary" :loading="busy === 'rejected'" :disabled="busy !== null" @click="decide('rejected')">
                {{ t('workspace.tools.reject') }}
              </CaButton>
            </div>
          </div>
          <!-- Klarifikasi -->
          <div v-else-if="event.event_type === 'needs_input'" class="tt__question">
            <CaIcon name="chat" :size="14" />
            <span><strong>{{ t('subordinate.tasks.question') }}</strong> {{ event.message }}</span>
          </div>
          <div v-else-if="event.event_type === 'user_message'" class="tt__user">
            <span class="tt__label">{{ t('subordinate.tasks.you') }}</span>
            <p>{{ str(event.payload.content) || event.message }}</p>
          </div>
          <div v-else-if="event.event_type === 'round'" class="tt__divider">{{ event.message }}</div>
          <div v-else class="tt__line tt__muted">
            <span class="tt__dot" />
            <span>{{ event.message }}</span>
            <span class="tt__time">{{ formatDateTime(event.created_at) }}</span>
          </div>
        </li>
        <li v-if="!isFinal && task.status !== 'awaiting_approval' && task.status !== 'needs_input'" class="tt__working">
          <CaSpinner size="tiny" /> {{ t('subordinate.tasks.working') }}
        </li>
      </ol>

      <div v-if="task.children.length" class="tt__children">
        <span class="tt__label">{{ t('subordinate.tasks.children') }}</span>
        <ul>
          <li v-for="child in task.children" :key="child.id">
            <CaBadge size="small" :variant="statusVariant(child.status)">{{ t(`workspace.subordinate.status.${child.status}`) }}</CaBadge>
            {{ child.agent_name }} — {{ child.title }}
          </li>
        </ul>
      </div>

      <section v-if="task.status === 'completed' && task.result" class="tt__result">
        <h3>{{ t('workspace.subordinate.resultTitle') }}</h3>
        <MarkdownContent :content="task.result" />
      </section>
      <p v-if="task.status === 'failed' && task.error_message" class="admin-error" role="alert">{{ task.error_message }}</p>

      <form v-if="canReply" class="tt__reply" @submit.prevent="sendReply">
        <CaTextarea
          v-model="replyText"
          :rows="2"
          :placeholder="pendingQuestion ? t('subordinate.tasks.answerPlaceholder') : t('subordinate.tasks.followUpPlaceholder')"
        />
        <CaButton type="submit" variant="primary" :loading="busy === 'reply'" :disabled="!replyText.trim() || busy !== null">
          {{ pendingQuestion ? t('subordinate.tasks.answer') : t('subordinate.tasks.followUp') }}
        </CaButton>
      </form>
    </template>
    <template #footer>
      <CaButton
        v-if="task && !isFinal"
        variant="danger"
        :loading="busy === 'cancel'"
        :disabled="busy !== null"
        @click="act('cancel', () => cancelAgentTask(task!.id), t('workspace.subordinate.cancelled'))"
      >
        {{ t('workspace.subordinate.cancel') }}
      </CaButton>
      <CaButton
        v-if="task && (task.status === 'failed' || task.status === 'cancelled')"
        variant="secondary"
        :loading="busy === 'retry'"
        :disabled="busy !== null"
        @click="act('retry', () => retryAgentTask(task!.id), t('subordinate.tasks.retried'))"
      >
        {{ t('subordinate.tasks.retry') }}
      </CaButton>
      <CaButton variant="secondary" @click="open = false">{{ t('common.close') }}</CaButton>
    </template>
  </CaDialog>
</template>

<style scoped>
.tt__loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-8) 0;
}

.tt__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-3);
  align-items: center;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  margin-bottom: var(--ca-space-3);
}

.tt__instruction,
.tt__user {
  background: var(--ca-bg-canvas, rgba(0, 0, 0, 0.03));
  border-radius: var(--ca-radius-xl, 8px);
  padding: var(--ca-space-3);
}

.tt__instruction p,
.tt__user p {
  margin: 4px 0 0;
  white-space: pre-wrap;
}

.tt__label {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tt__timeline {
  list-style: none;
  margin: var(--ca-space-4) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.tt__bubble {
  display: flex;
  gap: var(--ca-space-3);
  align-items: flex-start;
}

.tt__bubble-body {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--ca-stroke-2, var(--ca-stroke-2));
  border-radius: var(--ca-radius-xl, 8px);
  padding: var(--ca-space-2) var(--ca-space-3);
}

.tt__bubble-head {
  display: flex;
  gap: var(--ca-space-2);
  align-items: center;
  margin-bottom: 4px;
}

.tt__line,
.tt__question {
  display: flex;
  gap: var(--ca-space-2);
  align-items: center;
  font-size: var(--ca-text-200);
}

.tt__question {
  padding: var(--ca-space-3);
  border-radius: var(--ca-radius-xl, 8px);
  background: var(--ca-warning-bg, rgba(224, 178, 82, 0.12));
  color: var(--ca-fg-1);
}

.tt__muted {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.tt__time {
  margin-left: auto;
}

.tt__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ca-fg-3);
  flex-shrink: 0;
}

.tt__tool-head {
  display: flex;
  gap: var(--ca-space-2);
  align-items: center;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--ca-fg-2);
  font-size: var(--ca-text-200);
  padding: 0;
  text-align: left;
}

.tt__code {
  margin: var(--ca-space-2) 0 0;
  padding: var(--ca-space-3);
  background: var(--ca-bg-canvas, rgba(0, 0, 0, 0.04));
  border-radius: var(--ca-radius-xl, 6px);
  font-family: var(--ca-font-family-mono, monospace);
  font-size: var(--ca-text-200);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow: auto;
}

.tt__approval {
  border: 1px solid var(--ca-warning-stroke);
  background: var(--ca-warning-bg, rgba(224, 178, 82, 0.1));
  border-radius: var(--ca-radius-xl, 10px);
  padding: var(--ca-space-3) var(--ca-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.tt__approval-actions {
  display: flex;
  gap: var(--ca-space-2);
}

.tt__divider {
  text-align: center;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  border-top: 1px dashed var(--ca-stroke-2);
  padding-top: var(--ca-space-2);
}

.tt__working {
  display: flex;
  gap: var(--ca-space-2);
  align-items: center;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.tt__children {
  margin-top: var(--ca-space-4);
}

.tt__children ul {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--ca-text-200);
}

.tt__result {
  margin-top: var(--ca-space-5, 20px);
  padding-top: var(--ca-space-4);
  border-top: 1px solid var(--ca-stroke-2, var(--ca-stroke-2));
}

.tt__result h3 {
  margin: 0 0 var(--ca-space-2);
  font-size: var(--ca-text-300);
}

.tt__reply {
  margin-top: var(--ca-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
  align-items: flex-end;
}

.tt__reply :deep(textarea) {
  width: 100%;
}
</style>
