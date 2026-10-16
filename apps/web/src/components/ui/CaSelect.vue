<script setup lang="ts">
import { useId } from 'vue';

export interface CaSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    options: CaSelectOption[];
    placeholder?: string;
    size?: 'medium' | 'large';
    disabled?: boolean;
    invalid?: boolean;
    describedBy?: string;
  }>(),
  { size: 'medium' },
);

const model = defineModel<string>({ default: '' });
const selectId = useId();
</script>

<template>
  <span class="ca-select" :class="`ca-select--${props.size}`">
    <select
      :id="selectId"
      v-model="model"
      :disabled="disabled"
      :aria-invalid="invalid ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="ca-select__control"
      :class="{ 'ca-select__control--invalid': invalid, 'ca-select__control--placeholder': model === '' }"
    >
      <option v-if="props.placeholder" value="" disabled>{{ props.placeholder }}</option>
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>
    <svg class="ca-select__chevron" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        d="M15.85 7.65c.2.2.2.5 0 .7l-5.5 5.5a.5.5 0 0 1-.7 0l-5.5-5.5a.5.5 0 0 1 .7-.7L10 12.79l5.15-5.14c.2-.2.5-.2.7 0Z"
      />
    </svg>
  </span>
</template>

<style scoped>
.ca-select {
  position: relative;
  display: inline-flex;
  width: 100%;
}

.ca-select__control {
  appearance: none;
  width: 100%;
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  padding: 0 var(--ca-space-16) 0 var(--ca-space-5);
  outline: none;
  cursor: pointer;
  transition:
    border-color var(--ca-duration-fast) var(--ca-curve-easy-ease),
    box-shadow var(--ca-duration-fast) var(--ca-curve-easy-ease);
}

.ca-select--medium .ca-select__control {
  height: 32px;
  font-size: var(--ca-text-300);
}

.ca-select--large .ca-select__control {
  height: 40px;
  font-size: var(--ca-text-400);
}

.ca-select__control:hover:not(:disabled):not(:focus) {
  border-color: var(--ca-stroke-1-hover);
}

.ca-select__control:focus {
  border-color: var(--ca-stroke-accessible);
  box-shadow: inset 0 -2px 0 0 var(--ca-color-brand);
}

.ca-select__control--invalid {
  border-color: var(--ca-danger-stroke);
  box-shadow: inset 0 -2px 0 0 var(--ca-danger-stroke);
}

.ca-select__control--placeholder {
  color: var(--ca-fg-4);
}

.ca-select__control:disabled {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-disabled);
  cursor: not-allowed;
}

.ca-select__chevron {
  position: absolute;
  right: var(--ca-space-4);
  top: 50%;
  width: 20px;
  height: 20px;
  transform: translateY(-50%);
  color: var(--ca-fg-2);
  pointer-events: none;
}
</style>
