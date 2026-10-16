<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    padded?: boolean;
    elevated?: boolean;
  }>(),
  { padded: true },
);
</script>

<template>
  <section class="ca-card" :class="{ 'ca-card--elevated': elevated }">
    <header v-if="title || subtitle || $slots.header" class="ca-card__header">
      <slot name="header">
        <h3 v-if="title" class="ca-card__title">{{ title }}</h3>
        <p v-if="subtitle" class="ca-card__subtitle">{{ subtitle }}</p>
      </slot>
    </header>
    <div class="ca-card__body" :class="{ 'ca-card__body--padded': padded }">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="ca-card__footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
.ca-card {
  display: flex;
  flex-direction: column;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  overflow: hidden;
}

.ca-card--elevated {
  border-color: transparent;
  box-shadow: var(--ca-shadow-4);
}

.ca-card__header {
  padding: var(--ca-space-6) var(--ca-space-8) 0;
}

.ca-card__title {
  font-size: var(--ca-text-400);
  line-height: var(--ca-line-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.ca-card__subtitle {
  margin-top: var(--ca-space-1);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.ca-card__body {
  flex: 1;
}

.ca-card__body--padded {
  padding: var(--ca-space-8);
}

.ca-card__footer {
  border-top: 1px solid var(--ca-stroke-3);
  padding: var(--ca-space-6) var(--ca-space-8);
}
</style>
