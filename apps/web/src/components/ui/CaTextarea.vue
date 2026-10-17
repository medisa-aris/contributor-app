<script setup lang="ts">
const model = defineModel<string>({ default: '' });

withDefaults(
  defineProps<{
    rows?: number;
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
  }>(),
  { rows: 4 },
);
</script>

<template>
  <textarea
    v-model="model"
    class="ca-textarea"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-invalid="invalid ? 'true' : undefined"
  />
</template>

<style scoped>
.ca-textarea {
  width: 100%;
  resize: vertical;
  min-height: var(--ca-space-20);
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  padding: var(--ca-space-3) var(--ca-space-5);
  font: inherit;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  outline: none;
  transition:
    border-color var(--ca-duration-fast) var(--ca-curve-easy-ease),
    box-shadow var(--ca-duration-fast) var(--ca-curve-easy-ease);
}

.ca-textarea::placeholder {
  color: var(--ca-fg-4);
}

.ca-textarea:hover:not(:disabled):not(:focus) {
  border-color: var(--ca-stroke-1-hover);
}

.ca-textarea:focus {
  border-color: var(--ca-stroke-accessible);
  box-shadow: inset 0 -2px 0 0 var(--ca-color-brand);
}

.ca-textarea[aria-invalid='true'] {
  border-color: var(--ca-danger-stroke);
  box-shadow: inset 0 -2px 0 0 var(--ca-danger-stroke);
}

.ca-textarea[aria-invalid='true']:focus {
  box-shadow: inset 0 -2px 0 0 var(--ca-danger-stroke);
}

.ca-textarea:disabled {
  background: var(--ca-bg-surface-3);
  color: var(--ca-fg-disabled);
  cursor: not-allowed;
}

.ca-textarea:disabled::placeholder {
  color: var(--ca-fg-disabled);
}
</style>
