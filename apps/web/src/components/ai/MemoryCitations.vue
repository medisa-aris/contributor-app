<script setup lang="ts">
import type { MemoryRefDto } from '@bara/shared';
import { useI18n } from 'vue-i18n';
import { CaIcon } from '@/components/ui';

/** Daftar catatan memori yang dipakai sebuah jawaban atau hasil tugas (dapat dilipat). */
defineProps<{ refs: MemoryRefDto[] }>();

const { t } = useI18n();
</script>

<template>
  <details v-if="refs.length > 0" class="mem-cite">
    <summary class="mem-cite__summary">
      <CaIcon name="book" :size="12" />
      <span>{{ t('memory.citations.title', { n: refs.length }) }}</span>
    </summary>
    <ul class="mem-cite__list">
      <li v-for="note in refs" :key="note.entryId">
        <span class="mem-cite__owner">
          {{ note.own ? t('memory.citations.own') : t('memory.citations.from', { name: note.subjectName }) }}
          · {{ t(`memory.types.${note.type}`) }}
        </span>
        {{ note.content }}
      </li>
    </ul>
  </details>
</template>

<style scoped>
.mem-cite__summary {
  display: flex;
  align-items: center;
  gap: var(--ca-space-1);
  margin: var(--ca-space-3) 0 0;
  font-size: var(--ca-text-100);
  color: var(--ca-fg-2);
  cursor: pointer;
  list-style: none;
}

.mem-cite__summary::-webkit-details-marker {
  display: none;
}

.mem-cite__list {
  margin: var(--ca-space-2) 0 0;
  padding: var(--ca-space-3) var(--ca-space-4) var(--ca-space-3) var(--ca-space-8);
  border-left: 2px solid var(--ca-color-brand);
  background: var(--ca-bg-surface-2);
  border-radius: 0 var(--ca-radius-medium, 4px) var(--ca-radius-medium, 4px) 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.mem-cite__owner {
  display: block;
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}
</style>
