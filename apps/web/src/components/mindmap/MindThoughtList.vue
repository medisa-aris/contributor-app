<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { MindMapThought } from '@/api/mindmap/types';
import { MODE_COLORS } from './mode-colors';

defineProps<{ thoughts: MindMapThought[] }>();

const { t } = useI18n();

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}
</script>

<template>
  <ul class="thoughts">
    <li v-for="item in thoughts" :key="item.id" class="thoughts__item">
      <span class="thoughts__dot" :style="{ background: MODE_COLORS[item.mode] }" aria-hidden="true" />
      <div class="thoughts__body">
        <span class="thoughts__title">{{ item.title }}</span>
        <span class="thoughts__meta">
          {{ t(`workspace.mindMap.modes.${item.mode}`) }} · {{ formatDate(item.at) }}
        </span>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.thoughts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}
.thoughts__item {
  display: flex;
  gap: var(--ca-space-3);
  align-items: flex-start;
  padding: var(--ca-space-2) var(--ca-space-3);
  background: var(--ca-bg-surface-2);
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
}
.thoughts__dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.thoughts__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.thoughts__title {
  color: var(--ca-fg-1);
  overflow-wrap: anywhere;
}
.thoughts__meta {
  color: var(--ca-fg-3);
  font-size: 12px;
}
</style>
