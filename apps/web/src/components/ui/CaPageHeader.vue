<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">{{ title }}</h1>
      <p v-if="description" class="page-header__description">{{ description }}</p>
    </div>
    <div class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--ca-space-6);
}

.page-header__title {
  font-size: var(--ca-text-600);
  line-height: var(--ca-line-600);
  font-weight: var(--ca-font-weight-semibold);
}

.page-header__description {
  margin-top: var(--ca-space-1);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  max-width: 640px;
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  flex-shrink: 0;
}
</style>
