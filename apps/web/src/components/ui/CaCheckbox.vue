<script setup lang="ts">
import { useId } from 'vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    disabled?: boolean;
    indeterminate?: boolean;
  }>(),
  { indeterminate: false },
);

const model = defineModel<boolean>({ default: false });
const inputId = useId();
defineSlots<{ default?: () => unknown }>();
</script>

<template>
  <label class="ca-checkbox" :class="{ 'ca-checkbox--disabled': props.disabled }">
    <input
      :id="inputId"
      v-model="model"
      type="checkbox"
      class="ca-checkbox__input"
      :disabled="disabled"
      :indeterminate="indeterminate"
    />
    <span class="ca-checkbox__box" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path
          v-if="indeterminate"
          d="M4 8h8"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
        <path
          v-else
          d="M3.5 8.5 6.4 11.4 12.5 5.3"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
    <span v-if="label || $slots.default" class="ca-checkbox__label">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
.ca-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-6);
  cursor: pointer;
  position: relative;
}

.ca-checkbox--disabled {
  cursor: not-allowed;
  color: var(--ca-fg-disabled);
}

.ca-checkbox__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.ca-checkbox__box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  border: 1px solid var(--ca-stroke-accessible);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-on-brand);
  transition:
    background-color var(--ca-duration-faster) var(--ca-curve-easy-ease),
    border-color var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.ca-checkbox__box svg {
  width: 12px;
  height: 12px;
  visibility: hidden;
}

.ca-checkbox__input:checked + .ca-checkbox__box,
.ca-checkbox__input:indeterminate + .ca-checkbox__box {
  background: var(--ca-color-brand);
  border-color: var(--ca-color-brand);
}

.ca-checkbox__input:checked + .ca-checkbox__box svg,
.ca-checkbox__input:indeterminate + .ca-checkbox__box svg {
  visibility: visible;
}

.ca-checkbox:hover .ca-checkbox__input:not(:disabled) + .ca-checkbox__box {
  border-color: var(--ca-fg-1);
}

.ca-checkbox__input:focus-visible + .ca-checkbox__box {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}

.ca-checkbox__input:disabled + .ca-checkbox__box {
  background: var(--ca-bg-surface-3);
  border-color: var(--ca-stroke-1);
  color: var(--ca-fg-disabled);
}

.ca-checkbox__label {
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
}
</style>
