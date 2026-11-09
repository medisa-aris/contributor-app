<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CaIcon, CaSpinner } from '@/components/ui';
import {
  documentPreview,
  downloadUserDocument,
  fetchDocumentBlob,
  formatLabel,
  type DocumentPreview,
  type UserDocument,
} from '@/api/documents';
import { writeClipboard } from '@/utils/clipboard';
import MarkdownContent from './MarkdownContent.vue';

const props = defineProps<{ doc: UserDocument }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const preview = ref<DocumentPreview | null>(null);
const loading = ref(false);
const error = ref('');
const pdfUrl = ref<string | null>(null);
const sheetIndex = ref(0);
const copied = ref(false);
const downloading = ref(false);
let loadToken = 0;
let copiedTimer: number | undefined;

const format = computed(() => props.doc.format);
const sheet = computed(() => preview.value?.sheets?.[sheetIndex.value] ?? null);
/** JSON/CSV/teks ditampilkan sebagai blok kode agar spasi terjaga. */
const codeMarkdown = computed(() => {
  const text = preview.value?.text ?? '';
  const lang = format.value === 'json' ? 'json' : '';
  const fence = text.includes('```') ? '~~~~' : '```';
  return `${fence}${lang}\n${text}\n${fence}`;
});

function revokePdf(): void {
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
  pdfUrl.value = null;
}

async function load(): Promise<void> {
  const token = (loadToken += 1);
  loading.value = true;
  error.value = '';
  preview.value = null;
  sheetIndex.value = 0;
  revokePdf();
  try {
    if (props.doc.format === 'pdf') {
      const blob = await fetchDocumentBlob(props.doc.id, true);
      if (token !== loadToken) return;
      pdfUrl.value = URL.createObjectURL(blob);
    } else {
      const result = await documentPreview(props.doc.id);
      if (token !== loadToken) return;
      preview.value = result;
    }
  } catch {
    if (token === loadToken) error.value = t('workspace.documents.viewer.loadFailed');
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

async function download(): Promise<void> {
  downloading.value = true;
  try {
    await downloadUserDocument(props.doc);
  } catch {
    error.value = t('workspace.documents.viewer.downloadFailed');
  } finally {
    downloading.value = false;
  }
}

async function copy(): Promise<void> {
  if (!preview.value?.text || !(await writeClipboard(preview.value.text))) return;
  copied.value = true;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1600);
}

watch(() => props.doc.id, load, { immediate: true });
onBeforeUnmount(() => {
  loadToken += 1;
  revokePdf();
  window.clearTimeout(copiedTimer);
});
</script>

<template>
  <aside class="viewer" :aria-label="t('workspace.documents.viewer.title')">
    <header class="viewer__head">
      <div class="viewer__heading">
        <h2 class="viewer__title" :title="doc.title">{{ doc.title }}</h2>
        <p class="viewer__format">{{ formatLabel(doc.format) }}</p>
      </div>
      <div class="viewer__actions">
        <button
          v-if="preview?.text"
          type="button"
          class="viewer__btn"
          :title="t('workspace.chat.copy')"
          @click="copy"
        >
          <CaIcon name="copy" :size="14" />
          <span>{{ copied ? t('workspace.chat.copied') : t('workspace.chat.copy') }}</span>
        </button>
        <button
          type="button"
          class="viewer__btn"
          :disabled="downloading"
          :title="t('workspace.documents.download')"
          @click="download"
        >
          <CaIcon name="download" :size="14" />
          <span>{{ t('workspace.documents.download') }}</span>
        </button>
        <button
          type="button"
          class="viewer__btn viewer__btn--icon"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          @click="emit('close')"
        >
          <CaIcon name="close" :size="14" />
        </button>
      </div>
    </header>

    <div class="viewer__body">
      <CaSpinner v-if="loading" class="viewer__state" />
      <p v-else-if="error" class="viewer__error" role="alert">{{ error }}</p>

      <iframe
        v-else-if="format === 'pdf' && pdfUrl"
        class="viewer__frame"
        :src="pdfUrl"
        :title="doc.title"
      />

      <!-- HTML buatan model: sandbox tanpa allow-same-origin, jadi tidak dapat menyentuh sesi aplikasi. -->
      <iframe
        v-else-if="format === 'html' && preview"
        class="viewer__frame viewer__frame--html"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        :srcdoc="preview.text ?? ''"
        :title="doc.title"
      />

      <div v-else-if="(format === 'md' || format === 'docx') && preview" class="viewer__prose">
        <MarkdownContent :content="preview.text ?? ''" />
      </div>

      <div v-else-if="format === 'xlsx' && preview" class="viewer__sheets">
        <div v-if="(preview.sheets?.length ?? 0) > 1" class="viewer__tabs" role="tablist">
          <button
            v-for="(s, index) in preview.sheets"
            :key="s.name"
            type="button"
            role="tab"
            class="viewer__tab"
            :class="{ 'viewer__tab--on': index === sheetIndex }"
            :aria-selected="index === sheetIndex"
            @click="sheetIndex = index"
          >
            {{ s.name }}
          </button>
        </div>
        <div v-if="sheet" class="viewer__table-wrap">
          <table class="viewer__table">
            <tbody>
              <tr v-for="(row, r) in sheet.rows" :key="r">
                <component :is="r === 0 ? 'th' : 'td'" v-for="(cell, c) in row" :key="c">
                  {{ cell }}
                </component>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ol v-else-if="format === 'pptx' && preview" class="viewer__slides">
        <li v-for="(slide, index) in preview.slides" :key="index" class="viewer__slide">
          <p class="viewer__slide-no">{{ t('workspace.documents.viewer.slide', { n: index + 1 }) }}</p>
          <h3 class="viewer__slide-title">{{ slide.title }}</h3>
          <ul v-if="slide.bullets.length > 0">
            <li v-for="(bullet, b) in slide.bullets" :key="b">{{ bullet }}</li>
          </ul>
        </li>
      </ol>

      <div v-else-if="preview" class="viewer__prose">
        <MarkdownContent :content="codeMarkdown" />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.viewer {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface);
  overflow: hidden;
}

.viewer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-3);
  padding: var(--ca-space-3) var(--ca-space-4);
  border-bottom: 1px solid var(--ca-stroke-2);
}

.viewer__heading {
  min-width: 0;
}

.viewer__title {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ca-text-300);
  font-weight: 600;
  color: var(--ca-fg-1);
}

.viewer__format {
  margin: 0;
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.viewer__actions {
  display: flex;
  align-items: center;
  gap: var(--ca-space-1);
  flex: none;
}

.viewer__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: var(--ca-radius-sm);
  background: none;
  color: var(--ca-fg-2, var(--ca-fg-1));
  padding: 4px 8px;
  font: inherit;
  font-size: var(--ca-text-200);
  cursor: pointer;
}

.viewer__btn:hover:not(:disabled) {
  background: var(--ca-bg-surface-3);
}

.viewer__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.viewer__btn:focus-visible {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}

.viewer__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.viewer__state {
  margin: var(--ca-space-6) auto;
}

.viewer__error {
  margin: var(--ca-space-5);
  color: var(--ca-fg-danger, #b3261e);
}

.viewer__frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: none;
}

.viewer__frame--html {
  background: #fff;
}

.viewer__prose {
  padding: var(--ca-space-4) var(--ca-space-5);
}

.viewer__tabs {
  display: flex;
  gap: var(--ca-space-1);
  padding: var(--ca-space-2) var(--ca-space-3);
  border-bottom: 1px solid var(--ca-stroke-2);
  overflow-x: auto;
}

.viewer__tab {
  border: none;
  border-radius: var(--ca-radius-sm);
  background: none;
  padding: 4px 10px;
  font: inherit;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  cursor: pointer;
  white-space: nowrap;
}

.viewer__tab--on {
  background: var(--ca-color-brand-subtle);
  color: var(--ca-fg-1);
}

.viewer__table-wrap {
  overflow: auto;
  padding: var(--ca-space-3);
}

.viewer__table {
  border-collapse: collapse;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
}

.viewer__table th,
.viewer__table td {
  border: 1px solid var(--ca-stroke-2);
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
}

.viewer__table th {
  background: var(--ca-bg-surface-3);
  font-weight: 600;
}

.viewer__slides {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  margin: 0;
  padding: var(--ca-space-4);
  list-style: none;
}

.viewer__slide {
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  padding: var(--ca-space-4) var(--ca-space-5);
  color: var(--ca-fg-1);
}

.viewer__slide-no {
  margin: 0;
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.viewer__slide-title {
  margin: 2px 0 var(--ca-space-2);
  font-size: var(--ca-text-400, 1.1rem);
}

.viewer__slide ul {
  margin: 0;
  padding-left: 1.2em;
}
</style>
