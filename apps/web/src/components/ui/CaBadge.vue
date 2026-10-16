<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'brand' | 'danger' | 'success' | 'warning' | 'informative' | 'neutral';
    size?: 'small' | 'medium';
    strong?: boolean;
  }>(),
  { variant: 'neutral', size: 'medium' },
);
</script>

<template>
  <span
    class="ca-badge"
    :class="[`ca-badge--${variant}`, `ca-badge--${size}`, { 'ca-badge--strong': strong }]"
  >
    <slot name="icon" />
    <slot />
  </span>
</template>

<style scoped>
.ca-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-1);
  border-radius: var(--ca-radius-circular);
  font-weight: var(--ca-font-weight-semibold);
  white-space: nowrap;
}

.ca-badge--small {
  font-size: var(--ca-text-100);
  line-height: var(--ca-line-100);
  padding: 1px var(--ca-space-4);
}

.ca-badge--medium {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  padding: 1px var(--ca-space-6);
}

.ca-badge--brand {
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand);
  border: 1px solid var(--ca-color-brand);
}

.ca-badge--danger {
  background: var(--ca-danger-bg);
  color: var(--ca-danger-fg);
  border: 1px solid var(--ca-danger-stroke);
}

.ca-badge--success {
  background: var(--ca-success-bg);
  color: var(--ca-success-fg);
  border: 1px solid var(--ca-success-stroke);
}

.ca-badge--warning {
  background: var(--ca-warning-bg);
  color: var(--ca-warning-fg);
  border: 1px solid var(--ca-warning-stroke);
}

.ca-badge--informative {
  background: var(--ca-info-bg);
  color: var(--ca-info-fg);
  border: 1px solid var(--ca-info-stroke);
}

.ca-badge--neutral {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-2);
  border: 1px solid var(--ca-stroke-2);
}

.ca-badge--strong.ca-badge--brand {
  background: var(--ca-color-brand);
  color: var(--ca-fg-on-brand);
  border-color: transparent;
}

.ca-badge--strong.ca-badge--danger {
  background: var(--ca-danger-stroke);
  color: #ffffff;
  border-color: transparent;
}

.ca-badge--strong.ca-badge--success {
  background: var(--ca-success-stroke);
  color: #ffffff;
  border-color: transparent;
}

.ca-badge--strong.ca-badge--warning {
  background: var(--ca-warning-stroke);
  color: #ffffff;
  border-color: transparent;
}

.ca-badge--strong.ca-badge--informative {
  background: var(--ca-info-stroke);
  color: #ffffff;
  border-color: transparent;
}

.ca-badge--strong.ca-badge--neutral {
  background: var(--ca-fg-2);
  color: var(--ca-bg-surface);
  border-color: transparent;
}
</style>
