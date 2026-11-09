<script setup lang="ts">
import { CaIcon } from '@/components/ui';
import { formatBytes, formatLabel, type UserDocument } from '@/api/documents';

defineProps<{
  doc: Pick<UserDocument, 'title' | 'format' | 'size_bytes'>;
  active?: boolean;
}>();

const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <button type="button" class="doc-card" :class="{ 'doc-card--active': active }" @click="emit('open')">
    <span class="doc-card__badge" :data-format="doc.format">
      <CaIcon name="file" :size="16" />
    </span>
    <span class="doc-card__text">
      <span class="doc-card__title">{{ doc.title }}</span>
      <span class="doc-card__meta">{{ formatLabel(doc.format) }} · {{ formatBytes(doc.size_bytes) }}</span>
    </span>
  </button>
</template>

<style scoped>
.doc-card {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  width: 100%;
  max-width: 360px;
  padding: var(--ca-space-3) var(--ca-space-4);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-bg-surface-2, var(--ca-bg-surface));
  color: var(--ca-fg-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.doc-card:hover,
.doc-card--active {
  border-color: var(--ca-color-brand, var(--ca-stroke-focus));
}

.doc-card:focus-visible {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}

.doc-card__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: var(--ca-radius-md);
  background: var(--ca-color-brand-subtle);
  color: var(--ca-fg-1);
}

.doc-card__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.doc-card__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ca-text-300);
  font-weight: 600;
}

.doc-card__meta {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}
</style>
