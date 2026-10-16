<script setup lang="ts">
export interface CaTabItem {
  key: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

defineProps<{
  items: CaTabItem[];
}>();

const active = defineModel<string>({ required: true });
</script>

<template>
  <div class="ca-tabs" role="tablist">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      role="tab"
      class="ca-tabs__tab"
      :class="{ 'ca-tabs__tab--active': item.key === active }"
      :aria-selected="item.key === active"
      :disabled="item.disabled"
      @click="active = item.key"
    >
      {{ item.label }}
      <span v-if="item.count !== undefined" class="ca-tabs__count">{{ item.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.ca-tabs {
  display: flex;
  gap: var(--ca-space-1);
  border-bottom: 1px solid var(--ca-stroke-2);
}

.ca-tabs__tab {
  position: relative;
  padding: var(--ca-space-3) var(--ca-space-6) var(--ca-space-4);
  border: none;
  background: transparent;
  color: var(--ca-fg-2);
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  font-weight: var(--ca-font-weight-semibold);
  cursor: pointer;
  border-radius: var(--ca-radius-md) var(--ca-radius-md) 0 0;
  transition: color var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.ca-tabs__tab::after {
  content: '';
  position: absolute;
  left: var(--ca-space-4);
  right: var(--ca-space-4);
  bottom: -1px;
  height: 2px;
  border-radius: var(--ca-radius-circular);
  background: transparent;
}

.ca-tabs__tab:hover:not(:disabled) {
  color: var(--ca-fg-1);
}

.ca-tabs__tab--active {
  color: var(--ca-color-brand);
}

.ca-tabs__tab--active::after {
  background: var(--ca-color-brand);
}

.ca-tabs__tab:disabled {
  color: var(--ca-fg-disabled);
  cursor: not-allowed;
}

.ca-tabs__count {
  margin-left: var(--ca-space-2);
  padding: 0 var(--ca-space-4);
  border-radius: var(--ca-radius-circular);
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-100);
}
</style>
