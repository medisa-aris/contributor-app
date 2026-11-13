<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CaButton, CaIcon, CaSpinner } from '@/components/ui';
import type { OfficeSourceKind } from '@/api/documents';
import {
  createTemplate,
  fetchStyleProfile,
  resolveColor,
  type OfficeStyleProfile,
  type ShapeInfo,
  type SlidePartInfo,
  type SmartArtNode,
} from '@/api/office-styles';
import { useToastStore } from '@/stores/toast.store';
import { writeClipboard } from '@/utils/clipboard';

/**
 * Inspektur gaya Office: tema, style Word, master/layout PowerPoint (digambar sebagai SVG),
 * SmartArt, header/footer. Setiap bagian dapat disalin sebagai JSON atau disimpan menjadi templat.
 */
const props = defineProps<{ kind: OfficeSourceKind; id: string; name: string }>();

const { t } = useI18n();
const toast = useToastStore();
const profile = ref<OfficeStyleProfile | null>(null);
const loading = ref(false);
const error = ref('');
const saving = ref(false);
const showAllStyles = ref(false);
let token = 0;

const theme = computed(() => profile.value?.theme ?? null);
const themeColors = computed(() =>
  Object.entries(theme.value?.colors ?? {}).map(([key, value]) => ({
    key,
    hex: resolveColor(value, null) ?? null,
  })),
);
const docxStyles = computed(() => {
  const styles = profile.value?.docx?.styles ?? [];
  const important = styles.filter(
    (s) =>
      (s.type === 'paragraph' || s.type === 'character') &&
      (s.isDefault ||
        /^(title|subtitle|heading [1-6]|normal|list (bullet|number|paragraph)|quote|intense quote|caption|strong|emphasis|hyperlink)$/i.test(
          s.name,
        )),
  );
  return showAllStyles.value ? styles : important;
});
const slideAspect = computed(() => {
  const size = profile.value?.pptx?.slideSize;
  return size ? size.heightEmu / size.widthEmu : 0.5625;
});
const headerFooters = computed(() => [
  ...(profile.value?.docx?.headers ?? []),
  ...(profile.value?.docx?.footers ?? []),
]);

async function load(): Promise<void> {
  const current = (token += 1);
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchStyleProfile(props.kind, props.id);
    if (current === token) profile.value = result;
  } catch {
    if (current === token) error.value = t('workspace.documents.styles.loadFailed');
  } finally {
    if (current === token) loading.value = false;
  }
}

watch(() => [props.kind, props.id], load, { immediate: true });

async function copy(value: unknown, label: string): Promise<void> {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (await writeClipboard(text)) {
    toast.push(
      { variant: 'success', title: t('workspace.documents.styles.copied', { label }) },
      2500,
    );
  }
}

async function saveTemplate(): Promise<void> {
  saving.value = true;
  try {
    const template = await createTemplate(props.kind, props.id, props.name);
    toast.push(
      {
        variant: 'success',
        title: t('workspace.documents.styles.templateSaved', { name: template.name }),
      },
      4000,
    );
  } catch {
    toast.push({ variant: 'danger', title: t('workspace.documents.styles.templateFailed') }, 5000);
  } finally {
    saving.value = false;
  }
}

function fillOf(shape: ShapeInfo): string {
  return resolveColor(shape.fill, theme.value) ?? 'none';
}

function shapeLabel(shape: ShapeInfo): string {
  if (shape.placeholder) return shape.placeholder.type;
  if (shape.kind === 'picture') return 'img';
  if (shape.smartArt) return 'SmartArt';
  return '';
}

function backgroundOf(part: SlidePartInfo): string {
  return (
    resolveColor(part.background, theme.value) ??
    resolveColor('scheme:lt1', theme.value) ??
    '#ffffff'
  );
}

function flattenNodes(nodes: SmartArtNode[], depth = 0): Array<{ text: string; depth: number }> {
  return nodes.flatMap((n) => [{ text: n.text, depth }, ...flattenNodes(n.children, depth + 1)]);
}
</script>

<template>
  <div class="styles">
    <CaSpinner v-if="loading" class="styles__state" />
    <p v-else-if="error" class="styles__error" role="alert">{{ error }}</p>
    <template v-else-if="profile">
      <div class="styles__toolbar">
        <p class="styles__summary">{{ profile.summary }}</p>
        <div class="styles__toolbar-actions">
          <CaButton size="small" variant="secondary" @click="copy(profile, 'JSON')">
            <template #icon-start><CaIcon name="copy" :size="14" /></template>
            {{ t('workspace.documents.styles.copyJson') }}
          </CaButton>
          <CaButton size="small" variant="primary" :loading="saving" @click="saveTemplate">
            <template #icon-start><CaIcon name="star" :size="14" /></template>
            {{ t('workspace.documents.styles.saveTemplate') }}
          </CaButton>
        </div>
      </div>

      <section v-if="theme" class="styles__section">
        <header class="styles__section-head">
          <h3>{{ t('workspace.documents.styles.theme') }} · {{ theme.name ?? '—' }}</h3>
          <button
            type="button"
            class="styles__link"
            @click="copy(theme, t('workspace.documents.styles.theme'))"
          >
            {{ t('workspace.chat.copy') }}
          </button>
        </header>
        <ul class="styles__swatches">
          <li v-for="c in themeColors" :key="c.key">
            <button
              type="button"
              class="styles__swatch"
              :title="t('workspace.documents.styles.copyColor')"
              @click="c.hex && copy(c.hex, c.hex)"
            >
              <span class="styles__chip" :style="{ background: c.hex ?? 'transparent' }" />
              <span class="styles__swatch-key">{{ c.key }}</span>
              <span class="styles__swatch-hex">{{ c.hex ?? '—' }}</span>
            </button>
          </li>
        </ul>
        <dl class="styles__fonts">
          <dt>{{ t('workspace.documents.styles.headingFont') }}</dt>
          <dd :style="{ fontFamily: theme.fonts.major.latin ?? undefined }">
            {{ theme.fonts.major.latin ?? '—' }}
          </dd>
          <dt>{{ t('workspace.documents.styles.bodyFont') }}</dt>
          <dd :style="{ fontFamily: theme.fonts.minor.latin ?? undefined }">
            {{ theme.fonts.minor.latin ?? '—' }}
          </dd>
        </dl>
      </section>

      <!-- Word -->
      <template v-if="profile.docx">
        <section class="styles__section">
          <header class="styles__section-head">
            <h3>{{ t('workspace.documents.styles.page') }}</h3>
          </header>
          <p class="styles__meta">
            {{ profile.docx.page.widthMm ?? '?' }} × {{ profile.docx.page.heightMm ?? '?' }} mm ·
            {{ profile.docx.page.orientation }} · {{ t('workspace.documents.styles.margins') }}
            {{ profile.docx.page.marginsMm.top }}/{{ profile.docx.page.marginsMm.right }}/{{
              profile.docx.page.marginsMm.bottom
            }}/{{ profile.docx.page.marginsMm.left }} mm
          </p>
        </section>

        <section class="styles__section">
          <header class="styles__section-head">
            <h3>
              {{ t('workspace.documents.styles.paragraphStyles') }} ({{
                profile.docx.styles.length
              }})
            </h3>
            <button type="button" class="styles__link" @click="showAllStyles = !showAllStyles">
              {{
                showAllStyles
                  ? t('workspace.documents.styles.showMain')
                  : t('workspace.documents.styles.showAll')
              }}
            </button>
          </header>
          <table class="styles__table">
            <tbody>
              <tr v-for="s in docxStyles" :key="s.id">
                <td>
                  <span
                    class="styles__sample"
                    :style="{
                      fontFamily: (s.font?.startsWith('theme:') ? null : s.font) ?? undefined,
                      fontWeight: s.bold ? 600 : 400,
                      fontStyle: s.italic ? 'italic' : 'normal',
                      color: resolveColor(s.color, theme) ?? undefined,
                    }"
                    >{{ s.name }}</span
                  >
                </td>
                <td class="styles__muted">{{ s.font ?? '—' }}</td>
                <td class="styles__muted">{{ s.sizePt ? `${s.sizePt} pt` : '—' }}</td>
                <td>
                  <button type="button" class="styles__link" @click="copy(s, s.name)">
                    {{ t('workspace.chat.copy') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="headerFooters.length" class="styles__section">
          <header class="styles__section-head">
            <h3>{{ t('workspace.documents.styles.headerFooter') }}</h3>
          </header>
          <ul class="styles__list">
            <li v-for="hf in headerFooters" :key="hf.part">
              <strong>{{ hf.kind === 'header' ? 'Header' : 'Footer' }}</strong>
              <span class="styles__muted"> · {{ hf.part.split('/').pop() }}</span>
              <span v-if="hf.images.length" class="styles__muted">
                · {{ hf.images.length }} gambar</span
              >
              <p v-if="hf.text" class="styles__quote">{{ hf.text }}</p>
            </li>
          </ul>
        </section>
      </template>

      <!-- PowerPoint -->
      <template v-if="profile.pptx">
        <section class="styles__section">
          <header class="styles__section-head">
            <h3>
              {{ t('workspace.documents.styles.mastersLayouts') }} ·
              {{ profile.pptx.slideSize.widthIn }}×{{ profile.pptx.slideSize.heightIn }} in
            </h3>
          </header>
          <div class="styles__thumbs">
            <figure
              v-for="part in [...profile.pptx.masters, ...profile.pptx.layouts]"
              :key="part.part"
              class="styles__thumb"
            >
              <svg
                :viewBox="`0 0 100 ${100 * slideAspect}`"
                role="img"
                :aria-label="part.name ?? part.part"
              >
                <rect
                  x="0"
                  y="0"
                  width="100"
                  :height="100 * slideAspect"
                  :fill="backgroundOf(part)"
                />
                <g v-for="(shape, i) in part.shapes" :key="i">
                  <template v-if="shape.box">
                    <rect
                      :x="shape.box.x"
                      :y="shape.box.y * slideAspect"
                      :width="shape.box.w"
                      :height="shape.box.h * slideAspect"
                      :fill="shape.placeholder ? 'none' : fillOf(shape)"
                      :stroke="shape.placeholder || shape.kind === 'picture' ? '#8a8a8a' : 'none'"
                      :stroke-dasharray="shape.placeholder ? '1.2 0.8' : undefined"
                      stroke-width="0.3"
                    />
                    <text
                      v-if="shapeLabel(shape)"
                      :x="shape.box.x + 1"
                      :y="shape.box.y * slideAspect + 3"
                      font-size="2.6"
                      fill="#666"
                    >
                      {{ shapeLabel(shape) }}
                    </text>
                  </template>
                </g>
              </svg>
              <figcaption>
                <span>{{ part.name ?? part.type ?? part.part.split('/').pop() }}</span>
                <button
                  type="button"
                  class="styles__link"
                  @click="copy(part, part.name ?? part.part)"
                >
                  {{ t('workspace.chat.copy') }}
                </button>
              </figcaption>
            </figure>
          </div>
        </section>

        <section class="styles__section">
          <header class="styles__section-head">
            <h3>{{ t('workspace.documents.styles.slides') }} ({{ profile.pptx.slides.length }})</h3>
          </header>
          <ol class="styles__list">
            <li v-for="(slide, i) in profile.pptx.slides" :key="slide.part">
              <strong>{{ i + 1 }}.</strong>
              {{
                slide.shapes.find((s) => s.placeholder?.type?.includes('itle'))?.text[0] ??
                slide.name ??
                '—'
              }}
              <span class="styles__muted">
                · {{ slide.shapes.length }} shape
                <template v-if="slide.shapes.some((s) => s.smartArt)"> · SmartArt</template>
              </span>
            </li>
          </ol>
        </section>

        <section v-if="profile.pptx.smartArt.length" class="styles__section">
          <header class="styles__section-head">
            <h3>SmartArt ({{ profile.pptx.smartArt.length }})</h3>
          </header>
          <div v-for="art in profile.pptx.smartArt" :key="art.part" class="styles__smartart">
            <p class="styles__muted">
              {{ art.layout?.split('/').pop() ?? '—' }}
              <template v-if="art.slide"> · {{ art.slide.split('/').pop() }}</template>
              <button type="button" class="styles__link" @click="copy(art, 'SmartArt')">
                {{ t('workspace.chat.copy') }}
              </button>
            </p>
            <ul class="styles__tree">
              <li
                v-for="(node, i) in flattenNodes(art.nodes)"
                :key="i"
                :style="{ paddingLeft: `${node.depth * 14}px` }"
              >
                {{ node.text || '—' }}
              </li>
            </ul>
          </div>
        </section>
      </template>

      <!-- Excel -->
      <template v-if="profile.xlsx">
        <section class="styles__section">
          <header class="styles__section-head">
            <h3>{{ t('workspace.documents.styles.cellStyles') }}</h3>
          </header>
          <ul class="styles__list">
            <li v-for="(font, i) in profile.xlsx.fonts.slice(0, 12)" :key="i">
              <span
                :style="{
                  fontFamily: font.name ?? undefined,
                  fontWeight: font.bold ? 600 : 400,
                  color: resolveColor(font.color, theme) ?? undefined,
                }"
              >
                {{ font.name ?? '—' }} {{ font.sizePt ? `${font.sizePt} pt` : '' }}
              </span>
            </li>
          </ul>
          <p v-if="profile.xlsx.cellStyles.length" class="styles__meta">
            {{ profile.xlsx.cellStyles.join(', ') }}
          </p>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.styles {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  padding: var(--ca-space-4);
  color: var(--ca-fg-1);
  font-size: var(--ca-text-200);
}

.styles__state {
  margin: var(--ca-space-6) auto;
}

.styles__error {
  color: var(--ca-danger-fg);
}

.styles__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ca-space-3);
}

.styles__summary {
  margin: 0;
  flex: 1 1 240px;
  color: var(--ca-fg-2, var(--ca-fg-1));
}

.styles__toolbar-actions {
  display: flex;
  gap: var(--ca-space-2);
}

.styles__section {
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  padding: var(--ca-space-3) var(--ca-space-4);
}

.styles__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-2);
  margin-bottom: var(--ca-space-2);
}

.styles__section-head h3 {
  margin: 0;
  font-size: var(--ca-text-300);
  font-weight: 600;
}

.styles__link {
  border: none;
  background: none;
  padding: 0 4px;
  font: inherit;
  font-size: var(--ca-text-100);
  color: var(--ca-color-brand-fg, var(--ca-fg-1));
  cursor: pointer;
}

.styles__link:hover {
  text-decoration: underline;
}

.styles__swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--ca-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.styles__swatch {
  display: grid;
  grid-template-columns: 22px 1fr;
  grid-template-rows: auto auto;
  column-gap: 6px;
  width: 100%;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-sm);
  background: var(--ca-bg-surface);
  padding: 4px 6px;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.styles__swatch:hover {
  background: var(--ca-bg-surface-3);
}

.styles__chip {
  grid-row: span 2;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid var(--ca-stroke-2);
}

.styles__swatch-key {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.styles__swatch-hex {
  font-family: var(--ca-font-mono, monospace);
  font-size: var(--ca-text-100);
}

.styles__fonts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px var(--ca-space-3);
  margin: var(--ca-space-3) 0 0;
}

.styles__fonts dt {
  color: var(--ca-fg-3);
}

.styles__fonts dd {
  margin: 0;
}

.styles__meta,
.styles__muted {
  color: var(--ca-fg-3);
}

.styles__meta {
  margin: 0;
}

.styles__table {
  width: 100%;
  border-collapse: collapse;
}

.styles__table td {
  padding: 4px 6px;
  border-top: 1px solid var(--ca-stroke-2);
  vertical-align: middle;
}

.styles__sample {
  font-size: var(--ca-text-300);
}

.styles__list {
  margin: 0;
  padding-left: 1.1em;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.styles__quote {
  margin: 2px 0 0;
  padding-left: 8px;
  border-left: 2px solid var(--ca-stroke-2);
  white-space: pre-wrap;
}

.styles__thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--ca-space-3);
}

.styles__thumb {
  margin: 0;
}

.styles__thumb svg {
  display: block;
  width: 100%;
  border: 1px solid var(--ca-stroke-2);
  border-radius: 4px;
}

.styles__thumb figcaption {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  margin-top: 4px;
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.styles__smartart + .styles__smartart {
  margin-top: var(--ca-space-3);
}

.styles__tree {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
</style>
