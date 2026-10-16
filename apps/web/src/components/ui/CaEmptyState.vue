<script setup lang="ts">
defineProps<{
  title?: string;
  description?: string;
}>();
</script>

<template>
  <div class="ca-empty">
    <span class="ca-empty__icon" aria-hidden="true">
      <slot name="icon">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
          <path d="M2.5 7.5h15" />
          <path d="M5.5 11h9" stroke-linecap="round" />
          <path d="M5.5 13.5h5.5" stroke-linecap="round" />
        </svg>
      </slot>
    </span>
    <p class="ca-empty__title">{{ title }}</p>
    <p v-if="description" class="ca-empty__description">{{ description }}</p>
    <div v-if="$slots.action" class="ca-empty__action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.ca-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--ca-space-16) var(--ca-space-8);
}

.ca-empty__icon {
  display: inline-flex;
  color: var(--ca-fg-4);
  margin-bottom: var(--ca-space-4);
}

.ca-empty__icon svg {
  width: 40px;
  height: 40px;
}

.ca-empty__title {
  font-size: var(--ca-text-400);
  line-height: var(--ca-line-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-2);
}

.ca-empty__description {
  margin-top: var(--ca-space-2);
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  color: var(--ca-fg-3);
  max-width: 380px;
}

.ca-empty__action {
  margin-top: var(--ca-space-8);
}
</style>
