<script setup lang="ts">
import { useId } from 'vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    error?: string;
    required?: boolean;
  }>(),
  { required: false },
);

const fieldId = useId();
defineSlots<{ default?: (props: { id: string; describedBy: string | undefined }) => unknown }>();

const describedBy = `${fieldId}-desc`;
</script>

<template>
  <div class="ca-field" :class="{ 'ca-field--invalid': !!props.error }">
    <label v-if="label" class="ca-field__label" :for="fieldId">
      {{ label }}
      <span v-if="required" class="ca-field__required" aria-hidden="true">*</span>
      <span v-if="required" class="ca-visually-hidden">(wajib)</span>
    </label>
    <slot :id="fieldId" :described-by="describedBy" />
    <p v-if="props.error" :id="describedBy" class="ca-field__error" role="alert">
      {{ props.error }}
    </p>
    <p v-else-if="hint" :id="describedBy" class="ca-field__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.ca-field {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
}

.ca-field__label {
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.ca-field__required {
  color: var(--ca-danger-fg);
  margin-left: 2px;
}

.ca-field__hint {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.ca-field__error {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-danger-fg);
}
</style>
