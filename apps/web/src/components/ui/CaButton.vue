<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CaSpinner from './CaSpinner.vue';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'outline' | 'subtle' | 'transparent' | 'danger';
    size?: 'small' | 'medium' | 'large';
    type?: 'button' | 'submit' | 'reset';
    to?: string;
    disabled?: boolean;
    loading?: boolean;
    block?: boolean;
  }>(),
  { variant: 'secondary', size: 'medium', type: 'button' },
);

defineSlots<{
  default?: () => unknown;
  'icon-start'?: () => unknown;
  'icon-end'?: () => unknown;
}>();

const isInert = computed(() => props.disabled || props.loading);

const classes = computed(() => [
  'ca-button',
  `ca-button--${props.variant}`,
  `ca-button--${props.size}`,
  { 'ca-button--block': props.block, 'ca-button--loading': props.loading },
]);

const spinnerSize = computed(() => (props.size === 'large' ? 'small' : 'tiny'));
</script>

<template>
  <component
    :is="to ? RouterLink : 'button'"
    :to="to"
    :type="to ? undefined : type"
    :disabled="to ? undefined : isInert || undefined"
    :aria-disabled="to && isInert ? 'true' : undefined"
    :aria-busy="loading ? 'true' : undefined"
    :class="classes"
    :tabindex="to && isInert ? -1 : undefined"
  >
    <span v-if="loading" class="ca-button__spinner">
      <CaSpinner :size="spinnerSize" />
    </span>
    <span v-else-if="$slots['icon-start']" class="ca-button__icon">
      <slot name="icon-start" />
    </span>
    <span class="ca-button__label"><slot /></span>
    <span v-if="$slots['icon-end']" class="ca-button__icon">
      <slot name="icon-end" />
    </span>
  </component>
</template>

<style scoped>
.ca-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ca-space-2);
  border: 1px solid transparent;
  border-radius: var(--ca-radius-md);
  font-family: var(--ca-font-family);
  font-weight: var(--ca-font-weight-semibold);
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
  transition:
    background-color var(--ca-duration-faster) var(--ca-curve-easy-ease),
    border-color var(--ca-duration-faster) var(--ca-curve-easy-ease),
    color var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.ca-button:hover {
  text-decoration: none;
}

.ca-button--small {
  height: 24px;
  padding: 0 var(--ca-space-3);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}

.ca-button--medium {
  height: 32px;
  padding: 0 var(--ca-space-6);
}

.ca-button--large {
  height: 40px;
  padding: 0 var(--ca-space-8);
  font-size: var(--ca-text-400);
  line-height: var(--ca-line-400);
}

.ca-button--block {
  width: 100%;
}

.ca-button--primary {
  background: var(--ca-color-brand);
  color: var(--ca-fg-on-brand);
  border-color: transparent;
}

.ca-button--primary:hover:not(:disabled):not([aria-disabled='true']) {
  background: var(--ca-color-brand-hover);
}

.ca-button--primary:active:not(:disabled):not([aria-disabled='true']) {
  background: var(--ca-color-brand-pressed);
}

.ca-button--secondary {
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  border-color: var(--ca-stroke-1);
}

.ca-button--secondary:hover:not(:disabled):not([aria-disabled='true']) {
  background: var(--ca-bg-surface-hover);
  border-color: var(--ca-stroke-1-hover);
}

.ca-button--secondary:active:not(:disabled):not([aria-disabled='true']) {
  background: var(--ca-bg-surface-pressed);
}

.ca-button--outline {
  background: transparent;
  color: var(--ca-fg-1);
  border-color: var(--ca-stroke-1);
}

.ca-button--outline:hover:not(:disabled):not([aria-disabled='true']) {
  background: var(--ca-bg-surface-hover);
}

.ca-button--outline:active:not(:disabled):not([aria-disabled='true']) {
  background: var(--ca-bg-surface-pressed);
}

.ca-button--subtle {
  background: transparent;
  color: var(--ca-fg-2);
  border-color: transparent;
}

.ca-button--subtle:hover:not(:disabled):not([aria-disabled='true']) {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}

.ca-button--transparent {
  background: transparent;
  color: var(--ca-color-link);
  border-color: transparent;
}

.ca-button--transparent:hover:not(:disabled):not([aria-disabled='true']) {
  color: var(--ca-color-link-hover);
  text-decoration: underline;
}

.ca-button--danger {
  background: var(--ca-danger-stroke);
  color: #ffffff;
  border-color: transparent;
}

.ca-button--danger:hover:not(:disabled):not([aria-disabled='true']) {
  background: var(--ca-danger-hover);
}

.ca-button--danger:active:not(:disabled):not([aria-disabled='true']) {
  background: var(--ca-danger-pressed);
}

.ca-button:disabled,
.ca-button[aria-disabled='true'] {
  cursor: not-allowed;
}

.ca-button--secondary:disabled,
.ca-button--outline:disabled,
.ca-button--subtle:disabled,
.ca-button--transparent:disabled,
.ca-button--secondary[aria-disabled='true'],
.ca-button--outline[aria-disabled='true'],
.ca-button--subtle[aria-disabled='true'],
.ca-button--transparent[aria-disabled='true'] {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-disabled);
  border-color: var(--ca-stroke-3);
}

.ca-button--primary:disabled,
.ca-button--danger:disabled,
.ca-button--primary[aria-disabled='true'],
.ca-button--danger[aria-disabled='true'] {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-disabled);
}

.ca-button__icon {
  display: inline-flex;
  align-items: center;
  font-size: 1.15em;
}

.ca-button__spinner {
  display: inline-flex;
  margin-left: calc(var(--ca-space-2) * -1);
  margin-right: var(--ca-space-1);
}

.ca-button--loading .ca-button__label {
  opacity: 0.75;
}
</style>
