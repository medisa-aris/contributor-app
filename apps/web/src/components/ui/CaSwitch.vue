<script setup lang="ts">
import { useId } from 'vue';

const props = defineProps<{
  label?: string;
  disabled?: boolean;
}>();

const model = defineModel<boolean>({ default: false });
const inputId = useId();
</script>

<template>
  <label class="ca-switch" :class="{ 'ca-switch--disabled': props.disabled }">
    <input
      :id="inputId"
      v-model="model"
      type="checkbox"
      role="switch"
      class="ca-switch__input"
      :disabled="disabled"
    />
    <span class="ca-switch__track" aria-hidden="true">
      <span class="ca-switch__thumb" />
    </span>
    <span v-if="label" class="ca-switch__label">{{ label }}</span>
  </label>
</template>

<style scoped>
.ca-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-6);
  cursor: pointer;
  position: relative;
}

.ca-switch--disabled {
  cursor: not-allowed;
  color: var(--ca-fg-disabled);
}

.ca-switch__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.ca-switch__track {
  position: relative;
  width: 40px;
  height: 20px;
  flex: none;
  border-radius: var(--ca-radius-circular);
  border: 1px solid var(--ca-stroke-accessible);
  background: var(--ca-bg-surface);
  transition:
    background-color var(--ca-duration-fast) var(--ca-curve-easy-ease),
    border-color var(--ca-duration-fast) var(--ca-curve-easy-ease);
}

.ca-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: var(--ca-radius-circular);
  background: var(--ca-fg-3);
  transition:
    transform var(--ca-duration-fast) var(--ca-curve-decelerate-mid),
    background-color var(--ca-duration-fast) var(--ca-curve-easy-ease);
}

.ca-switch__input:checked + .ca-switch__track {
  background: var(--ca-color-brand);
  border-color: var(--ca-color-brand);
}

.ca-switch__input:checked + .ca-switch__track .ca-switch__thumb {
  transform: translateX(20px);
  background: #ffffff;
}

.ca-switch__input:focus-visible + .ca-switch__track {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}

.ca-switch__input:disabled + .ca-switch__track {
  background: var(--ca-bg-surface-3);
  border-color: var(--ca-stroke-1);
}

.ca-switch__input:disabled + .ca-switch__track .ca-switch__thumb {
  background: var(--ca-fg-disabled);
}

.ca-switch__label {
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
}
</style>
