<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  deleteMemoryEntry,
  listMemoryEntries,
  memorySummary,
  setMemoryDoor,
  type MemoryBookSummaryDto,
  type MemoryEntryDto,
} from '@/api/memory';
import { useToastStore } from '@/stores/toast.store';
import { CaBadge, CaSwitch } from '@/components/ui';

/** Buku memori agent pribadi: catatan dari tugas sebelumnya dan izin pintunya. */
const props = defineProps<{ agentId: string }>();

const { t } = useI18n();
const toast = useToastStore();

const summary = ref<MemoryBookSummaryDto | null>(null);
const entries = ref<MemoryEntryDto[]>([]);
const total = ref(0);
const busy = ref(false);

function toastError(caught: unknown): void {
  toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') }, 5000);
}

async function load(): Promise<void> {
  try {
    const [book, list] = await Promise.all([
      memorySummary(props.agentId),
      listMemoryEntries({ page: 1, pageSize: 8 }, props.agentId),
    ]);
    summary.value = book;
    entries.value = list.items;
    total.value = list.total;
  } catch (caught) {
    toastError(caught);
  }
}

async function setDoor(enabled: boolean): Promise<void> {
  if (!summary.value) return;
  busy.value = true;
  try {
    const door = await setMemoryDoor({ enabled, exposedTypes: summary.value.door.exposedTypes }, props.agentId);
    summary.value = { ...summary.value, door };
  } catch (caught) {
    toastError(caught);
  } finally {
    busy.value = false;
  }
}

async function remove(entry: MemoryEntryDto): Promise<void> {
  if (!window.confirm(t('memory.confirmDelete'))) return;
  try {
    await deleteMemoryEntry(entry.id, props.agentId);
    await load();
  } catch (caught) {
    toastError(caught);
  }
}

onMounted(() => void load());
</script>

<template>
  <fieldset class="am">
    <legend>{{ t('memory.agent.tab') }}</legend>
    <p class="am__hint">{{ t('memory.agent.description') }}</p>
    <CaSwitch
      v-if="summary"
      :model-value="summary.door.enabled"
      :disabled="busy"
      :label="t('memory.agent.doorEnable')"
      @update:model-value="setDoor"
    />
    <p v-if="entries.length === 0" class="am__hint">{{ t('memory.empty') }}</p>
    <ul v-else class="am__list">
      <li v-for="entry in entries" :key="entry.id" class="am__item">
        <div class="am__text">
          <CaBadge size="small" no-icon>{{ t(`memory.types.${entry.type}`) }}</CaBadge>
          <span>{{ entry.content }}</span>
        </div>
        <button type="button" class="am__remove" :aria-label="t('memory.delete')" @click="remove(entry)">×</button>
      </li>
    </ul>
    <p v-if="total > entries.length" class="am__hint">
      {{ t('memory.bar.entries', { n: total }) }}
    </p>
  </fieldset>
</template>

<style scoped>
.am {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  margin: 0;
  padding: var(--ca-space-5);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl, 8px);
}

.am legend {
  padding: 0 var(--ca-space-2);
  font-weight: var(--ca-font-weight-semibold);
}

.am__hint {
  margin: 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.am__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.am__item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ca-space-3);
  padding: var(--ca-space-2) var(--ca-space-3);
  border-radius: var(--ca-radius-medium, 4px);
  background: var(--ca-bg-surface-2);
  font-size: var(--ca-text-200);
}

.am__text {
  display: flex;
  gap: var(--ca-space-2);
  align-items: baseline;
}

.am__remove {
  border: 0;
  background: transparent;
  color: var(--ca-fg-3);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
</style>
