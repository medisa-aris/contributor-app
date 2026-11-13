<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CaIcon, CaSpinner } from '@/components/ui';
import { formatLabel } from '@/api/documents';
import { deleteTemplate, listTemplates, type DocumentTemplate } from '@/api/office-styles';

/** Pemilih templat gaya di composer: menyisipkan petunjuk template_id ke draf pesan. */
defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ pick: [template: DocumentTemplate] }>();

const { t } = useI18n();
const open = ref(false);
const loading = ref(false);
const templates = ref<DocumentTemplate[]>([]);
const root = ref<HTMLElement | null>(null);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    templates.value = await listTemplates();
  } catch {
    templates.value = [];
  } finally {
    loading.value = false;
  }
}

function choose(template: DocumentTemplate): void {
  emit('pick', template);
  open.value = false;
}

async function remove(template: DocumentTemplate): Promise<void> {
  await deleteTemplate(template.id).catch(() => undefined);
  templates.value = templates.value.filter((x) => x.id !== template.id);
}

function onPointerDown(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false;
}

watch(open, (isOpen) => {
  if (isOpen) {
    void refresh();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeydown);
  } else {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeydown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <span ref="root" class="tpl">
    <button
      type="button"
      class="tpl__trigger"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open = !open"
    >
      <CaIcon name="star" :size="13" />
      <span>{{ t('workspace.documents.styles.templates') }}</span>
    </button>
    <div v-if="open" class="tpl__popup" role="menu">
      <CaSpinner v-if="loading" class="tpl__state" />
      <p v-else-if="templates.length === 0" class="tpl__empty">
        {{ t('workspace.documents.styles.noTemplates') }}
      </p>
      <ul v-else class="tpl__list">
        <li v-for="tpl in templates" :key="tpl.id" class="tpl__item">
          <button
            type="button"
            role="menuitem"
            class="tpl__choose"
            :title="tpl.summary"
            @click="choose(tpl)"
          >
            <span class="tpl__name">{{ tpl.name }}</span>
            <span class="tpl__meta">{{ formatLabel(tpl.format) }}</span>
          </button>
          <button
            type="button"
            class="tpl__delete"
            :aria-label="t('common.delete')"
            :title="t('common.delete')"
            @click="remove(tpl)"
          >
            <CaIcon name="trash" :size="12" />
          </button>
        </li>
      </ul>
    </div>
  </span>
</template>

<style scoped>
.tpl {
  position: relative;
  display: inline-flex;
}

.tpl__trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--ca-stroke-2);
  border-radius: 999px;
  background: var(--ca-bg-surface);
  padding: 3px 10px;
  font: inherit;
  font-size: var(--ca-text-100);
  color: var(--ca-fg-2, var(--ca-fg-1));
  cursor: pointer;
}

.tpl__trigger:hover:not(:disabled) {
  background: var(--ca-bg-surface-3);
}

.tpl__trigger:disabled {
  opacity: 0.5;
  cursor: default;
}

.tpl__popup {
  position: absolute;
  bottom: calc(100% + var(--ca-space-1));
  left: 0;
  z-index: var(--ca-z-dropdown, 30);
  width: min(320px, 80vw);
  max-height: 280px;
  overflow: auto;
  padding: var(--ca-space-1);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  box-shadow: var(--ca-shadow-16);
}

.tpl__state {
  margin: var(--ca-space-3) auto;
}

.tpl__empty {
  margin: 0;
  padding: var(--ca-space-2) var(--ca-space-3);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.tpl__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tpl__item {
  display: flex;
  align-items: center;
}

.tpl__choose {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-2);
  border: none;
  border-radius: var(--ca-radius-sm);
  background: none;
  padding: 6px 8px;
  font: inherit;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
  text-align: left;
  cursor: pointer;
}

.tpl__choose:hover,
.tpl__delete:hover {
  background: var(--ca-bg-surface-3);
}

.tpl__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tpl__meta {
  flex: none;
  color: var(--ca-fg-3);
}

.tpl__delete {
  border: none;
  border-radius: var(--ca-radius-sm);
  background: none;
  padding: 6px;
  color: var(--ca-fg-3);
  cursor: pointer;
}
</style>
