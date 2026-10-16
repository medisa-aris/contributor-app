<script setup lang="ts">
const model = defineModel<string>({ default: '' });

withDefaults(
  defineProps<{
    type?: 'text' | 'email' | 'password' | 'search' | 'url';
    size?: 'medium' | 'large';
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
    autocomplete?: string;
  }>(),
  { type: 'text', size: 'medium' },
);
</script>

<template>
  <input
    v-model="model"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :autocomplete="autocomplete"
    :aria-invalid="invalid ? 'true' : undefined"
    class="ca-input"
    :class="[`ca-input--${size}`, { 'ca-input--invalid': invalid }]"
  />
</template>

<style scoped>
.ca-input {
  width: 100%;
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  padding: 0 var(--ca-space-5);
  outline: none;
  transition:
    border-color var(--ca-duration-fast) var(--ca-curve-easy-ease),
    box-shadow var(--ca-duration-fast) var(--ca-curve-easy-ease);
}

.ca-input--medium {
  height: 32px;
  font-size: var(--ca-text-300);
}

.ca-input--large {
  height: 40px;
  font-size: var(--ca-text-400);
}

.ca-input::placeholder {
  color: var(--ca-fg-4);
}

.ca-input:hover:not(:disabled):not(:focus) {
  border-color: var(--ca-stroke-1-hover);
}

.ca-input:focus {
  border-color: var(--ca-stroke-accessible);
  box-shadow: inset 0 -2px 0 0 var(--ca-color-brand);
}

.ca-input--invalid {
  border-color: var(--ca-danger-stroke);
  box-shadow: inset 0 -2px 0 0 var(--ca-danger-stroke);
}

.ca-input--invalid:focus {
  box-shadow: inset 0 -2px 0 0 var(--ca-danger-stroke);
}

.ca-input:disabled {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-disabled);
  cursor: not-allowed;
}

.ca-input:disabled::placeholder {
  color: var(--ca-fg-disabled);
}
</style>
