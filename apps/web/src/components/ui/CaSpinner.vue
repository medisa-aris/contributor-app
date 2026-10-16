<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    size?: 'tiny' | 'small' | 'medium' | 'large';
    label?: string;
  }>(),
  { size: 'small' },
);

const { t } = useI18n();

const DIMENSIONS = { tiny: 16, small: 20, medium: 24, large: 32 } as const;

const ariaLabel = computed(() => props.label ?? t('common.loading'));
const style = computed(() => ({ '--ca-spinner-size': `${DIMENSIONS[props.size]}px` }));
</script>

<template>
  <span class="ca-spinner" role="progressbar" :aria-label="ariaLabel" :style="style">
    <svg class="ca-spinner__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle class="ca-spinner__track" cx="12" cy="12" r="9" stroke-width="3" />
      <path class="ca-spinner__arc" d="M21 12a9 9 0 0 0-9-9" stroke-width="3" stroke-linecap="round" />
    </svg>
    <span v-if="label" class="ca-spinner__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.ca-spinner {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-2);
}

.ca-spinner__icon {
  width: var(--ca-spinner-size);
  height: var(--ca-spinner-size);
  animation: ca-spin 1.2s linear infinite;
  flex: none;
}

.ca-spinner__track {
  stroke: var(--ca-stroke-1);
  opacity: 0.4;
}

.ca-spinner__arc {
  stroke: var(--ca-color-brand);
}

.ca-spinner__label {
  font-size: var(--ca-text-300);
  color: var(--ca-fg-2);
}

@keyframes ca-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ca-spinner__icon {
    animation-duration: 3s;
  }
}
</style>
