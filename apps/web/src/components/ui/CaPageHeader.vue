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
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--ca-space-8);
  flex-wrap: wrap;
  margin-bottom: var(--ca-space-12);
}

.page-header__title {
  font-size: var(--ca-text-700);
  line-height: var(--ca-line-700);
  font-weight: var(--ca-font-weight-semibold);
}

.page-header__description {
  margin-top: var(--ca-space-2);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  max-width: 680px;
}

.page-header__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ca-space-4);
}
</style>
