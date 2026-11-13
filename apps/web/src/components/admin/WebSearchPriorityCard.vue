<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import { getWebSearchProviders, setWebSearchPriority, type WebSearchProvider } from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { CaBadge, CaCard, CaIcon, CaSpinner } from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const providers = ref<WebSearchProvider[]>([]);
const saved = ref<WebSearchProvider[]>([]);
const loading = ref(true);
const failed = ref(false);
const saving = ref(false);
const dragIndex = ref<number | null>(null);
const canManage = computed(() => auth.can('config.manage'));
const canReorder = computed(() => canManage.value && !saving.value);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    providers.value = await getWebSearchProviders();
    saved.value = [...providers.value];
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

function move(from: number, to: number): void {
  const next = [...providers.value];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  providers.value = next;
}

async function commit(): Promise<void> {
  const order = providers.value.map((p) => p.id);
  if (order.join() === saved.value.map((p) => p.id).join()) return;
  saving.value = true;
  try {
    providers.value = await setWebSearchPriority(order);
    saved.value = [...providers.value];
    toast.push({ variant: 'success', title: t('admin.providers.webSearch.saved') });
  } catch (caught) {
    providers.value = [...saved.value];
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
      },
      5000,
    );
  } finally {
    saving.value = false;
  }
}

function onDragStart(index: number, event: DragEvent): void {
  dragIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', providers.value[index]!.id);
  }
}

function onDragEnter(index: number): void {
  if (dragIndex.value === null || dragIndex.value === index) return;
  move(dragIndex.value, index);
  dragIndex.value = index;
}

function onDragEnd(): void {
  dragIndex.value = null;
  void commit();
}

function step(index: number, delta: number): void {
  move(index, index + delta);
  void commit();
}

onMounted(load);
</script>

<template>
  <CaCard class="wsp">
    <h2 class="wsp__title">{{ t('admin.providers.webSearch.title') }}</h2>
    <p class="wsp__hint">
      {{
        canManage ? t('admin.providers.webSearch.hint') : t('admin.providers.webSearch.readOnly')
      }}
    </p>

    <CaSpinner v-if="loading" />
    <p v-else-if="failed" class="admin-error">{{ t('errors.loadFailed') }}</p>
    <ol v-else class="wsp__list">
      <li
        v-for="(provider, index) in providers"
        :key="provider.id"
        class="wsp__row"
        :class="{ 'wsp__row--drag': dragIndex === index, 'wsp__row--movable': canReorder }"
        :draggable="canReorder"
        @dragstart="onDragStart(index, $event)"
        @dragenter.prevent="onDragEnter(index)"
        @dragover.prevent
        @drop.prevent
        @dragend="onDragEnd"
      >
        <CaIcon v-if="canManage" name="chevron-up-down" :size="16" class="wsp__handle" />
        <span class="wsp__rank">{{ index + 1 }}</span>
        <span class="wsp__name">{{ provider.name }}</span>
        <CaBadge :variant="provider.configured ? 'success' : 'neutral'">
          {{
            provider.configured
              ? t('admin.providers.configuredBadge')
              : t('admin.providers.notConfiguredBadge')
          }}
        </CaBadge>
        <span v-if="canManage" class="wsp__moves">
          <button
            type="button"
            class="wsp__move"
            :disabled="!canReorder || index === 0"
            :aria-label="t('admin.providers.webSearch.moveUp', { name: provider.name })"
            @click="step(index, -1)"
          >
            <CaIcon name="arrow-up" :size="14" />
          </button>
          <button
            type="button"
            class="wsp__move"
            :disabled="!canReorder || index === providers.length - 1"
            :aria-label="t('admin.providers.webSearch.moveDown', { name: provider.name })"
            @click="step(index, 1)"
          >
            <CaIcon name="arrow-down" :size="14" />
          </button>
        </span>
      </li>
    </ol>
  </CaCard>
</template>

<style scoped>
.wsp {
  margin-top: var(--ca-space-8);
}
.wsp__title {
  margin: 0;
  font-size: var(--ca-text-400);
  color: var(--ca-fg-1);
}
.wsp__hint {
  margin: var(--ca-space-1) 0 var(--ca-space-4);
  color: var(--ca-fg-2);
  font-size: var(--ca-text-200);
}
.wsp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}
.wsp__row {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  padding: var(--ca-space-3) var(--ca-space-4);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
}
.wsp__row--movable {
  cursor: grab;
}
.wsp__row--drag {
  opacity: 0.5;
  border-style: dashed;
  border-color: var(--ca-color-brand);
}
.wsp__handle {
  color: var(--ca-fg-3);
}
.wsp__rank {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  background: var(--ca-color-brand);
  color: var(--ca-fg-on-brand);
  font-size: 12px;
  font-weight: 700;
}
.wsp__name {
  flex: 1;
  min-width: 0;
  color: var(--ca-fg-1);
  font-weight: 600;
}
.wsp__moves {
  display: inline-flex;
  gap: 2px;
}
.wsp__move {
  border: 0;
  background: transparent;
  padding: 4px;
  color: var(--ca-fg-2);
  cursor: pointer;
  border-radius: var(--ca-radius-sm, 4px);
}
.wsp__move:hover:not(:disabled) {
  background: var(--ca-bg-surface-2);
  color: var(--ca-color-brand-text);
}
.wsp__move:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
