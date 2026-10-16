<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    size?: 'small' | 'medium';
    variant?: 'subtle' | 'outline';
    disabled?: boolean;
  }>(),
  { size: 'medium', variant: 'subtle' },
);
</script>

<template>
  <button
    type="button"
    class="ca-icon-button"
    :class="[`ca-icon-button--${size}`, `ca-icon-button--${variant}`]"
    :aria-label="label"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.ca-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--ca-radius-md);
  background: transparent;
  color: var(--ca-fg-2);
  cursor: pointer;
  transition:
    background-color var(--ca-duration-faster) var(--ca-curve-easy-ease),
    color var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.ca-icon-button--small {
  width: 24px;
  height: 24px;
  font-size: 14px;
}

.ca-icon-button--medium {
  width: 32px;
  height: 32px;
  font-size: 16px;
}

.ca-icon-button--subtle:hover:not(:disabled) {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}

.ca-icon-button--subtle:active:not(:disabled) {
  background: var(--ca-bg-surface-pressed);
}

.ca-icon-button--outline {
  border-color: var(--ca-stroke-1);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
}

.ca-icon-button--outline:hover:not(:disabled) {
  background: var(--ca-bg-surface-hover);
  border-color: var(--ca-stroke-1-hover);
}

.ca-icon-button:disabled {
  color: var(--ca-fg-disabled);
  cursor: not-allowed;
}
</style>
