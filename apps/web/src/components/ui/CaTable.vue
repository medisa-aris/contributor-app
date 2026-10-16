<script setup lang="ts" generic="T extends Record<string, unknown>">
import { useI18n } from 'vue-i18n';
import CaEmptyState from './CaEmptyState.vue';
import CaSkeleton from './CaSkeleton.vue';

export interface CaTableColumn {
  key: string;
  label: string;
  width?: string;
  align?: 'start' | 'center' | 'end';
}

withDefaults(
  defineProps<{
    columns: CaTableColumn[];
    rows: T[];
    rowKey: (row: T) => string;
    loading?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    hover?: boolean;
  }>(),
  { hover: true },
);

defineSlots<{
  [key: `cell-${string}`]: (props: { row: T; value: unknown }) => unknown;
  empty?: () => unknown;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="ca-table-wrapper">
    <table class="ca-table">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            :style="{ width: column.width, textAlign: column.align ?? 'start' }"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody v-if="loading">
        <tr v-for="row in 5" :key="`skeleton-${row}`" class="ca-table__skeleton-row">
          <td v-for="column in columns" :key="column.key">
            <CaSkeleton width="80%" />
          </td>
        </tr>
      </tbody>
      <tbody v-else-if="rows.length > 0">
        <tr v-for="row in rows" :key="rowKey(row)" :class="{ 'ca-table__row--hover': hover }">
          <td
            v-for="column in columns"
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
    <div v-if="!loading && rows.length === 0" class="ca-table__empty">
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
}

.ca-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
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
