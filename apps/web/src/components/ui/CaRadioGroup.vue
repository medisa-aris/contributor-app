<script setup lang="ts">
import { useId } from 'vue';

export interface CaRadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

defineProps<{
  options: CaRadioOption[];
  disabled?: boolean;
}>();

const model = defineModel<string>({ default: '' });
const name = useId();
</script>

<template>
  <div class="ca-radio-group" role="radiogroup">
    <label
      v-for="option in options"
      :key="option.value"
      class="ca-radio"
      :class="{ 'ca-radio--disabled': disabled || option.disabled }"
    >
      <input
        v-model="model"
        type="radio"
        :name="name"
        :value="option.value"
        :disabled="disabled || option.disabled"
        class="ca-radio__input"
      />
      <span class="ca-radio__dot" aria-hidden="true"><span class="ca-radio__dot-inner" /></span>
      <span class="ca-radio__content">
        <span class="ca-radio__label">{{ option.label }}</span>
        <span v-if="option.description" class="ca-radio__description">
          {{ option.description }}
        </span>
      </span>
    </label>
  </div>
</template>

<style scoped>
.ca-radio-group {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
}

.ca-radio {
  display: flex;
  align-items: flex-start;
  gap: var(--ca-space-6);
  cursor: pointer;
  position: relative;
}

.ca-radio--disabled {
  cursor: not-allowed;
  color: var(--ca-fg-disabled);
}

.ca-radio__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.ca-radio__dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  flex: none;
  border: 1px solid var(--ca-stroke-accessible);
  border-radius: var(--ca-radius-circular);
  background: var(--ca-bg-surface);
  transition: border-color var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.ca-radio__dot-inner {
  width: 8px;
  height: 8px;
  border-radius: var(--ca-radius-circular);
  background: transparent;
  transform: scale(0.5);
  transition:
    transform var(--ca-duration-fast) var(--ca-curve-decelerate-mid),
    background-color var(--ca-duration-faster) var(--ca-curve-easy-ease);
}

.ca-radio__input:checked + .ca-radio__dot {
  border-color: var(--ca-color-brand);
}

.ca-radio__input:checked + .ca-radio__dot .ca-radio__dot-inner {
  background: var(--ca-color-brand);
  transform: scale(1);
}

.ca-radio:hover .ca-radio__input:not(:disabled) + .ca-radio__dot {
  border-color: var(--ca-fg-1);
}

.ca-radio__input:focus-visible + .ca-radio__dot {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}

.ca-radio__input:disabled + .ca-radio__dot {
  background: var(--ca-bg-surface-3);
  border-color: var(--ca-stroke-1);
}

.ca-radio__content {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ca-radio__label {
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
}

.ca-radio__description {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}
</style>
