<script setup lang="ts">
import { GUARDRAIL_CATEGORIES } from '@bara/shared';
import type { ToolTraceStep } from '@/api/ai';
import ToolTraceList from './ToolTraceList.vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CaIcon } from '@/components/ui';
import { writeClipboard } from '@/utils/clipboard';
import { formatDateTime, formatNumber } from '@/utils/format';
import type { UserDocument } from '@/api/documents';
import DocumentCard from './DocumentCard.vue';
import MarkdownContent from './MarkdownContent.vue';

const props = withDefaults(
  defineProps<{
    role: 'user' | 'assistant';
    content: string;
    model?: string | null;
    createdAt?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    showTokens?: boolean;
    pending?: boolean;
    canRegenerate?: boolean;
    documents?: UserDocument[];
    activeDocumentId?: string | null;
    toolSteps?: ToolTraceStep[];
    busyApprovalId?: string | null;
    guardrails?: Record<string, number> | null;
  }>(),
  {
    model: null,
    createdAt: null,
    tokensIn: null,
    tokensOut: null,
    showTokens: false,
    pending: false,
    canRegenerate: false,
    documents: () => [],
    activeDocumentId: null,
    toolSteps: () => [],
    busyApprovalId: null,
    guardrails: null,
  },
);

const emit = defineEmits<{
  regenerate: [];
  openDocument: [doc: UserDocument];
  decide: [payload: { approvalId: string; decision: 'approved' | 'rejected' }];
}>();

const { t } = useI18n();

const copied = ref(false);
const formattedTime = computed(() => (props.createdAt ? formatDateTime(props.createdAt) : ''));
const showTokenMeta = computed(
  () =>
    props.showTokens &&
    props.role === 'assistant' &&
    (props.tokensIn !== null || props.tokensOut !== null),
);

const webInfo = computed(() => {
  if (props.role !== 'assistant' || props.pending) return '';
  const steps = props.toolSteps.filter((s) => s.name === 'web_search' || s.name === 'web_read');
  if (steps.length === 0) return '';
  const done = steps.filter((s) => s.status === 'ok');
  if (done.length === 0) return t('workspace.chat.webFailed');
  const searches = done.filter((s) => s.name === 'web_search').length;
  const pages = done.length - searches;
  const sources = [...new Set(done.map((s) => s.source).filter(Boolean))];
  return [
    t('workspace.chat.webUsed'),
    ...(searches > 0 ? [t('workspace.chat.webSearches', { n: searches })] : []),
    ...(pages > 0 ? [t('workspace.chat.webPages', { n: pages })] : []),
    ...(sources.length > 0 ? [sources.join(', ')] : []),
  ].join(' · ');
});

const guardInfo = computed(() => {
  if (props.role !== 'assistant' || props.pending || !props.guardrails) return '';
  const entries = Object.entries(props.guardrails).filter(([, count]) => count > 0);
  if (entries.length === 0) return '';
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const labels = entries.map(
    ([id]) =>
      GUARDRAIL_CATEGORIES.find((category) => category.id === id)?.label ??
      t('workspace.chat.guardCustom'),
  );
  return [
    t('workspace.chat.guardMasked'),
    t('workspace.chat.guardCount', { n: formatNumber(total) }),
    labels.join(', '),
  ].join(' · ');
});

let copiedTimer: number | undefined;

async function copyMessage(): Promise<void> {
  if (!(await writeClipboard(props.content))) return;
  copied.value = true;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1600);
}

onBeforeUnmount(() => {
  window.clearTimeout(copiedTimer);
});
</script>

<template>
  <article class="msg" :class="[`msg--${role}`, { 'msg--pending': pending }]">
    <div class="msg__body">
      <ToolTraceList
        v-if="role === 'assistant' && toolSteps.length > 0"
        :steps="toolSteps"
        :busy-approval-id="busyApprovalId"
        :readonly="pending"
        @decide="emit('decide', $event)"
      />
      <p v-if="role === 'user'" class="msg__plain">{{ content }}</p>
      <div
        v-else-if="pending && !content"
        class="msg__typing"
        role="status"
        :aria-label="t('workspace.chat.thinking')"
      >
        <span />
        <span />
        <span />
      </div>
      <MarkdownContent v-else :content="content" :pending="pending" />
      <div v-if="documents.length > 0" class="msg__docs">
        <DocumentCard
          v-for="doc in documents"
          :key="doc.id"
          :doc="doc"
          :active="doc.id === activeDocumentId"
          @open="emit('openDocument', doc)"
        />
      </div>
    </div>
    <p v-if="webInfo" class="msg__web">
      <CaIcon name="search" :size="12" />
      <span>{{ webInfo }}</span>
    </p>
    <p v-if="guardInfo" class="msg__web">
      <CaIcon name="shield" :size="12" />
      <span>{{ guardInfo }}</span>
    </p>
    <footer class="msg__footer">
      <div v-if="role === 'assistant'" class="msg__meta">
        <span v-if="model" class="msg__model">{{ model }}</span>
        <span v-if="showTokenMeta" class="msg__tokens">
          {{
            t('workspace.chat.tokenResponse', {
              input: formatNumber(tokensIn),
              output: formatNumber(tokensOut),
            })
          }}
        </span>
        <span v-if="formattedTime">{{ formattedTime }}</span>
      </div>
      <div v-if="!pending" class="msg__actions">
        <button type="button" class="msg__action" @click="copyMessage">
          <CaIcon name="copy" :size="13" />
          <span>{{ copied ? t('workspace.chat.copied') : t('workspace.chat.copy') }}</span>
        </button>
        <button
          v-if="role === 'assistant' && canRegenerate"
          type="button"
          class="msg__action"
          @click="emit('regenerate')"
        >
          <CaIcon name="refresh" :size="13" />
          <span>{{ t('workspace.chat.regenerate') }}</span>
        </button>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.msg {
  max-width: 78%;
  align-self: flex-start;
  border-radius: var(--ca-radius-lg);
  padding: var(--ca-space-4) var(--ca-space-5);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-bottom-left-radius: var(--ca-radius-sm);
}

.msg--user {
  align-self: flex-end;
  background: var(--ca-color-brand-subtle);
  border-color: transparent;
  border-bottom-left-radius: var(--ca-radius-lg);
  border-bottom-right-radius: var(--ca-radius-sm);
}

.msg__plain {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  color: var(--ca-fg-1);
}

.msg__docs {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
  margin-top: var(--ca-space-3);
}

.msg__web {
  display: flex;
  align-items: center;
  gap: var(--ca-space-1);
  margin: var(--ca-space-3) 0 0;
  font-size: var(--ca-text-100);
  color: var(--ca-fg-2);
}

.msg__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-3);
  margin-top: var(--ca-space-2);
}

.msg--user .msg__footer {
  justify-content: flex-end;
}

.msg__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ca-space-3);
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.msg__model {
  font-family: var(--ca-font-family-mono);
}

.msg__actions {
  display: flex;
  align-items: center;
  gap: var(--ca-space-1);
  opacity: 0;
  transition: opacity var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.msg:hover .msg__actions,
.msg:focus-within .msg__actions {
  opacity: 1;
}

@media (hover: none) {
  .msg__actions {
    opacity: 1;
  }
}

.msg__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: var(--ca-radius-sm);
  background: none;
  color: var(--ca-fg-3);
  padding: 2px 6px;
  font: inherit;
  font-size: var(--ca-text-100);
  cursor: pointer;
}

.msg__action:hover {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-1);
}

.msg__action:focus-visible {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}

.msg__typing {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 20px;
  padding: 2px 0;
}

.msg__typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ca-fg-3);
  animation: typing-bounce 1.1s infinite ease-in-out;
}

.msg__typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.msg__typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes typing-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }

  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>
