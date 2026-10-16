<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import CaIconButton from './CaIconButton.vue';

const props = defineProps<{
  page: number;
  limit: number;
  total: number;
}>();

const emit = defineEmits<{ change: [page: number] }>();

const { t } = useI18n();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.limit)));
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.limit + 1));
const to = computed(() => Math.min(props.page * props.limit, props.total));

const pages = computed<number[]>(() => {
  const last = totalPages.value;
  const current = props.page;
  const window: number[] = [];
  for (let page = Math.max(1, current - 2); page <= Math.min(last, current + 2); page += 1) {
    window.push(page);
  }
  return window;
});

function go(page: number): void {
  if (page >= 1 && page <= totalPages.value && page !== props.page) emit('change', page);
}
</script>

<template>
  <nav class="ca-pagination" :aria-label="t('common.page')">
    <p class="ca-pagination__summary">
      {{ t('table.rowCount', { from, to, total }) }}
    </p>
    <div class="ca-pagination__controls">
      <CaIconButton :label="t('common.previous')" :disabled="page <= 1" @click="go(page - 1)">
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
          <path
            d="M12.15 4.65a.5.5 0 0 1 0 .7L7.5 10l4.65 4.65a.5.5 0 0 1-.7.7l-5-5a.5.5 0 0 1 0-.7l5-5a.5.5 0 0 1 .7 0Z"
          />
        </svg>
      </CaIconButton>
      <button
        v-for="pageNumber in pages"
        :key="pageNumber"
        type="button"
        class="ca-pagination__page"
        :class="{ 'ca-pagination__page--active': pageNumber === page }"
        :aria-current="pageNumber === page ? 'page' : undefined"
        @click="go(pageNumber)"
      >
        {{ pageNumber }}
      </button>
      <CaIconButton
        :label="t('common.next')"
        :disabled="page >= totalPages"
        @click="go(page + 1)"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
          <path
            d="M7.85 4.65a.5.5 0 0 0 0 .7L12.5 10l-4.65 4.65a.5.5 0 0 0 .7.7l5-5a.5.5 0 0 0 0-.7l-5-5a.5.5 0 0 0-.7 0Z"
          />
        </svg>
      </CaIconButton>
    </div>
  </nav>
</template>

<style scoped>
.ca-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
}

.ca-pagination__summary {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.ca-pagination__controls {
  display: flex;
  align-items: center;
  gap: var(--ca-space-1);
}

.ca-pagination__page {
  min-width: 32px;
  height: 32px;
  padding: 0 var(--ca-space-2);
  border: none;
  border-radius: var(--ca-radius-md);
  background: transparent;
  color: var(--ca-fg-2);
  font-size: var(--ca-text-300);
  cursor: pointer;
  transition: background-color var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.ca-pagination__page:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}

.ca-pagination__page--active {
  background: var(--ca-color-brand);
  color: var(--ca-fg-on-brand);
  font-weight: var(--ca-font-weight-semibold);
}

.ca-pagination__page--active:hover {
  background: var(--ca-color-brand-hover);
  color: var(--ca-fg-on-brand);
}
</style>
