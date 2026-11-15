<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MEMORY_ENTRY_TYPES } from '@bara/shared';
import { ApiError } from '@/api/http';
import {
  createMemoryEntry,
  deleteMemoryEntry,
  listMemoryEntries,
  listMyAccessLog,
  memoryStatus,
  memorySummary,
  setMemoryDoor,
  updateMemoryEntry,
  type MemoryAccessLogDto,
  type MemoryBookSummaryDto,
  type MemoryEntryDto,
  type MemoryEntryType,
  type MemorySensitivity,
} from '@/api/memory';
import {
  CaBadge,
  CaButton,
  CaCheckbox,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaPagination,
  CaRowMenu,
  CaSegmented,
  CaSelect,
  CaStatCard,
  CaSwitch,
  CaTable,
  CaTabs,
  CaTextarea,
  type CaTableColumn,
} from '@/components/ui';
import { usePagedList } from '@/composables/usePagedList';
import { useToastStore } from '@/stores/toast.store';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const toast = useToastStore();

const tab = ref<'entries' | 'door' | 'log'>('entries');
const summary = ref<MemoryBookSummaryDto | null>(null);
const semantic = ref(false);

const entries = usePagedList<MemoryEntryDto>((query) => listMemoryEntries(query), { pageSize: 20 });
const log = usePagedList<MemoryAccessLogDto>((query) => listMyAccessLog(query), { pageSize: 20 });

const typeFilter = ref<MemoryEntryType | 'all'>('all');
const search = ref('');

const typeItems = computed(() => [
  { key: 'all' as const, label: t('memory.types.all') },
  ...MEMORY_ENTRY_TYPES.map((type) => ({ key: type, label: t(`memory.types.${type}`) })),
]);

const visibleThroughDoor = computed(() => {
  const s = summary.value;
  if (!s || !s.door.enabled) return 0;
  return s.door.exposedTypes.reduce((sum, type) => sum + (s.counts[type] ?? 0), 0);
});

const tabs = computed(() => [
  { key: 'entries', label: t('memory.tabs.entries'), count: summary.value?.total },
  { key: 'door', label: t('memory.tabs.door') },
  { key: 'log', label: t('memory.tabs.log') },
]);

const entryColumns = computed<CaTableColumn[]>(() => [
  { key: 'content', label: t('memory.columns.content'), sortable: false },
  { key: 'type', label: t('memory.columns.type'), sortValue: (row) => row.type },
  { key: 'sensitivity', label: t('memory.columns.sensitivity'), sortValue: (row) => row.sensitivity },
  { key: 'source', label: t('memory.columns.source'), sortValue: (row) => row.sourceKind },
  { key: 'used', label: t('memory.columns.used'), sortValue: (row) => row.useCount },
  { key: 'updated', label: t('memory.columns.updated'), sortValue: (row) => row.updatedAt },
  { key: 'actions', label: t('table.actions'), sortable: false },
]);

const logColumns = computed<CaTableColumn[]>(() => [
  { key: 'actor', label: t('memory.log.actor'), sortValue: (row) => row.actorName },
  { key: 'action', label: t('memory.log.action'), sortValue: (row) => row.action },
  { key: 'context', label: t('memory.log.context'), sortable: false },
  { key: 'entries', label: t('memory.log.entries'), sortValue: (row) => row.entryCount },
  { key: 'at', label: t('memory.log.at'), sortValue: (row) => row.createdAt },
]);

function toastError(caught: unknown): void {
  toast.push(
    { variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') },
    5000,
  );
}

async function loadSummary(): Promise<void> {
  try {
    summary.value = await memorySummary();
    door.enabled = summary.value.door.enabled;
    door.exposedTypes = [...summary.value.door.exposedTypes];
  } catch (caught) {
    toastError(caught);
  }
}

function applyFilters(): void {
  entries.setFilter({
    type: typeFilter.value === 'all' ? undefined : typeFilter.value,
    search: search.value.trim() || undefined,
  });
}

watch(typeFilter, applyFilters);
watch(tab, (next) => {
  if (next === 'log') void log.load();
});

// ── Tambah / ubah catatan ──
const showForm = ref(false);
const editing = ref<MemoryEntryDto | null>(null);
const saving = ref(false);
const form = reactive<{ type: MemoryEntryType; content: string; sensitivity: MemorySensitivity; importance: string }>({
  type: 'fact',
  content: '',
  sensitivity: 'shareable',
  importance: '3',
});

const typeOptions = computed(() =>
  MEMORY_ENTRY_TYPES.map((type) => ({ value: type, label: `${t(`memory.types.${type}`)} — ${t(`memory.typeHints.${type}`)}` })),
);
const importanceOptions = computed(() =>
  [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} · ${t(`memory.importance.${n}`)}` })),
);
const sensitivityItems = computed(() => [
  { key: 'shareable' as const, label: t('memory.sensitivity.shareable') },
  { key: 'private' as const, label: t('memory.sensitivity.private') },
]);

function openCreate(): void {
  editing.value = null;
  Object.assign(form, { type: 'fact', content: '', sensitivity: 'shareable', importance: '3' });
  showForm.value = true;
}

function openEdit(entry: MemoryEntryDto): void {
  editing.value = entry;
  Object.assign(form, {
    type: entry.type,
    content: entry.content,
    sensitivity: entry.sensitivity,
    importance: String(entry.importance),
  });
  showForm.value = true;
}

async function submit(): Promise<void> {
  if (form.content.trim().length < 3) return;
  saving.value = true;
  const payload = {
    type: form.type,
    content: form.content.trim(),
    sensitivity: form.sensitivity,
    importance: Number(form.importance),
  };
  try {
    if (editing.value) await updateMemoryEntry(editing.value.id, payload);
    else await createMemoryEntry(payload);
    showForm.value = false;
    toast.push({ variant: 'success', title: t('memory.saved') }, 3000);
    await Promise.all([entries.load(), loadSummary()]);
  } catch (caught) {
    toastError(caught);
  } finally {
    saving.value = false;
  }
}

async function toggleSensitivity(entry: MemoryEntryDto): Promise<void> {
  try {
    await updateMemoryEntry(entry.id, {
      sensitivity: entry.sensitivity === 'private' ? 'shareable' : 'private',
    });
    await Promise.all([entries.load(), loadSummary()]);
  } catch (caught) {
    toastError(caught);
  }
}

async function remove(entry: MemoryEntryDto): Promise<void> {
  if (!window.confirm(t('memory.confirmDelete'))) return;
  try {
    await deleteMemoryEntry(entry.id);
    toast.push({ variant: 'success', title: t('memory.deleted') }, 3000);
    await Promise.all([entries.load(), loadSummary()]);
  } catch (caught) {
    toastError(caught);
  }
}

function onRowAction(key: string, entry: MemoryEntryDto): void {
  if (key === 'edit') openEdit(entry);
  else if (key === 'privacy') void toggleSensitivity(entry);
  else if (key === 'delete') void remove(entry);
}

// ── Pintu saya ──
const door = reactive<{ enabled: boolean; exposedTypes: MemoryEntryType[] }>({ enabled: false, exposedTypes: [] });
const savingDoor = ref(false);

function toggleExposed(type: MemoryEntryType, on: boolean): void {
  door.exposedTypes = on ? [...new Set([...door.exposedTypes, type])] : door.exposedTypes.filter((t2) => t2 !== type);
}

async function saveDoor(): Promise<void> {
  savingDoor.value = true;
  try {
    await setMemoryDoor({ enabled: door.enabled, exposedTypes: door.exposedTypes });
    toast.push({ variant: 'success', title: t('memory.door.saved') }, 3000);
    await loadSummary();
  } catch (caught) {
    toastError(caught);
  } finally {
    savingDoor.value = false;
  }
}

onMounted(() => {
  void loadSummary();
  void entries.load();
  void memoryStatus()
    .then((status) => (semantic.value = status.semantic))
    .catch(() => (semantic.value = false));
});
</script>

<template>
  <div>
    <CaPageHeader :title="t('memory.title')" :description="t('memory.description')">
      <template #actions>
        <CaButton variant="primary" @click="openCreate">{{ t('memory.add') }}</CaButton>
      </template>
    </CaPageHeader>

    <section v-if="summary" class="ca-kpis" :aria-label="t('memory.title')">
      <CaStatCard :label="t('memory.stats.total')" :value="summary.total" />
      <CaStatCard :label="t('memory.stats.shareable')" :value="visibleThroughDoor" />
      <CaStatCard
        :label="t('memory.stats.door')"
        :value="summary.door.enabled ? t('memory.stats.doorOpen') : t('memory.stats.doorClosed')"
        :tone="summary.door.enabled ? 'success' : 'neutral'"
      />
      <CaStatCard
        :label="t('memory.stats.semantic')"
        :value="semantic ? t('memory.stats.semanticOn') : t('memory.stats.semanticOff')"
      />
    </section>

    <CaTabs v-model="tab" :items="tabs" class="memory__tabs" />

    <section v-if="tab === 'entries'" class="ca-panel">
      <p v-if="entries.error.value" class="admin-error" role="alert">{{ entries.error.value }}</p>
      <CaTable
        table-key="memory-entries"
        :columns="entryColumns"
        :rows="entries.items.value"
        :row-key="(row) => row.id"
        :loading="entries.loading.value"
        :empty-title="t('memory.empty')"
        :empty-description="t('memory.emptyHint')"
      >
        <template #toolbar>
          <div class="ca-toolbar memory__toolbar">
            <CaSegmented v-model="typeFilter" :items="typeItems" :label="t('memory.columns.type')" />
            <CaInput
              v-model="search"
              class="ca-toolbar__search"
              :placeholder="t('memory.search')"
              :aria-label="t('memory.search')"
              @keyup.enter="applyFilters"
            />
            <CaButton variant="secondary" @click="applyFilters">{{ t('common.search') }}</CaButton>
          </div>
        </template>
        <template #cell-content="{ row }">
          <p class="memory__content">{{ row.content }}</p>
          <p v-if="row.editedByOwner" class="memory__meta">{{ t('memory.editedByOwner') }}</p>
        </template>
        <template #cell-type="{ row }">
          <CaBadge size="small" no-icon>{{ t(`memory.types.${row.type}`) }}</CaBadge>
        </template>
        <template #cell-sensitivity="{ row }">
          <CaBadge size="small" :variant="row.sensitivity === 'private' ? 'warning' : 'success'">
            {{ t(`memory.sensitivity.${row.sensitivity}`) }}
          </CaBadge>
        </template>
        <template #cell-source="{ row }">{{ t(`memory.source.${row.sourceKind}`) }}</template>
        <template #cell-used="{ row }">{{ t('memory.usedTimes', { n: row.useCount }) }}</template>
        <template #cell-updated="{ row }">{{ formatDateTime(String(row.updatedAt)) }}</template>
        <template #cell-actions="{ row }">
          <CaRowMenu
            :label="t('table.rowActions')"
            :items="[
              { key: 'edit', label: t('memory.edit') },
              {
                key: 'privacy',
                label: row.sensitivity === 'private' ? t('memory.makeShareable') : t('memory.makePrivate'),
              },
              { key: 'delete', label: t('memory.delete'), danger: true, divider: true },
            ]"
            @select="(key: string) => onRowAction(key, row as MemoryEntryDto)"
          />
        </template>
      </CaTable>
      <CaPagination
        :page="entries.page.value"
        :limit="entries.pageSize.value"
        :total="entries.total.value"
        @change="entries.goPage"
      />
    </section>

    <section v-else-if="tab === 'door'" class="ca-panel memory__door">
      <h2 class="memory__door-title">{{ t('memory.door.title') }}</h2>
      <p class="memory__door-text">{{ t('memory.door.description') }}</p>
      <CaSwitch v-model="door.enabled" :label="t('memory.door.enable')" />
      <fieldset class="memory__exposed" :disabled="!door.enabled">
        <legend>{{ t('memory.door.exposed') }}</legend>
        <CaCheckbox
          v-for="type in MEMORY_ENTRY_TYPES"
          :key="type"
          :model-value="door.exposedTypes.includes(type)"
          :disabled="!door.enabled"
          :label="`${t(`memory.types.${type}`)} — ${t(`memory.typeHints.${type}`)}`"
          @update:model-value="(on: boolean) => toggleExposed(type, on)"
        />
        <p class="memory__meta">{{ t('memory.door.exposedHint') }}</p>
      </fieldset>
      <div>
        <CaButton variant="primary" :disabled="savingDoor" @click="saveDoor">{{ t('common.save') }}</CaButton>
      </div>
    </section>

    <section v-else class="ca-panel">
      <p v-if="log.error.value" class="admin-error" role="alert">{{ log.error.value }}</p>
      <CaTable
        table-key="memory-access-log"
        :columns="logColumns"
        :rows="log.items.value"
        :row-key="(row) => row.id"
        :loading="log.loading.value"
        :empty-title="t('memory.log.empty')"
      >
        <template #cell-actor="{ row }">{{ row.actorName }}</template>
        <template #cell-action="{ row }">
          <CaBadge
            size="small"
            no-icon
            :variant="row.action === 'door_closed' ? undefined : 'informative'"
          >
            {{ t(`memory.log.actions.${row.action}`) }}
          </CaBadge>
        </template>
        <template #cell-context="{ row }">{{ t(`memory.log.contexts.${row.contextKind}`) }}</template>
        <template #cell-entries="{ row }">{{ row.action === 'entries_read' ? row.entryCount : '—' }}</template>
        <template #cell-at="{ row }">{{ formatDateTime(String(row.createdAt)) }}</template>
      </CaTable>
      <CaPagination
        :page="log.page.value"
        :limit="log.pageSize.value"
        :total="log.total.value"
        @change="log.goPage"
      />
    </section>

    <CaDialog v-model:open="showForm" :title="editing ? t('memory.edit') : t('memory.add')" size="medium">
      <div class="admin-form">
        <CaField :label="t('memory.form.type')">
          <CaSelect v-model="form.type" :options="typeOptions" />
        </CaField>
        <CaField :label="t('memory.form.content')" :hint="t('memory.form.contentHint')" required>
          <CaTextarea v-model="form.content" :rows="4" />
        </CaField>
        <CaField :label="t('memory.form.sensitivity')">
          <CaSegmented v-model="form.sensitivity" :items="sensitivityItems" :label="t('memory.form.sensitivity')" />
        </CaField>
        <CaField :label="t('memory.form.importance')">
          <CaSelect v-model="form.importance" :options="importanceOptions" />
        </CaField>
      </div>
      <template #footer>
        <CaButton variant="subtle" @click="showForm = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :disabled="saving || form.content.trim().length < 3" @click="submit">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>
  </div>
</template>

<style scoped>
.memory__tabs {
  margin-bottom: var(--ca-space-4);
}

.memory__toolbar {
  flex-wrap: wrap;
}

.memory__content {
  margin: 0;
  min-width: 26ch;
  max-width: 64ch;
  color: var(--ca-fg-1);
  white-space: pre-wrap;
}

.memory__meta {
  margin: var(--ca-space-1) 0 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.memory__door {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
  max-width: 760px;
}

.memory__door-title {
  margin: 0;
  font-size: var(--ca-text-500);
  font-weight: var(--ca-font-weight-semibold);
}

.memory__door-text {
  margin: 0;
  color: var(--ca-fg-2);
}

.memory__exposed {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  margin: 0;
  padding: var(--ca-space-5);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl, 8px);
}

.memory__exposed legend {
  padding: 0 var(--ca-space-2);
  font-weight: var(--ca-font-weight-semibold);
}

.memory__exposed:disabled {
  opacity: 0.6;
}
</style>
