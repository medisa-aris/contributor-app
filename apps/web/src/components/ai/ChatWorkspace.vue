<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { COUNTERPART_STYLES, type ConversationMode } from '@contributor/shared';
import {
  conversationDetail,
  deleteConversation,
  listConversations,
  regenerateReply,
  updateConversation,
} from '@/api/ai';
import { chatStream } from '@/api/ai/stream';
import type { ConversationMessage, ConversationSummary } from '@/api/ai';
import { ApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { CaButton, CaEmptyState, CaIcon, CaSpinner } from '@/components/ui';
import { formatDateTime } from '@/utils/format';
import ChatMessage from './ChatMessage.vue';

interface SpeechResultAlternative {
  transcript: string;
}

interface SpeechResult {
  0: SpeechResultAlternative;
  isFinal: boolean;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const props = defineProps<{
  mode: ConversationMode;
}>();

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canBrowseHistory = computed(() => auth.can('ai.workspace.history.read'));

const conversationId = ref<string | null>(null);
const messages = ref<ConversationMessage[]>([]);
const draft = ref('');
const styleId = ref(COUNTERPART_STYLES[0]!.id);
const streaming = ref(false);
const pendingText = ref('');
const streamError = ref('');
const sending = ref(false);
const regenerating = ref(false);
let activeAbort: AbortController | null = null;
let stopRequested = false;

const conversations = ref<ConversationSummary[]>([]);
const conversationsLoading = ref(false);
const conversationsError = ref('');
const searchQuery = ref('');
let searchTimer: number | undefined;

const renamingId = ref<string | null>(null);
const renameDraft = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

const listening = ref(false);
let recognizer: SpeechRecognitionLike | null = null;
const speechWindow = window as unknown as {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};
const speechCtor: SpeechRecognitionCtor | null =
  speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
const voiceSupported = computed(() => speechCtor !== null);

const scrollArea = ref<HTMLElement | null>(null);

const selectedStyle = computed(
  () => COUNTERPART_STYLES.find((style) => style.id === styleId.value) ?? COUNTERPART_STYLES[0]!,
);

const activeConversation = computed(
  () => conversations.value.find((item) => item.id === conversationId.value) ?? null,
);

const topbarTitle = computed(() => {
  if (activeConversation.value) return activeConversation.value.title;
  return conversationId.value
    ? t('workspace.chat.conversationFallbackTitle')
    : t('workspace.chat.newChatTitle');
});

const voiceLabel = computed(() =>
  listening.value ? t('workspace.chat.voiceStop') : t('workspace.chat.voiceStart'),
);

async function loadConversations(options?: { silent?: boolean }): Promise<void> {
  if (!canBrowseHistory.value) return;
  if (!options?.silent) {
    conversationsLoading.value = true;
    conversationsError.value = '';
  }
  try {
    const search = searchQuery.value.trim();
    const result = await listConversations({
      mode: props.mode,
      page: 1,
      pageSize: 50,
      ...(search ? { search } : {}),
    });
    conversations.value = result.items;
    conversationsError.value = '';
  } catch (caught) {
    conversationsError.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    if (!options?.silent) conversationsLoading.value = false;
  }
}

watch(searchQuery, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void loadConversations({ silent: true }), 300);
});

async function openConversation(id: string): Promise<void> {
  if (streaming.value || regenerating.value) return;
  try {
    const detail = await conversationDetail(id);
    conversationId.value = detail.id;
    messages.value = detail.messages;
    streamError.value = '';
    if (detail.counterpart_style) styleId.value = detail.counterpart_style;
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.loadFailed'),
      },
      5000,
    );
  }
}

async function removeConversation(id: string): Promise<void> {
  if (streaming.value || regenerating.value) return;
  try {
    await deleteConversation(id);
    conversations.value = conversations.value.filter((item) => item.id !== id);
    if (conversationId.value === id) startNew();
    toast.push({ variant: 'success', title: t('workspace.chat.conversationDeleted') });
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

async function toggleStar(item: ConversationSummary): Promise<void> {
  if (streaming.value || regenerating.value) return;
  try {
    await updateConversation(item.id, { starred: !item.starred_at });
    await loadConversations({ silent: true });
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

async function startRename(item: ConversationSummary): Promise<void> {
  if (streaming.value || regenerating.value) return;
  renamingId.value = item.id;
  renameDraft.value = item.title;
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}

function cancelRename(): void {
  renamingId.value = null;
}

async function commitRename(item: ConversationSummary): Promise<void> {
  if (renamingId.value !== item.id) return;
  const title = renameDraft.value.trim();
  renamingId.value = null;
  if (!title || title === item.title) return;
  try {
    const updated = await updateConversation(item.id, { title });
    item.title = updated.title;
    await loadConversations({ silent: true });
    toast.push({ variant: 'success', title: t('workspace.chat.renamed') }, 3000);
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

function startNew(): void {
  if (streaming.value || regenerating.value) return;
  conversationId.value = null;
  messages.value = [];
  streamError.value = '';
  pendingText.value = '';
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  const area = scrollArea.value;
  if (area) area.scrollTop = area.scrollHeight;
}

watch([messages, pendingText], () => void scrollToBottom(), { deep: true });

const canSend = computed(
  () => draft.value.trim().length > 0 && !streaming.value && !regenerating.value,
);

async function send(): Promise<void> {
  const prompt = draft.value.trim();
  if (!prompt || streaming.value || regenerating.value) return;

  sending.value = true;
  streamError.value = '';
  pendingText.value = '';
  messages.value = [
    ...messages.value,
    { id: '', role: 'user', content: prompt, model: null, created_at: '' },
  ];
  draft.value = '';

  let assistantText = '';
  const controller = new AbortController();
  activeAbort = controller;
  stopRequested = false;
  try {
    streaming.value = true;
    await chatStream(
      {
        mode: props.mode,
        prompt,
        conversationId: conversationId.value ?? undefined,
        counterpartStyle: props.mode === 'counterpart' ? styleId.value : undefined,
      },
      (event) => {
        if (event.type === 'ready') {
          conversationId.value = event.conversationId;
        } else if (event.type === 'delta') {
          pendingText.value += event.text;
          assistantText += event.text;
        } else if (event.type === 'done') {
          messages.value = [...messages.value, event.message];
          pendingText.value = '';
          void loadConversations({ silent: true });
        } else {
          streamError.value = event.info.message;
          pendingText.value = '';
        }
      },
      controller.signal,
    );
    if (assistantText.trim()) void loadConversations({ silent: true });
  } catch (caught) {
    if (!stopRequested) {
      streamError.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
    }
  } finally {
    pendingText.value = '';
    streaming.value = false;
    sending.value = false;
    if (activeAbort === controller) activeAbort = null;
    if (stopRequested) {
      stopRequested = false;
      toast.push({ variant: 'info', title: t('workspace.chat.stopped') }, 3000);
      void loadConversations({ silent: true });
    }
  }
}

function stopStreaming(): void {
  if (!activeAbort || stopRequested) return;
  stopRequested = true;
  activeAbort.abort();
}

async function regenerate(): Promise<void> {
  if (!conversationId.value || streaming.value || regenerating.value) return;
  regenerating.value = true;
  streamError.value = '';
  try {
    const result = await regenerateReply(conversationId.value);
    messages.value = result.conversation.messages;
    if (result.conversation.counterpart_style)
      styleId.value = result.conversation.counterpart_style;
    toast.push({ variant: 'success', title: t('workspace.chat.regenerated') }, 3000);
    void loadConversations({ silent: true });
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
      },
      5000,
    );
  } finally {
    regenerating.value = false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFileName(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || t('workspace.chat.exportFallbackName')
  );
}

function exportTitle(): string {
  return activeConversation.value?.title ?? t('workspace.chat.exportFallbackTitle');
}

function buildMarkdown(): string {
  const lines = [`# ${exportTitle()}`, ''];
  for (const message of messages.value) {
    lines.push(
      message.role === 'user'
        ? t('workspace.chat.exportUser')
        : t('workspace.chat.exportAssistant'),
    );
    lines.push('', message.content, '');
  }
  return lines.join('\n');
}

function exportMarkdown(): void {
  if (messages.value.length === 0) return;
  const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeFileName(exportTitle())}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast.push({ variant: 'success', title: t('workspace.chat.exportDone') }, 3000);
}

function printConversation(): void {
  if (messages.value.length === 0) return;
  const title = exportTitle();
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    toast.push({ variant: 'danger', title: t('workspace.chat.popupBlocked') }, 5000);
    return;
  }
  const turns = messages.value
    .map(
      (message) => `<section class="turn turn--${message.role}">
        <div class="role">${escapeHtml(
          message.role === 'user'
            ? t('workspace.chat.exportUser')
            : t('workspace.chat.exportAssistant'),
        )}</div>
        <pre>${escapeHtml(message.content)}</pre>
      </section>`,
    )
    .join('');
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body{font-family:'Segoe UI',Arial,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#1a1a1a}
      h1{font-size:20px;margin:0 0 4px}
      .meta{color:#666;font-size:12px;margin:0 0 24px}
      .turn{margin-bottom:18px;padding:12px 16px;border-radius:10px;background:#f3f3f3}
      .turn--user{background:#e8f1fb}
      .role{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:6px}
      pre{white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:14px;line-height:1.55;margin:0}
    </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">${escapeHtml(t('workspace.chat.exportMeta', { date: new Date().toLocaleString('id-ID') }))}</p>
    ${turns}
    </body></html>`);
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 300);
}

function toggleVoice(): void {
  if (!speechCtor || streaming.value || regenerating.value) return;
  if (listening.value) {
    recognizer?.stop();
    return;
  }
  const recognition = new speechCtor();
  recognition.lang = 'id-ID';
  recognition.interimResults = true;
  recognition.continuous = false;
  const base = draft.value.trim();
  recognition.onresult = (event) => {
    let transcript = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      transcript += event.results[index]?.[0]?.transcript ?? '';
    }
    const clean = transcript.trim();
    if (!clean) return;
    draft.value = base ? `${base} ${clean}` : clean;
  };
  recognition.onerror = (event) => {
    listening.value = false;
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    toast.push(
      {
        variant: 'danger',
        title:
          event.error === 'not-allowed'
            ? t('workspace.chat.voiceDenied')
            : t('workspace.chat.voiceError'),
      },
      5000,
    );
  };
  recognition.onend = () => {
    listening.value = false;
    recognizer = null;
  };
  recognizer = recognition;
  try {
    recognition.start();
    listening.value = true;
  } catch {
    listening.value = false;
    recognizer = null;
    toast.push({ variant: 'danger', title: t('workspace.chat.voiceError') }, 5000);
  }
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void send();
  }
}

onMounted(() => {
  void loadConversations();
});

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer);
  activeAbort?.abort();
  recognizer?.stop();
});
</script>

<template>
  <div class="chat" :class="{ 'chat--no-sidebar': !canBrowseHistory }">
    <aside v-if="canBrowseHistory" class="chat__sidebar">
      <div class="chat__sidebar-head">
        <h2 class="chat__sidebar-title">{{ t('workspace.chat.sidebarTitle') }}</h2>
        <CaButton size="small" variant="subtle" @click="startNew">
          {{ t('workspace.chat.newChat') }}
        </CaButton>
      </div>
      <div class="chat__search">
        <CaIcon name="search" :size="13" class="chat__search-icon" />
        <input
          v-model="searchQuery"
          type="search"
          class="chat__search-input"
          :placeholder="t('workspace.chat.searchPlaceholder')"
          :aria-label="t('workspace.chat.searchPlaceholder')"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="chat__search-clear"
          :aria-label="t('shell.searchClear')"
          @click="searchQuery = ''"
        >
          ×
        </button>
      </div>
      <CaSpinner v-if="conversationsLoading" class="chat__sidebar-loading" />
      <p v-else-if="conversationsError" class="chat__sidebar-error" role="alert">
        {{ conversationsError }}
      </p>
      <CaEmptyState
        v-else-if="conversations.length === 0"
        :title="searchQuery ? t('workspace.chat.searchEmpty') : t('workspace.chat.historyEmpty')"
      />
      <ul v-else class="chat__list">
        <li
          v-for="item in conversations"
          :key="item.id"
          class="chat__list-item"
          :class="{ 'chat__list-item--active': item.id === conversationId }"
        >
          <input
            v-if="renamingId === item.id"
            ref="renameInput"
            v-model="renameDraft"
            class="chat__rename-input"
            :aria-label="t('workspace.chat.rename')"
            maxlength="120"
            @keydown.enter.prevent="commitRename(item)"
            @keydown.esc.prevent="cancelRename"
            @blur="commitRename(item)"
          />
          <button v-else type="button" class="chat__list-button" @click="openConversation(item.id)">
            <span class="chat__list-title-row">
              <CaIcon v-if="item.starred_at" name="star" :size="11" class="chat__list-star" />
              <span class="chat__list-title">{{ item.title }}</span>
            </span>
            <span class="chat__list-time">{{ formatDateTime(item.updated_at) }}</span>
          </button>
          <div v-if="renamingId !== item.id" class="chat__list-actions">
            <button
              type="button"
              class="chat__list-action"
              :class="{ 'chat__list-action--starred': item.starred_at }"
              :aria-label="item.starred_at ? t('workspace.chat.unstar') : t('workspace.chat.star')"
              :aria-pressed="Boolean(item.starred_at)"
              :title="item.starred_at ? t('workspace.chat.unstar') : t('workspace.chat.star')"
              @click="toggleStar(item)"
            >
              <CaIcon name="star" :size="13" />
            </button>
            <button
              type="button"
              class="chat__list-action"
              :aria-label="t('workspace.chat.rename')"
              :title="t('workspace.chat.rename')"
              @click="startRename(item)"
            >
              <CaIcon name="pencil" :size="13" />
            </button>
            <button
              type="button"
              class="chat__list-action chat__list-action--danger"
              :aria-label="t('common.delete')"
              :title="t('common.delete')"
              @click="removeConversation(item.id)"
            >
              <CaIcon name="trash" :size="13" />
            </button>
          </div>
        </li>
      </ul>
    </aside>

    <section class="chat__main">
      <div class="chat__topbar">
        <div class="chat__topbar-title">
          <h2>{{ topbarTitle }}</h2>
          <button
            v-if="activeConversation"
            type="button"
            class="chat__toolbar-icon"
            :class="{ 'chat__toolbar-icon--starred': activeConversation.starred_at }"
            :aria-label="
              activeConversation.starred_at ? t('workspace.chat.unstar') : t('workspace.chat.star')
            "
            :aria-pressed="Boolean(activeConversation.starred_at)"
            :title="
              activeConversation.starred_at ? t('workspace.chat.unstar') : t('workspace.chat.star')
            "
            @click="toggleStar(activeConversation)"
          >
            <CaIcon name="star" :size="15" />
          </button>
        </div>
        <div class="chat__topbar-actions">
          <button
            v-if="messages.length > 0"
            type="button"
            class="chat__toolbar-button"
            :title="t('workspace.chat.exportMarkdown')"
            @click="exportMarkdown"
          >
            <CaIcon name="download" :size="14" />
            <span>{{ t('workspace.chat.exportMarkdown') }}</span>
          </button>
          <button
            v-if="messages.length > 0"
            type="button"
            class="chat__toolbar-button"
            :title="t('workspace.chat.print')"
            @click="printConversation"
          >
            <CaIcon name="printer" :size="14" />
            <span>{{ t('workspace.chat.print') }}</span>
          </button>
        </div>
      </div>

      <div v-if="mode === 'counterpart'" class="chat__styles">
        <div
          class="chat__style-options"
          role="radiogroup"
          :aria-label="t('workspace.chat.styleLabel')"
        >
          <button
            v-for="style in COUNTERPART_STYLES"
            :key="style.id"
            type="button"
            class="chat__style-chip"
            :class="{ 'chat__style-chip--active': style.id === styleId }"
            :aria-pressed="style.id === styleId"
            @click="styleId = style.id"
          >
            {{ style.name }}
          </button>
        </div>
        <p class="chat__style-desc">{{ selectedStyle.description }}</p>
      </div>

      <div ref="scrollArea" class="chat__messages">
        <CaEmptyState
          v-if="messages.length === 0 && !streaming && !regenerating"
          class="chat__empty"
          :title="t('workspace.chat.emptyTitle')"
          :description="t('workspace.chat.emptyDescription')"
        />
        <template v-else>
          <ChatMessage
            v-for="(message, index) in messages"
            :key="message.id || `pending-${index}`"
            :role="message.role === 'user' ? 'user' : 'assistant'"
            :content="message.content"
            :model="message.model"
            :created-at="message.created_at"
            :can-regenerate="
              message.role === 'assistant' &&
              index === messages.length - 1 &&
              !streaming &&
              !regenerating
            "
            @regenerate="regenerate"
          />
          <ChatMessage
            v-if="streaming || regenerating"
            role="assistant"
            :content="streaming ? pendingText : ''"
            pending
          />
        </template>
      </div>

      <p v-if="streamError" class="chat__error" role="alert">{{ streamError }}</p>

      <form class="chat__composer" @submit.prevent="send">
        <textarea
          v-model="draft"
          class="chat__input"
          rows="3"
          :placeholder="t('workspace.chat.placeholder')"
          :disabled="streaming || regenerating"
          @keydown="onComposerKeydown"
        />
        <div class="chat__composer-bar">
          <div class="chat__composer-tools">
            <button
              type="button"
              class="chat__voice"
              :class="{ 'chat__voice--active': listening }"
              :disabled="!voiceSupported || streaming || regenerating"
              :aria-label="voiceLabel"
              :aria-pressed="listening"
              :title="voiceSupported ? voiceLabel : t('workspace.chat.voiceUnsupported')"
              @click="toggleVoice"
            >
              <CaIcon name="mic" :size="13" />
              <span>{{
                listening ? t('workspace.chat.voiceListening') : t('workspace.chat.voiceStart')
              }}</span>
            </button>
            <span class="chat__hint">
              {{ listening ? t('workspace.chat.voiceHint') : t('workspace.chat.composerHint') }}
            </span>
          </div>
          <div class="chat__composer-actions">
            <CaButton v-if="streaming" variant="secondary" type="button" @click="stopStreaming">
              {{ t('workspace.chat.stop') }}
            </CaButton>
            <CaButton
              v-else
              variant="primary"
              type="submit"
              :disabled="!canSend"
              :loading="sending || regenerating"
            >
              {{ t('workspace.chat.send') }}
            </CaButton>
          </div>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.chat {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: var(--ca-space-6);
  min-height: 0;
  height: calc(100vh - 220px);
}

.chat--no-sidebar {
  grid-template-columns: minmax(0, 1fr);
}

.chat__sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface);
  overflow: hidden;
}

.chat__sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-2);
  padding: var(--ca-space-4) var(--ca-space-4) var(--ca-space-2);
}

.chat__sidebar-title {
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.chat__search {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  margin: 0 var(--ca-space-3) var(--ca-space-2);
  padding: 0 var(--ca-space-3);
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-circular);
  background: var(--ca-bg-surface-2);
}

.chat__search:focus-within {
  border-color: var(--ca-color-brand);
  outline: 1px solid var(--ca-color-brand);
}

.chat__search-icon {
  flex-shrink: 0;
  color: var(--ca-fg-3);
}

.chat__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  padding: var(--ca-space-2) 0;
  color: var(--ca-fg-1);
  font: inherit;
  font-size: var(--ca-text-200);
  outline: none;
}

.chat__search-input::-webkit-search-cancel-button {
  display: none;
}

.chat__search-clear {
  flex-shrink: 0;
  border: none;
  background: none;
  color: var(--ca-fg-3);
  font-size: 16px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: var(--ca-radius-sm);
}

.chat__search-clear:hover {
  color: var(--ca-fg-1);
  background: var(--ca-bg-surface-3);
}

.chat__sidebar-loading {
  margin: var(--ca-space-6) auto;
}

.chat__sidebar-error {
  margin: 0;
  padding: var(--ca-space-4);
  color: var(--ca-danger-fg);
  font-size: var(--ca-text-200);
}

.chat__list {
  list-style: none;
  margin: 0;
  padding: 0 var(--ca-space-2) var(--ca-space-2);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat__list-item {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--ca-radius-md);
}

.chat__list-item:hover {
  background: var(--ca-bg-surface-3);
}

.chat__list-item--active {
  background: var(--ca-bg-surface-3);
  outline: 1px solid var(--ca-stroke-1);
}

.chat__list-button {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: none;
  background: none;
  padding: var(--ca-space-3) var(--ca-space-3) var(--ca-space-3) var(--ca-space-4);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.chat__list-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
}

.chat__list-star {
  flex-shrink: 0;
  color: var(--ca-warning-fg);
}

.chat__list-title {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
}

.chat__list-time {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.chat__list-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-right: var(--ca-space-1);
}

.chat__list-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--ca-radius-sm);
  background: none;
  color: var(--ca-fg-3);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.chat__list-action:hover {
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
}

.chat__list-action--danger:hover {
  color: var(--ca-danger-fg);
}

.chat__list-item:hover .chat__list-action,
.chat__list-item:focus-within .chat__list-action {
  opacity: 1;
}

.chat__list-action--starred {
  color: var(--ca-warning-fg);
  opacity: 1;
}

@media (hover: none) {
  .chat__list-action {
    opacity: 1;
  }
}

.chat__rename-input {
  flex: 1;
  min-width: 0;
  margin: var(--ca-space-2);
  border: 1px solid var(--ca-color-brand);
  border-radius: var(--ca-radius-sm);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  padding: var(--ca-space-1) var(--ca-space-2);
  font: inherit;
  font-size: var(--ca-text-200);
  outline: none;
}

.chat__main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface);
  overflow: hidden;
}

.chat__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-3);
  padding: var(--ca-space-2) var(--ca-space-4) var(--ca-space-2) var(--ca-space-6);
  border-bottom: 1px solid var(--ca-stroke-2);
}

.chat__topbar-title {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  min-width: 0;
}

.chat__topbar-title h2 {
  margin: 0;
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat__toolbar-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--ca-radius-sm);
  background: none;
  color: var(--ca-fg-3);
  cursor: pointer;
}

.chat__toolbar-icon:hover {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-1);
}

.chat__toolbar-icon--starred {
  color: var(--ca-warning-fg);
}

.chat__topbar-actions {
  display: flex;
  align-items: center;
  gap: var(--ca-space-1);
}

.chat__toolbar-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: var(--ca-radius-sm);
  background: none;
  color: var(--ca-fg-2);
  padding: 4px 8px;
  font: inherit;
  font-size: var(--ca-text-200);
  cursor: pointer;
}

.chat__toolbar-button:hover {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-1);
}

.chat__styles {
  padding: var(--ca-space-4) var(--ca-space-6);
  border-bottom: 1px solid var(--ca-stroke-2);
}

.chat__style-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
}

.chat__style-chip {
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-circular);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-2);
  padding: var(--ca-space-2) var(--ca-space-5);
  font-size: var(--ca-text-200);
  font-weight: var(--ca-font-weight-semibold);
  cursor: pointer;
  transition:
    color var(--ca-duration-faster) var(--ca-curve-easy-ease),
    border-color var(--ca-duration-faster) var(--ca-curve-easy-ease),
    background var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.chat__style-chip:hover {
  color: var(--ca-fg-1);
  border-color: var(--ca-stroke-2);
}

.chat__style-chip--active {
  background: var(--ca-color-brand-subtle);
  border-color: var(--ca-color-brand);
  color: var(--ca-color-brand);
}

.chat__style-desc {
  margin: var(--ca-space-2) 0 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.chat__messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--ca-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-5);
  background: var(--ca-bg-surface-2);
}

.chat__empty {
  margin: auto;
}

.chat__error {
  margin: 0;
  padding: var(--ca-space-3) var(--ca-space-6);
  color: var(--ca-danger-fg);
  font-size: var(--ca-text-200);
  border-top: 1px solid var(--ca-stroke-2);
}

.chat__composer {
  border-top: 1px solid var(--ca-stroke-2);
  padding: var(--ca-space-4) var(--ca-space-6) var(--ca-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  background: var(--ca-bg-surface);
}

.chat__input {
  width: 100%;
  resize: vertical;
  min-height: 64px;
  max-height: 200px;
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  padding: var(--ca-space-3) var(--ca-space-4);
  font-family: var(--ca-font-family);
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  outline: none;
  transition: border-color var(--ca-duration-fast) var(--ca-curve-easy-ease);
}

.chat__input:focus-visible {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}

.chat__input:disabled {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-3);
}

.chat__composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
}

.chat__composer-tools {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  min-width: 0;
}

.chat__composer-actions {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  flex-shrink: 0;
}

.chat__voice {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-circular);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-2);
  padding: 4px 10px;
  font: inherit;
  font-size: var(--ca-text-100);
  cursor: pointer;
  flex-shrink: 0;
}

.chat__voice:hover:not(:disabled) {
  border-color: var(--ca-stroke-2);
  color: var(--ca-fg-1);
}

.chat__voice:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.chat__voice--active {
  border-color: var(--ca-danger-stroke);
  background: var(--ca-danger-bg);
  color: var(--ca-danger-fg);
  animation: voice-pulse 1.4s infinite;
}

@keyframes voice-pulse {
  50% {
    opacity: 0.7;
  }
}

.chat__hint {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .chat {
    grid-template-columns: 1fr;
    height: auto;
  }

  .chat__sidebar {
    max-height: 260px;
  }

  .chat__composer-bar {
    flex-wrap: wrap;
  }

  .chat__hint {
    display: none;
  }

  .chat__topbar {
    padding-left: var(--ca-space-4);
  }

  .chat__toolbar-button span {
    display: none;
  }
}
</style>
