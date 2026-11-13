<script setup lang="ts">
import CaIcon from './CaIcon.vue';
import CaMenu, { type CaMenuItem } from './CaMenu.vue';

defineProps<{
  items: CaMenuItem[];
  label: string;
}>();

const emit = defineEmits<{ select: [key: string] }>();
</script>

<template>
  <CaMenu :items="items" align="end" @select="emit('select', $event)">
    <template #trigger="{ open }">
      <button type="button" class="ca-row-menu" :aria-label="label" aria-haspopup="menu" :aria-expanded="open">
        <CaIcon name="more" :size="20" />
      </button>
    </template>
  </CaMenu>
</template>

<style scoped>
.ca-row-menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--ca-radius-md);
  background: transparent;
  color: var(--ca-fg-3);
  cursor: pointer;
}

.ca-row-menu:hover,
.ca-row-menu[aria-expanded='true'] {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}
</style>
