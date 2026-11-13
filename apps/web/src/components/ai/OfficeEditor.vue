<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CaSpinner } from '@/components/ui';
import { fetchEditorConfig, type OfficeSourceKind } from '@/api/documents';
import { loadDocsApi, type DocEditorInstance } from '@/utils/onlyoffice-loader';

/**
 * Penyunting WYSIWYG OnlyOffice untuk Word/Excel/PowerPoint.
 * Konfigurasi (URL berkas, callback simpan, JWT) seluruhnya dibuat server; browser hanya meneruskannya.
 */
const props = defineProps<{ kind: OfficeSourceKind; id: string }>();
const emit = defineEmits<{
  /** OnlyOffice belum diaktifkan/tidak terjangkau: induk menampilkan pratinjau biasa. */
  unavailable: [reason: string];
  /** Perubahan sudah dikirim ke Document Server (status bersih setelah kotor). */
  saved: [];
  ready: [];
}>();

const { t } = useI18n();
const loading = ref(true);
const dirty = ref(false);
const holderId = `oo-editor-${Math.random().toString(36).slice(2, 10)}`;
let editor: DocEditorInstance | null = null;
let disposed = false;

onMounted(async () => {
  try {
    const result = await fetchEditorConfig(props.kind, props.id);
    if (disposed) return;
    if (!result.enabled || !result.documentServerUrl || !result.config) {
      emit('unavailable', 'disabled');
      return;
    }
    const api = await loadDocsApi(result.documentServerUrl);
    if (disposed) return;
    editor = new api.DocEditor(holderId, {
      ...result.config,
      width: '100%',
      height: '100%',
      type: 'desktop',
      events: {
        onAppReady: () => {
          loading.value = false;
          emit('ready');
        },
        onDocumentStateChange: (event: { data: boolean }) => {
          if (dirty.value && !event.data) emit('saved');
          dirty.value = event.data;
        },
        onError: (event: { data?: { errorDescription?: string } }) => {
          loading.value = false;
          console.warn('OnlyOffice:', event.data?.errorDescription);
        },
      },
    });
  } catch (error) {
    if (!disposed) emit('unavailable', error instanceof Error ? error.message : 'error');
  }
});

onBeforeUnmount(() => {
  disposed = true;
  try {
    editor?.destroyEditor();
  } catch {
    /* editor sudah dilepas */
  }
  editor = null;
});

defineExpose({ dirty });
</script>

<template>
  <div class="office" :aria-busy="loading">
    <div v-if="loading" class="office__loading">
      <CaSpinner />
      <span>{{ t('workspace.documents.viewer.editorLoading') }}</span>
    </div>
    <div class="office__frame">
      <div :id="holderId" />
    </div>
  </div>
</template>

<style scoped>
.office {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.office__frame {
  flex: 1;
  min-height: 0;
}

.office__frame :deep(iframe) {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
}

.office__loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ca-space-2);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
  z-index: 1;
}
</style>
