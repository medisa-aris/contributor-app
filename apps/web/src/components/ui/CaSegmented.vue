<script setup lang="ts" generic="K extends string | number">
export interface CaSegmentedItem<V> {
  key: V;
  label: string;
}

defineProps<{
  items: CaSegmentedItem<K>[];
  label: string;
}>();

const model = defineModel<K>({ required: true });
</script>

<template>
  <div class="ca-segmented" role="group" :aria-label="label">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="ca-segmented__item"
      :class="{ 'ca-segmented__item--active': item.key === model }"
      :aria-pressed="item.key === model"
      @click="model = item.key"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<style scoped>
.ca-segmented {
  display: inline-flex;
  border: 1px solid var(--ca-stroke-accessible);
  border-radius: var(--ca-radius-md);
  overflow: hidden;
  background: var(--ca-bg-surface);
}

.ca-segmented__item {
  height: 30px;
  padding: 0 var(--ca-space-6);
  border: 0;
  background: transparent;
  color: var(--ca-fg-1);
  font: inherit;
  cursor: pointer;
  transition: background-color var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.ca-segmented__item + .ca-segmented__item {
  border-left: 1px solid var(--ca-stroke-accessible);
}

.ca-segmented__item:hover:not(.ca-segmented__item--active) {
  background: var(--ca-bg-surface-hover);
}

.ca-segmented__item--active {
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand-text);
  font-weight: var(--ca-font-weight-semibold);
}

.ca-segmented__item:focus-visible {
  outline-offset: -2px;
}
</style>
