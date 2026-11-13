<script setup lang="ts">
import { RouterLink } from 'vue-router';
import CaIcon from './CaIcon.vue';

export interface CaBreadcrumbItem {
  label: string;
  to?: string;
}

defineProps<{
  items: CaBreadcrumbItem[];
}>();
</script>

<template>
  <nav class="ca-breadcrumb" aria-label="Breadcrumb">
    <template v-for="(item, index) in items" :key="index">
      <CaIcon v-if="index > 0" name="chevron-right" :size="12" class="ca-breadcrumb__separator" />
      <RouterLink v-if="item.to && index < items.length - 1" :to="item.to" class="ca-breadcrumb__link">
        {{ item.label }}
      </RouterLink>
      <span
        v-else
        class="ca-breadcrumb__current"
        :aria-current="index === items.length - 1 ? 'page' : undefined"
      >
        {{ item.label }}
      </span>
    </template>
  </nav>
</template>

<style scoped>
.ca-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
  min-width: 0;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
}

.ca-breadcrumb__separator {
  color: var(--ca-fg-3);
  flex: none;
}

.ca-breadcrumb__link {
  color: var(--ca-fg-3);
}

.ca-breadcrumb__link:hover {
  color: var(--ca-color-link-hover);
}

.ca-breadcrumb__current {
  color: var(--ca-fg-1);
  font-weight: var(--ca-font-weight-semibold);
}
</style>
