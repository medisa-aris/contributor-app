<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { NavMenuItemDto } from '@bara/shared';
import { useNavigationStore } from '@/stores/navigation.store';
import { CaDialog, CaIcon } from '@/components/ui';

const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const router = useRouter();
const navigation = useNavigationStore();
const listId = useId();

const query = ref('');
const activeIndex = ref(0);
const input = ref<HTMLInputElement | null>(null);

interface Entry {
  id: string;
  label: string;
  context: string;
  routePath: string;
}

const entries = computed<Entry[]>(() => {
  const out: Entry[] = [];
  const add = (item: NavMenuItemDto, context: string) => {
    if (item.routePath) out.push({ id: item.id, label: item.label, context, routePath: item.routePath });
  };
  for (const app of navigation.applications) {
    for (const item of app.items) add(item, app.name);
    for (const mod of app.modules) for (const item of mod.items) add(item, `${app.name} · ${mod.name}`);
  }
  return out;
});

const results = computed<Entry[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return entries.value;
  return entries.value.filter(
    (e) => e.label.toLowerCase().includes(q) || e.context.toLowerCase().includes(q),
  );
});

watch(results, () => {
  activeIndex.value = 0;
});

watch(open, async (isOpen) => {
  if (!isOpen) return;
  query.value = '';
  activeIndex.value = 0;
  await nextTick();
  input.value?.focus();
});

function optionId(index: number): string {
  return `${listId}-${index}`;
}

async function go(entry: Entry | undefined): Promise<void> {
  if (!entry) return;
  open.value = false;
  await router.push(entry.routePath);
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
  }
}
</script>

<template>
  <CaDialog v-model:open="open" :title="t('shell.commandTitle')" size="small">
    <div class="palette">
      <label class="palette__field">
        <CaIcon name="search" :size="16" />
        <span class="ca-visually-hidden">{{ t('shell.commandTitle') }}</span>
        <input
          ref="input"
          v-model="query"
          type="search"
          class="palette__input"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="results.length > 0"
          :aria-controls="listId"
          :aria-activedescendant="results.length > 0 ? optionId(activeIndex) : undefined"
          :placeholder="t('shell.searchMenu')"
          autocomplete="off"
          @keydown="onKeydown"
        />
      </label>
      <p class="palette__hint">{{ t('shell.commandHint') }}</p>
      <ul v-if="results.length > 0" :id="listId" class="palette__list" role="listbox">
        <li
          v-for="(entry, index) in results"
          :id="optionId(index)"
          :key="entry.id"
          role="option"
          class="palette__option"
          :class="{ 'palette__option--active': index === activeIndex }"
          :aria-selected="index === activeIndex"
          @mouseenter="activeIndex = index"
          @click="go(entry)"
        >
          <span class="palette__label">{{ entry.label }}</span>
          <span class="palette__context">{{ entry.context }}</span>
        </li>
      </ul>
      <p v-else class="palette__empty">{{ t('shell.searchEmpty') }}</p>
    </div>
  </CaDialog>
</template>

<style scoped>
.palette {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
}

.palette__field {
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
  height: 36px;
  padding: 0 var(--ca-space-6);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface-2);
  border-bottom: 2px solid var(--ca-color-brand);
  color: var(--ca-fg-3);
}

.palette__input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ca-fg-1);
  outline: none;
}

.palette__input::-webkit-search-cancel-button {
  display: none;
}

.palette__hint {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.palette__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
}

.palette__option {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
  padding: var(--ca-space-4) var(--ca-space-6);
  border-radius: var(--ca-radius-lg);
  cursor: pointer;
}

.palette__option--active {
  background: var(--ca-color-brand-subtle);
}

.palette__label {
  font-weight: var(--ca-font-weight-semibold);
}

.palette__context {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.palette__empty {
  padding: var(--ca-space-8) 0;
  text-align: center;
  color: var(--ca-fg-3);
}
</style>
