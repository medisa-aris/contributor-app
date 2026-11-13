<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { NavMenuItemDto } from '@bara/shared';
import { listConversations, listTasks } from '@/api/ai';
import type { ConversationMode } from '@bara/shared';
import { listAgents, type PersonalAgent } from '@/api/subordinate';
import { useAuthStore } from '@/stores/auth.store';
import { useNavigationStore } from '@/stores/navigation.store';
import { formatDateTime } from '@/utils/format';
import { CaIcon, CaSpinner } from '@/components/ui';

const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const navigation = useNavigationStore();
const listId = useId();

const SEARCH_DEBOUNCE_MS = 250;
const MAX_PER_SECTION = 8;

type Kind = 'menu' | 'second_brain' | 'counterpart' | 'subordinate' | 'agent';

interface Entry {
  id: string;
  kind: Kind;
  label: string;
  context: string;
  to: string;
}

const query = ref('');
const activeIndex = ref(0);
const input = ref<HTMLInputElement | null>(null);

const canHistory = computed(() => auth.can('ai.workspace.history.read'));
const canSubordinate = computed(() => auth.can('ai.subordinate.execute'));
const canAgents = computed(() => auth.can('ai.agents.manage'));

// --- Menu (dari pohon navigasi, sudah dimuat; difilter langsung di memori) ---
const menuAll = computed<Entry[]>(() => {
  const out: Entry[] = [];
  const add = (item: NavMenuItemDto, context: string) => {
    if (item.routePath) out.push({ id: `menu-${item.id}`, kind: 'menu', label: item.label, context, to: item.routePath });
  };
  for (const app of navigation.applications) {
    for (const item of app.items) add(item, app.name);
    for (const mod of app.modules) for (const item of mod.items) add(item, `${app.name} · ${mod.name}`);
  }
  out.push({ id: 'menu-docs', kind: 'menu', label: t('docs.title'), context: t('shell.docs'), to: '/docs' });
  return out;
});

// --- Percakapan Multi Brain / Partner: dicari di server, didebounce ---
const conversationHits = ref<Entry[]>([]);
const searchingConversations = ref(false);

// --- Tugas Subordinate dan agen pribadi: diambil sekali per sesi buka, difilter di memori ---
const taskCache = ref<Awaited<ReturnType<typeof listTasks>>['items'] | null>(null);
const agentCache = ref<PersonalAgent[] | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let searchSeq = 0;

function conversationRoute(mode: ConversationMode, id: string): string {
  return mode === 'counterpart' ? `/workspace/counterpart?c=${id}` : `/workspace/second-brain?c=${id}`;
}

async function runSearch(q: string): Promise<void> {
  const seq = ++searchSeq;
  const jobs: Promise<unknown>[] = [];

  if (canHistory.value) {
    searchingConversations.value = true;
    jobs.push(
      Promise.all([
        listConversations({ mode: 'second_brain', search: q, page: 1, pageSize: MAX_PER_SECTION }),
        listConversations({ mode: 'counterpart', search: q, page: 1, pageSize: MAX_PER_SECTION }),
      ])
        .then(([sb, cp]) => {
          if (seq !== searchSeq) return;
          conversationHits.value = [...sb.items, ...cp.items].map((c) => ({
            id: `conv-${c.id}`,
            kind: c.mode === 'counterpart' ? 'counterpart' : 'second_brain',
            label: c.title,
            context: formatDateTime(c.updated_at),
            to: conversationRoute(c.mode, c.id),
          }));
        })
        .catch(() => {
          if (seq === searchSeq) conversationHits.value = [];
        })
        .finally(() => {
          if (seq === searchSeq) searchingConversations.value = false;
        }),
    );
  }

  if (canSubordinate.value && taskCache.value === null) {
    jobs.push(
      listTasks({ page: 1, pageSize: 100 })
        .then((res) => {
          taskCache.value = res.items;
        })
        .catch(() => {
          taskCache.value = [];
        }),
    );
  }

  if (canAgents.value && agentCache.value === null) {
    jobs.push(
      listAgents()
        .then((items) => {
          agentCache.value = items;
        })
        .catch(() => {
          agentCache.value = [];
        }),
    );
  }

  await Promise.all(jobs);
}

watch(query, (value) => {
  clearTimeout(debounceTimer);
  const q = value.trim();
  if (!q) {
    conversationHits.value = [];
    searchingConversations.value = false;
    return;
  }
  debounceTimer = setTimeout(() => void runSearch(q), SEARCH_DEBOUNCE_MS);
});

const menuResults = computed<Entry[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return menuAll.value;
  return menuAll.value.filter((e) => e.label.toLowerCase().includes(q) || e.context.toLowerCase().includes(q));
});

const taskResults = computed<Entry[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q || !taskCache.value) return [];
  return taskCache.value
    .filter((row) => row.title.toLowerCase().includes(q))
    .slice(0, MAX_PER_SECTION)
    .map((row) => ({
      id: `task-${row.id}`,
      kind: 'subordinate' as const,
      label: row.title,
      context: `${t(`workspace.subordinate.status.${row.status}`)} · ${formatDateTime(row.updated_at)}`,
      to: `/workspace/subordinate?task=${row.id}`,
    }));
});

const agentResults = computed<Entry[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q || !agentCache.value) return [];
  return agentCache.value
    .filter((agent) => agent.name.toLowerCase().includes(q) || (agent.description ?? '').toLowerCase().includes(q))
    .slice(0, MAX_PER_SECTION)
    .map((agent) => ({
      id: `agent-${agent.id}`,
      kind: 'agent' as const,
      label: agent.name,
      context: agent.description || t('shell.commandSections.agent'),
      to: `/workspace/subordinate?agent=${agent.id}`,
    }));
});

const sections = computed(() => {
  const list: { key: Kind; label: string; items: Entry[] }[] = [];
  if (menuResults.value.length > 0) list.push({ key: 'menu', label: t('shell.commandSections.menu'), items: menuResults.value });
  const secondBrain = conversationHits.value.filter((e) => e.kind === 'second_brain');
  const counterpart = conversationHits.value.filter((e) => e.kind === 'counterpart');
  if (secondBrain.length > 0) {
    list.push({ key: 'second_brain', label: t('shell.commandSections.second_brain'), items: secondBrain });
  }
  if (counterpart.length > 0) {
    list.push({ key: 'counterpart', label: t('shell.commandSections.counterpart'), items: counterpart });
  }
  if (taskResults.value.length > 0) {
    list.push({ key: 'subordinate', label: t('shell.commandSections.subordinate'), items: taskResults.value });
  }
  if (agentResults.value.length > 0) list.push({ key: 'agent', label: t('shell.commandSections.agent'), items: agentResults.value });
  return list;
});

const flatSections = computed(() => {
  let index = 0;
  return sections.value.map((section) => ({
    ...section,
    items: section.items.map((item) => ({ item, index: index++ })),
  }));
});

const results = computed<Entry[]>(() => sections.value.flatMap((s) => s.items));

const loading = computed(
  () =>
    searchingConversations.value ||
    (query.value.trim().length > 0 &&
      ((canSubordinate.value && taskCache.value === null) || (canAgents.value && agentCache.value === null))),
);

const KIND_ICON: Record<Kind, string | null> = {
  menu: null,
  second_brain: 'chat',
  counterpart: 'chat',
  subordinate: 'history',
  agent: 'bot',
};

watch(results, () => {
  activeIndex.value = 0;
});

watch(open, async (isOpen) => {
  if (!isOpen) {
    clearTimeout(debounceTimer);
    return;
  }
  query.value = '';
  activeIndex.value = 0;
  conversationHits.value = [];
  taskCache.value = null;
  agentCache.value = null;
  await nextTick();
  input.value?.focus();
});

function optionId(index: number): string {
  return `${listId}-${index}`;
}

async function go(entry: Entry | undefined): Promise<void> {
  if (!entry) return;
  open.value = false;
  await router.push(entry.to);
}

function onKeydown(event: KeyboardEvent): void {
  const count = results.value.length;
  if (event.key === 'ArrowDown' && count > 0) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % count;
  } else if (event.key === 'ArrowUp' && count > 0) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + count) % count;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    void go(results.value[activeIndex.value]);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    open.value = false;
  }
}

function onOverlayClick(): void {
  open.value = false;
}

watch(open, (isOpen) => {
  if (typeof document === 'undefined') return;
  document.documentElement.style.overflow = isOpen ? 'hidden' : '';
});

onBeforeUnmount(() => {
  clearTimeout(debounceTimer);
  if (typeof document !== 'undefined') document.documentElement.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <Transition name="spotlight">
      <div v-if="open" class="spotlight" @keydown="onKeydown">
        <div class="spotlight__overlay" @click="onOverlayClick" />
        <div class="spotlight__panel" role="dialog" :aria-label="t('shell.commandTitle')">
          <label class="spotlight__field">
            <CaIcon name="search" :size="20" class="spotlight__search-icon" />
            <span class="ca-visually-hidden">{{ t('shell.commandTitle') }}</span>
            <input
              ref="input"
              v-model="query"
              type="search"
              class="spotlight__input"
              role="combobox"
              aria-autocomplete="list"
              :aria-expanded="results.length > 0"
              :aria-controls="listId"
              :aria-activedescendant="results.length > 0 ? optionId(activeIndex) : undefined"
              :placeholder="t('shell.commandPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            />
            <CaSpinner v-if="loading" size="small" class="spotlight__spinner" />
          </label>

          <div v-if="results.length > 0" :id="listId" class="spotlight__results" role="listbox">
            <div v-for="section in flatSections" :key="section.key" class="spotlight__section">
              <p class="spotlight__section-label">{{ section.label }}</p>
              <div
                v-for="{ item, index } in section.items"
                :id="optionId(index)"
                :key="item.id"
                role="option"
                class="spotlight__option"
                :class="{ 'spotlight__option--active': index === activeIndex }"
                :aria-selected="index === activeIndex"
                @mouseenter="activeIndex = index"
                @click="go(item)"
              >
                <span class="spotlight__option-icon" :class="`spotlight__option-icon--${item.kind}`">
                  <CaIcon v-if="KIND_ICON[item.kind]" :name="KIND_ICON[item.kind]!" :size="16" />
                </span>
                <span class="spotlight__option-text">
                  <span class="spotlight__option-label">{{ item.label }}</span>
                  <span class="spotlight__option-context">{{ item.context }}</span>
                </span>
              </div>
            </div>
          </div>
          <p v-else-if="query.trim() && !loading" class="spotlight__empty">
            {{ t('shell.commandEmpty', { query: query.trim() }) }}
          </p>
          <p v-else-if="!query.trim()" class="spotlight__hint">{{ t('shell.commandHint') }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.spotlight {
  position: fixed;
  inset: 0;
  z-index: var(--ca-z-modal);
  display: flex;
  justify-content: center;
  padding: 12vh var(--ca-space-8) var(--ca-space-8);
}

.spotlight__overlay {
  position: absolute;
  inset: 0;
  background: var(--ca-bg-overlay);
}

.spotlight__panel {
  position: relative;
  width: 100%;
  max-width: 640px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--ca-bg-surface);
  border-radius: var(--ca-radius-xl);
  box-shadow: var(--ca-shadow-64);
  overflow: hidden;
}

.spotlight__field {
  display: flex;
  align-items: center;
  gap: var(--ca-space-6);
  flex: none;
  height: 56px;
  padding: 0 var(--ca-space-10);
  border-bottom: 1px solid var(--ca-stroke-2);
  color: var(--ca-fg-3);
}

.spotlight__search-icon {
  flex: none;
}

.spotlight__input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ca-fg-1);
  font-size: var(--ca-text-500);
  line-height: var(--ca-line-500);
  outline: none;
}

.spotlight__input::-webkit-search-cancel-button {
  display: none;
}

.spotlight__spinner {
  flex: none;
}

.spotlight__results {
  overflow-y: auto;
  padding: var(--ca-space-4);
}

.spotlight__section + .spotlight__section {
  margin-top: var(--ca-space-4);
}

.spotlight__section-label {
  padding: var(--ca-space-3) var(--ca-space-6) var(--ca-space-2);
  font-size: var(--ca-text-100);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ca-fg-3);
}

.spotlight__option {
  display: flex;
  align-items: center;
  gap: var(--ca-space-6);
  padding: var(--ca-space-4) var(--ca-space-6);
  border-radius: var(--ca-radius-lg);
  cursor: pointer;
}

.spotlight__option--active {
  background: var(--ca-color-brand-subtle);
}

.spotlight__option-icon {
  flex: none;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ca-radius-md);
  color: var(--ca-color-brand-text);
}

.spotlight__option-icon--second_brain,
.spotlight__option-icon--counterpart {
  background: var(--ca-info-bg);
  color: var(--ca-info-fg);
}

.spotlight__option-icon--subordinate {
  background: var(--ca-warning-bg);
  color: var(--ca-warning-fg);
}

.spotlight__option-icon--agent {
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand-text);
}

.spotlight__option-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.spotlight__option-label {
  font-weight: var(--ca-font-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spotlight__option-context {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spotlight__empty,
.spotlight__hint {
  padding: var(--ca-space-10);
  text-align: center;
  color: var(--ca-fg-3);
}

.spotlight-enter-active,
.spotlight-leave-active {
  transition: opacity var(--ca-duration-fast) var(--ca-curve-easy-ease);
}

.spotlight-enter-active .spotlight__panel,
.spotlight-leave-active .spotlight__panel {
  transition: transform var(--ca-duration-normal) var(--ca-curve-decelerate-mid);
}

.spotlight-enter-from,
.spotlight-leave-to {
  opacity: 0;
}

.spotlight-enter-from .spotlight__panel,
.spotlight-leave-to .spotlight__panel {
  transform: scale(0.97) translateY(-8px);
}
</style>
