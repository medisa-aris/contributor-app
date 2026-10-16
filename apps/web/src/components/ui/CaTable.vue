<script setup lang="ts" generic="T extends Record<string, unknown>">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import CaEmptyState from './CaEmptyState.vue';
import CaSkeleton from './CaSkeleton.vue';
import CaIcon from './CaIcon.vue';

export interface CaTableColumn {
  key: string;
  label: string;
  width?: string;
  align?: 'start' | 'center' | 'end';
  sortable?: boolean;
  visible?: boolean;
  sortValue?: (row: Record<string, unknown>) => unknown;
}

interface ColumnStateEntry {
  key: string;
  visible: boolean;
}

const props = withDefaults(
  defineProps<{
    columns: CaTableColumn[];
    rows: T[];
    rowKey: (row: T) => string;
    loading?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    hover?: boolean;
    tableKey?: string;
  }>(),
  { hover: true, tableKey: '' },
);

const { t } = useI18n();

const STORAGE_PREFIX = 'ca.table.';

function defaultState(): ColumnStateEntry[] {
  return props.columns.map((c) => ({ key: c.key, visible: c.visible !== false }));
}

function loadState(): ColumnStateEntry[] {
  if (!props.tableKey) return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + props.tableKey);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw) as { order?: string[]; hidden?: string[] };
    const hidden = new Set(saved.hidden ?? []);
    const entries: ColumnStateEntry[] = [];
    for (const key of saved.order ?? []) {
      if (props.columns.some((c) => c.key === key)) {
        entries.push({ key, visible: !hidden.has(key) });
      }
    }
    for (const c of props.columns) {
      if (!entries.some((e) => e.key === c.key)) {
        entries.push({ key: c.key, visible: c.visible !== false && !hidden.has(c.key) });
      }
    }
    return entries;
  } catch {
    return defaultState();
  }
}

const columnState = ref<ColumnStateEntry[]>(loadState());

function saveState(): void {
  if (!props.tableKey) return;
  localStorage.setItem(
    STORAGE_PREFIX + props.tableKey,
    JSON.stringify({
      order: columnState.value.map((e) => e.key),
      hidden: columnState.value.filter((e) => !e.visible).map((e) => e.key),
    }),
  );
}

watch(
  () => props.columns,
  () => {
    const next: ColumnStateEntry[] = [];
    for (const entry of columnState.value) {
      if (props.columns.some((c) => c.key === entry.key)) next.push(entry);
    }
    for (const c of props.columns) {
      if (!next.some((e) => e.key === c.key)) {
        next.push({ key: c.key, visible: c.visible !== false });
      }
    }
    columnState.value = next;
  },
);

function columnDef(key: string): CaTableColumn | undefined {
  return props.columns.find((c) => c.key === key);
}

function columnLabel(key: string): string {
  const def = columnDef(key);
  if (!def) return key;
  return def.label || (def.key === 'actions' ? t('table.actions') : def.key);
}

const visibleColumns = computed<CaTableColumn[]>(() =>
  columnState.value
    .filter((e) => e.visible)
    .map((e) => columnDef(e.key))
    .filter((c): c is CaTableColumn => !!c),
);

function moveColumn(key: string, delta: number): void {
  const idx = columnState.value.findIndex((e) => e.key === key);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= columnState.value.length) return;
  const next = [...columnState.value];
  [next[idx], next[target]] = [next[target], next[idx]];
  columnState.value = next;
  saveState();
}

function toggleColumn(key: string): void {
  const entry = columnState.value.find((e) => e.key === key);
  if (!entry) return;
  entry.visible = !entry.visible;
  saveState();
}

const panelOpen = ref(false);

const sortKey = ref<string | null>(null);
const sortDir = ref<'asc' | 'desc'>('asc');

function onSort(column: CaTableColumn): void {
  if (column.sortable === false) return;
  if (sortKey.value !== column.key) {
    sortKey.value = column.key;
    sortDir.value = 'asc';
  } else if (sortDir.value === 'asc') {
    sortDir.value = 'desc';
  } else {
    sortKey.value = null;
  }
}

function sortAriaLabel(column: CaTableColumn): string {
  if (sortKey.value !== column.key) return `${column.label} — ${t('table.sortAsc')}`;
  return sortDir.value === 'asc'
    ? `${column.label} — ${t('table.sortDesc')}`
    : `${column.label} — ${t('table.sortClear')}`;
}

function cellValue(row: T, column: CaTableColumn): unknown {
  return column.sortValue ? column.sortValue(row) : row[column.key];
}

const sortedRows = computed<T[]>(() => {
  const key = sortKey.value;
  const column = key ? columnDef(key) : undefined;
  if (!key || !column) return props.rows;
  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...props.rows].sort((a, b) => {
    const va = cellValue(a, column);
    const vb = cellValue(b, column);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), 'id') * dir;
  });
});
</script>

<template>
  <div class="ca-table-wrapper">
    <div class="ca-table__toolbar">
      <span v-if="sortKey" class="ca-table__sort-note">
        {{ t('table.sortedBy', { column: columnLabel(sortKey) }) }}
        <button type="button" class="ca-table__sort-clear" @click="sortKey = null">
          {{ t('table.sortClear') }}
        </button>
      </span>
      <span class="ca-table__toolbar-spacer" />
      <button
        type="button"
        class="ca-table__columns-btn"
        :aria-expanded="panelOpen"
        :aria-label="t('table.columnSettings')"
        @click="panelOpen = !panelOpen"
      >
        <CaIcon name="columns" :size="16" />
        <span>{{ t('table.columnSettings') }}</span>
        <CaIcon name="chevron-down" :size="12" />
      </button>
    </div>

    <div v-if="panelOpen" class="ca-table__scrim" @click="panelOpen = false" />
    <div v-if="panelOpen" class="ca-table__panel" role="dialog" :aria-label="t('table.columnSettings')">
      <p class="ca-table__panel-title">{{ t('table.columnSettings') }}</p>
      <ul class="ca-table__panel-list">
        <li v-for="(entry, idx) in columnState" :key="entry.key" class="ca-table__panel-row">
          <label class="ca-table__panel-check">
            <input type="checkbox" :checked="entry.visible" @change="toggleColumn(entry.key)" />
            <span>{{ columnLabel(entry.key) }}</span>
          </label>
          <span class="ca-table__panel-move">
            <button
              type="button"
              class="ca-table__panel-move-btn"
              :disabled="idx === 0"
              :aria-label="t('table.moveUp')"
              @click="moveColumn(entry.key, -1)"
            >
              <CaIcon name="arrow-up" :size="14" />
            </button>
            <button
              type="button"
              class="ca-table__panel-move-btn"
              :disabled="idx === columnState.length - 1"
              :aria-label="t('table.moveDown')"
              @click="moveColumn(entry.key, 1)"
            >
              <CaIcon name="arrow-down" :size="14" />
            </button>
          </span>
        </li>
      </ul>
    </div>

    <table class="ca-table">
      <thead>
        <tr>
          <th
            v-for="column in visibleColumns"
            :key="column.key"
            scope="col"
            :style="{ width: column.width, textAlign: column.align ?? 'start' }"
          >
            <button
              v-if="column.sortable !== false"
              type="button"
              class="ca-table__sort"
              :class="{
                'ca-table__sort--active': sortKey === column.key,
              }"
              :aria-label="sortAriaLabel(column)"
              @click="onSort(column)"
            >
              <span>{{ column.label }}</span>
              <CaIcon
                :name="sortKey === column.key ? (sortDir === 'asc' ? 'chevron-up' : 'chevron-down') : 'chevron-up-down'"
                :size="12"
              />
            </button>
            <template v-else>{{ column.label }}</template>
          </th>
        </tr>
      </thead>
      <tbody v-if="loading">
        <tr v-for="row in 5" :key="`skeleton-${row}`" class="ca-table__skeleton-row">
          <td v-for="column in visibleColumns" :key="column.key">
            <CaSkeleton width="80%" />
          </td>
        </tr>
      </tbody>
      <tbody v-else-if="sortedRows.length > 0">
        <tr v-for="row in sortedRows" :key="rowKey(row)" :class="{ 'ca-table__row--hover': hover }">
          <td
            v-for="column in visibleColumns"
            :key="column.key"
            :style="{ textAlign: column.align ?? 'start' }"
          >
            <slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]">
              {{ row[column.key] }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!loading && sortedRows.length === 0" class="ca-table__empty">
      <slot name="empty">
        <CaEmptyState :title="emptyTitle ?? t('table.empty')" :description="emptyDescription" />
      </slot>
    </div>
  </div>
</template>

<style scoped>
.ca-table-wrapper {
  width: 100%;
  overflow-x: auto;
  position: relative;
}

.ca-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
}

.ca-table__toolbar {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  padding-bottom: var(--ca-space-2);
}

.ca-table__toolbar-spacer {
  flex: 1;
}

.ca-table__sort-note {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-2);
}

.ca-table__sort-clear {
  border: none;
  background: transparent;
  color: var(--ca-color-link);
  font: inherit;
  font-size: var(--ca-text-200);
  cursor: pointer;
  padding: 0;
}
.ca-table__sort-clear:hover {
  color: var(--ca-color-link-hover);
  text-decoration: underline;
}

.ca-table__columns-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-2);
  padding: var(--ca-space-1) var(--ca-space-3);
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-2);
  font: inherit;
  font-size: var(--ca-text-200);
  cursor: pointer;
}
.ca-table__columns-btn:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}
.ca-table__columns-btn[aria-expanded='true'] {
  border-color: var(--ca-color-brand);
  color: var(--ca-color-brand);
}

.ca-table__scrim {
  position: fixed;
  inset: 0;
  z-index: 90;
}

.ca-table__panel {
  position: absolute;
  top: 40px;
  right: 0;
  z-index: 100;
  min-width: 240px;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
  box-shadow: var(--ca-shadow-16);
  padding: var(--ca-space-3);
}

.ca-table__panel-title {
  margin: 0 0 var(--ca-space-2);
  font-size: var(--ca-text-200);
  font-weight: 600;
  color: var(--ca-fg-2);
}

.ca-table__panel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ca-table__panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-2);
  padding: var(--ca-space-1) var(--ca-space-2);
  border-radius: var(--ca-radius-sm);
}
.ca-table__panel-row:hover {
  background: var(--ca-bg-surface-hover);
}

.ca-table__panel-check {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
  cursor: pointer;
  flex: 1;
  min-width: 0;
}

.ca-table__panel-move {
  display: inline-flex;
  gap: 2px;
}

.ca-table__panel-move-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--ca-radius-sm);
  background: transparent;
  color: var(--ca-fg-2);
  cursor: pointer;
}
.ca-table__panel-move-btn:hover:not(:disabled) {
  background: var(--ca-bg-surface-pressed);
  color: var(--ca-fg-1);
}
.ca-table__panel-move-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.ca-table th {
  text-align: start;
  font-weight: var(--ca-font-weight-semibold);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-2);
  padding: var(--ca-space-3) var(--ca-space-6);
  border-bottom: 1px solid var(--ca-stroke-2);
  white-space: nowrap;
}

.ca-table__sort {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-1);
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.ca-table__sort:hover {
  color: var(--ca-fg-1);
}
.ca-table__sort--active {
  color: var(--ca-color-brand);
}

.ca-table td {
  padding: var(--ca-space-4) var(--ca-space-6);
  border-bottom: 1px solid var(--ca-stroke-3);
  color: var(--ca-fg-1);
  vertical-align: middle;
}

.ca-table__row--hover:hover td {
  background: var(--ca-bg-surface-hover);
}

.ca-table tbody tr:last-child td {
  border-bottom: none;
}

.ca-table__skeleton-row td {
  padding-top: var(--ca-space-5);
  padding-bottom: var(--ca-space-5);
}

.ca-table__empty {
  border-top: 1px solid var(--ca-stroke-3);
}
</style>
