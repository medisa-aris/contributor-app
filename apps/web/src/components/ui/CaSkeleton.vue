<script setup lang="ts">
withDefaults(
  defineProps<{
    shape?: 'text' | 'rect' | 'circle';
    width?: string;
    height?: string;
    lines?: number;
  }>(),
  { shape: 'text', lines: 1 },
);
</script>

<template>
  <span v-if="shape === 'text' && lines > 1" class="ca-skeleton-group" aria-hidden="true">
    <span
      v-for="line in lines"
      :key="line"
      class="ca-skeleton ca-skeleton--text"
      :style="{ width: line === lines && lines > 1 ? '65%' : width || '100%' }"
    />
  </span>
  <span
    v-else
    class="ca-skeleton"
    :class="`ca-skeleton--${shape}`"
    :style="{ width, height, '--ca-skeleton-lines': lines > 1 ? lines : undefined }"
    aria-hidden="true"
  />
</template>

<style scoped>
.ca-skeleton-group {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  width: 100%;
}

.ca-skeleton {
  display: block;
  background: linear-gradient(
    90deg,
    var(--ca-bg-skeleton) 25%,
    var(--ca-bg-skeleton-shine) 50%,
    var(--ca-bg-skeleton) 75%
  );
  background-size: 200% 100%;
  animation: ca-skeleton-shimmer 1.6s ease-in-out infinite;
}

.ca-skeleton--text {
  height: 12px;
  border-radius: var(--ca-radius-sm);
}

.ca-skeleton--rect {
  height: 32px;
  border-radius: var(--ca-radius-md);
}

.ca-skeleton--circle {
  width: 32px;
  height: 32px;
  border-radius: var(--ca-radius-circular);
}

@keyframes ca-skeleton-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ca-skeleton {
    animation: none;
  }
}
</style>
