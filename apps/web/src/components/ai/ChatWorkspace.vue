<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { COUNTERPART_STYLES, type ConversationMode } from '@contributor/shared';
import { conversationDetail, deleteConversation, listConversations } from '@/api/ai';
import { chatStream } from '@/api/ai/stream';
import type { ConversationMessage, ConversationSummary } from '@/api/ai';
import { ApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { CaBadge, CaButton, CaEmptyState, CaIcon, CaSpinner } from '@/components/ui';
import { formatDateTime } from '@/utils/format';

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

const conversations = ref<ConversationSummary[]>([]);
const conversationsLoading = ref(false);

const scrollArea = ref<HTMLElement | null>(null);

const selectedStyle = computed(
  () => COUNTERPART_STYLES.find((style) => style.id === styleId.value) ?? COUNTERPART_STYLES[0]!,
);

async function loadConversations(): Promise<void> {
  if (!canBrowseHistory.value) return;
  conversationsLoading.value = true;
  try {
    const result = await listConversations({ mode: props.mode, page: 1, pageSize: 50 });
    conversations.value = result.items;
  } catch {
    // daftar percakapan bersifat pembantu; gagal muat tidak menghalangi chat
  } finally {
    conversationsLoading.value = false;
  }
}

async function openConversation(id: string): Promise<void> {
  if (streaming.value) return;
  try {
    const detail = await conversationDetail(id);
    conversationId.value = detail.id;
    messages.value = detail.messages;
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

function startNew(): void {
  if (streaming.value) return;
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

const canSend = computed(() => draft.value.trim().length > 0 && !streaming.value);

async function send(): Promise<void> {
  const prompt = draft.value.trim();
  if (!prompt || streaming.value) return;

  sending.value = true;
  streamError.value = '';
  pendingText.value = '';
  messages.value = [...messages.value, { id: '', role: 'user', content: prompt, model: null, created_at: '' }];
  draft.value = '';

  let assistantText = '';
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
          void loadConversations();
        } else {
          streamError.value = event.info.message;
          pendingText.value = '';
        }
      },
    );
    if (assistantText.trim()) void loadConversations();
  } catch (caught) {
    streamError.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
    pendingText.value = '';
  } finally {
    streaming.value = false;
    sending.value = false;
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
      <CaSpinner v-if="conversationsLoading" class="chat__sidebar-loading" />
      <CaEmptyState
        v-else-if="conversations.length === 0"
        :title="t('workspace.chat.historyEmpty')"
      />
      <ul v-else class="chat__list">
        <li
          v-for="item in conversations"
          :key="item.id"
          class="chat__list-item"
          :class="{ 'chat__list-item--active': item.id === conversationId }"
        >
          <button type="button" class="chat__list-button" @click="openConversation(item.id)">
            <span class="chat__list-title">{{ item.title }}</span>
            <span class="chat__list-time">{{ formatDateTime(item.updated_at) }}</span>
          </button>
          <CaButton
            size="small"
            variant="transparent"
            class="chat__list-delete"
            :aria-label="t('common.delete')"
            @click="removeConversation(item.id)"
          >
            <CaIcon name="trash" :size="14" />
          </CaButton>
        </li>
      </ul>
    </aside>

    <section class="chat__main">
      <div v-if="mode === 'counterpart'" class="chat__styles">
        <div class="chat__style-options" role="radiogroup" :aria-label="t('workspace.chat.styleLabel')">
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
          v-if="messages.length === 0 && !pendingText"
          class="chat__empty"
          :title="t('workspace.chat.emptyTitle')"
          :description="t('workspace.chat.emptyDescription')"
        />
        <template v-else>
          <article
            v-for="(message, index) in messages"
            :key="message.id || `pending-${index}`"
            class="msg"
            :class="`msg--${message.role}`"
          >
            <p class="msg__content">{{ message.content }}</p>
            <footer v-if="message.role === 'assistant'" class="msg__meta">
              <span v-if="message.model" class="msg__model">{{ message.model }}</span>
              <span v-if="message.created_at">{{ formatDateTime(message.created_at) }}</span>
            </footer>
          </article>
          <article v-if="pendingText" class="msg msg--assistant">
            <p class="msg__content">{{ pendingText }}</p>
            <footer class="msg__meta">
              <CaBadge size="small" variant="informative">{{ t('workspace.chat.streaming') }}</CaBadge>
            </footer>
          </article>
          <article v-if="streaming && !pendingText" class="msg msg--assistant">
            <p class="msg__content msg__content--thinking">
              {{ t('workspace.chat.thinking') }}
            </p>
          </article>
        </template>
      </div>

      <p v-if="streamError" class="chat__error" role="alert">{{ streamError }}</p>

      <form class="chat__composer" @submit.prevent="send">
        <textarea
          v-model="draft"
          class="chat__input"
          rows="3"
          :placeholder="t('workspace.chat.placeholder')"
          :disabled="streaming"
          @keydown="onComposerKeydown"
        />
        <div class="chat__composer-bar">
          <span class="chat__hint">{{ t('workspace.chat.composerHint') }}</span>
          <CaButton variant="primary" type="submit" :disabled="!canSend" :loading="sending && !streaming">
            {{ t('workspace.chat.send') }}
          </CaButton>
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

.chat__sidebar-loading {
  margin: var(--ca-space-6) auto;
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
  padding: var(--ca-space-3) var(--ca-space-4);
  cursor: pointer;
  font: inherit;
  text-align: left;
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

.chat__list-delete {
  flex-shrink: 0;
  margin-right: var(--ca-space-2);
  opacity: 0;
}

.chat__list-item:hover .chat__list-delete,
.chat__list-item:focus-within .chat__list-delete {
  opacity: 1;
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

.msg {
  max-width: 78%;
  border-radius: var(--ca-radius-lg);
  padding: var(--ca-space-4) var(--ca-space-5);
}

.msg--user {
  align-self: flex-end;
  background: var(--ca-color-brand-subtle);
  color: var(--ca-fg-1);
  border-bottom-right-radius: var(--ca-radius-sm);
}

.msg--assistant {
  align-self: flex-start;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-bottom-left-radius: var(--ca-radius-sm);
}

.msg__content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  color: var(--ca-fg-1);
}

.msg__content--thinking {
  color: var(--ca-fg-3);
  font-style: italic;
}

.msg__meta {
  margin-top: var(--ca-space-2);
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.msg__model {
  font-family: var(--ca-font-family-mono);
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

.chat__hint {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

@media (max-width: 900px) {
  .chat {
    grid-template-columns: 1fr;
    height: auto;
  }

  .chat__sidebar {
    max-height: 260px;
  }

  .msg {
    max-width: 100%;
  }
}
</style>
