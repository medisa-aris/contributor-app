<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { PERMISSION_CATALOG } from '@bara/shared';
import { DOC_CHAPTERS } from '@/docs/chapters';
import type { DocChapter, DocHub, DocStep } from '@/docs/types';
import { useAuthStore } from '@/stores/auth.store';
import {
  CaButton,
  CaDialog,
  CaEmptyState,
  CaIcon,
  CaInput,
  CaPageHeader,
  CaSelect,
  type CaSelectOption,
} from '@/components/ui';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const HUB_ORDER: DocHub[] = ['start', 'workspace', 'knowledge', 'agents', 'integrations', 'admin'];

const visibleChapters = computed<DocChapter[]>(() =>
  DOC_CHAPTERS.filter((c) => c.permissions.length === 0 || c.permissions.some((p) => auth.can(p))),
);

const query = ref('');

function chapterText(chapter: DocChapter): string {
  return [
    chapter.title,
    chapter.summary,
    ...chapter.steps.flatMap((s) => [s.title, ...s.body, s.result, s.tip ?? '']),
  ]
    .join(' ')
    .toLowerCase();
}

const filteredChapters = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return visibleChapters.value;
  return visibleChapters.value.filter((c) => chapterText(c).includes(q));
});

const groupedChapters = computed(() =>
  HUB_ORDER.map((hub) => ({
    hub,
    chapters: filteredChapters.value.filter((c) => c.hub === hub),
  })).filter((g) => g.chapters.length > 0),
);

const current = computed<DocChapter | null>(() => {
  const id = route.params.chapter;
  return visibleChapters.value.find((c) => c.id === id) ?? visibleChapters.value[0] ?? null;
});

// Bab yang tidak diizinkan atau tidak dikenal kembali ke bab pertama yang terlihat.
watch(
  [() => route.params.chapter, visibleChapters],
  ([id]) => {
    if (typeof id === 'string' && id && current.value && current.value.id !== id) {
      void router.replace({ name: 'docs', params: { chapter: current.value.id } });
    }
  },
  { immediate: true },
);

watch(
  () => current.value?.id,
  () => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  },
);

const currentIndex = computed(() => (current.value ? visibleChapters.value.indexOf(current.value) : -1));
const prevChapter = computed(() => (currentIndex.value > 0 ? visibleChapters.value[currentIndex.value - 1] : null));
const nextChapter = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < visibleChapters.value.length - 1
    ? visibleChapters.value[currentIndex.value + 1]
    : null,
);

const chapterOptions = computed<CaSelectOption[]>(() =>
  visibleChapters.value.map((c) => ({ value: c.id, label: c.title })),
);

function openChapter(id: string): void {
  void router.push({ name: 'docs', params: { chapter: id } });
}

function permissionName(id: string): string {
  return PERMISSION_CATALOG.find((p) => p.id === id)?.name ?? id;
}

function stepLocked(step: DocStep): boolean {
  return !!step.permission && !auth.can(step.permission);
}

const zoomed = ref<DocStep | null>(null);
const zoomOpen = computed({
  get: () => zoomed.value !== null,
  set: (value: boolean) => {
    if (!value) zoomed.value = null;
  },
});
</script>

<template>
  <div class="docs">
    <CaPageHeader :title="t('docs.title')" :description="t('docs.description')" />

    <CaEmptyState v-if="visibleChapters.length === 0" :title="t('docs.empty')" />

    <div v-else class="docs__layout">
      <aside class="docs__nav ca-panel" :aria-label="t('docs.chaptersLabel')">
        <CaInput
          v-model="query"
          type="search"
          :placeholder="t('docs.searchPlaceholder')"
          :aria-label="t('docs.searchPlaceholder')"
        />
        <p v-if="groupedChapters.length === 0" class="docs__muted">{{ t('docs.noMatch', { q: query }) }}</p>
        <nav v-for="group in groupedChapters" :key="group.hub" class="docs__group">
          <p class="docs__group-label">{{ t(`docs.hubs.${group.hub}`) }}</p>
          <RouterLink
            v-for="chapter in group.chapters"
            :key="chapter.id"
            :to="{ name: 'docs', params: { chapter: chapter.id } }"
            class="docs__link"
            :class="{ 'docs__link--active': chapter.id === current?.id }"
            :aria-current="chapter.id === current?.id ? 'page' : undefined"
          >
            <span>{{ chapter.title }}</span>
            <span class="docs__link-count">{{ t('docs.stepsCount', { n: chapter.steps.length }) }}</span>
          </RouterLink>
        </nav>
      </aside>

      <div class="docs__mobile-nav">
        <CaSelect
          :model-value="current?.id ?? ''"
          :options="chapterOptions"
          :aria-label="t('docs.chapterSelect')"
          @update:model-value="(v: string) => openChapter(v)"
        />
      </div>

      <article v-if="current" class="docs__content">
        <header class="docs__chapter-head ca-panel">
          <span class="docs__hub">{{ t(`docs.hubs.${current.hub}`) }}</span>
          <h2 class="docs__chapter-title">{{ current.title }}</h2>
          <p class="docs__summary">{{ current.summary }}</p>
          <p class="docs__audience">
            <strong>{{ t('docs.audience') }}:</strong> {{ current.audience }}
          </p>
        </header>

        <ol class="docs__steps">
          <li v-for="(step, index) in current.steps" :key="step.title" class="docs__step ca-panel">
            <div class="docs__step-head">
              <span class="docs__step-num" aria-hidden="true">{{ index + 1 }}</span>
              <div class="docs__step-titles">
                <span class="docs__step-label">{{ t('docs.step', { n: index + 1 }) }}</span>
                <h3 class="docs__step-title">{{ step.title }}</h3>
              </div>
              <span v-if="step.permission" class="docs__perm" :class="{ 'docs__perm--locked': stepLocked(step) }">
                <CaIcon name="shield" :size="14" />
                {{ t('docs.needsPermission', { name: permissionName(step.permission) }) }}
              </span>
            </div>

            <p v-for="(paragraph, pIndex) in step.body" :key="pIndex" class="docs__para">{{ paragraph }}</p>

            <button
              v-if="step.image"
              type="button"
              class="docs__shot"
              :aria-label="t('docs.zoom', { title: step.title })"
              @click="zoomed = step"
            >
              <img :src="step.image" :alt="step.imageAlt ?? step.title" loading="lazy" decoding="async" />
            </button>

            <div class="docs__result">
              <CaIcon name="check-circle" :size="16" />
              <div>
                <strong>{{ t('docs.result') }}</strong>
                <p>{{ step.result }}</p>
              </div>
            </div>

            <div v-if="step.tip" class="docs__tip">
              <CaIcon name="info" :size="16" />
              <div>
                <strong>{{ t('docs.tip') }}</strong>
                <p>{{ step.tip }}</p>
              </div>
            </div>
          </li>
        </ol>

        <nav class="docs__pager">
          <CaButton v-if="prevChapter" @click="openChapter(prevChapter.id)">
            <template #icon-start><CaIcon name="chevron-left" :size="16" /></template>
            {{ t('docs.prev') }}: {{ prevChapter.title }}
          </CaButton>
          <span class="docs__spacer" />
          <CaButton v-if="nextChapter" variant="primary" @click="openChapter(nextChapter.id)">
            {{ t('docs.next') }}: {{ nextChapter.title }}
            <template #icon-end><CaIcon name="chevron-right" :size="16" /></template>
          </CaButton>
        </nav>
      </article>
    </div>

    <CaDialog v-model:open="zoomOpen" :title="zoomed?.title ?? ''" size="xlarge">
      <img v-if="zoomed?.image" :src="zoomed.image" :alt="zoomed.imageAlt ?? zoomed.title" class="docs__zoom-img" />
    </CaDialog>
  </div>
</template>

<style scoped>
.docs__layout {
  display: flex;
  gap: var(--ca-space-12);
  align-items: flex-start;
}

.docs__nav {
  flex: 0 0 var(--ca-context-panel-width);
  position: sticky;
  top: calc(var(--ca-topbar-height) + var(--ca-space-8));
  max-height: calc(100vh - var(--ca-topbar-height) - var(--ca-space-16));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-8);
  padding: var(--ca-space-8);
}

.docs__group {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
}

.docs__group-label {
  padding: 0 var(--ca-space-4) var(--ca-space-2);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-3);
}

.docs__link {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
  padding: var(--ca-space-4) var(--ca-space-6);
  border-radius: var(--ca-radius-lg);
  color: var(--ca-fg-1);
  text-decoration: none;
}

.docs__link:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
  text-decoration: none;
}

.docs__link--active,
.docs__link--active:hover {
  background: var(--ca-color-brand-subtle);
  font-weight: var(--ca-font-weight-semibold);
}

.docs__link-count {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-regular);
  color: var(--ca-fg-3);
}

.docs__muted {
  color: var(--ca-fg-3);
}

.docs__mobile-nav {
  display: none;
}

.docs__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-12);
}

.docs__content .ca-panel + .ca-panel {
  margin-top: 0;
}

.docs__chapter-head {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
}

.docs__hub {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-color-brand-text);
}

.docs__chapter-title {
  font-size: var(--ca-text-700);
  line-height: var(--ca-line-700);
  font-weight: var(--ca-font-weight-semibold);
}

.docs__summary {
  font-size: var(--ca-text-450);
  line-height: var(--ca-line-450);
  color: var(--ca-fg-2);
  max-width: 780px;
}

.docs__audience {
  color: var(--ca-fg-3);
}

.docs__steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-12);
}

.docs__step {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
}

.docs__step-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ca-space-6);
}

.docs__step-num {
  width: 32px;
  height: 32px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ca-radius-circular);
  background: var(--ca-color-brand-strong);
  color: var(--ca-fg-on-brand-strong);
  font-weight: var(--ca-font-weight-semibold);
}

.docs__step-titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.docs__step-label {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.docs__step-title {
  font-size: var(--ca-text-500);
  line-height: var(--ca-line-500);
  font-weight: var(--ca-font-weight-semibold);
}

.docs__perm {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-2);
  padding: var(--ca-space-1) var(--ca-space-4);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface-2);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
}

.docs__perm--locked {
  background: var(--ca-warning-bg);
  color: var(--ca-warning-fg);
}

.docs__para {
  max-width: 820px;
  color: var(--ca-fg-1);
}

.docs__shot {
  display: block;
  padding: 0;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface-2);
  overflow: hidden;
  cursor: zoom-in;
  box-shadow: var(--ca-shadow-4);
}

.docs__shot img {
  display: block;
  width: 100%;
  height: auto;
}

.docs__shot:hover {
  box-shadow: var(--ca-shadow-8);
}

.docs__result,
.docs__tip {
  display: flex;
  gap: var(--ca-space-4);
  padding: var(--ca-space-6) var(--ca-space-8);
  border-radius: var(--ca-radius-xl);
}

.docs__result {
  background: var(--ca-success-bg);
  color: var(--ca-fg-1);
}

.docs__result > svg {
  flex: none;
  margin-top: 2px;
  color: var(--ca-success-fg);
}

.docs__tip {
  background: var(--ca-info-bg);
}

.docs__tip > svg {
  flex: none;
  margin-top: 2px;
  color: var(--ca-info-fg);
}

.docs__result p,
.docs__tip p {
  margin-top: var(--ca-space-1);
}

.docs__pager {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-6);
}

.docs__pager :deep(.ca-button) {
  max-width: 100%;
  height: auto;
  min-height: 32px;
  padding-top: var(--ca-space-3);
  padding-bottom: var(--ca-space-3);
  white-space: normal;
  text-align: left;
}

.docs__spacer {
  flex: 1;
}

.docs__zoom-img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--ca-radius-md);
  margin-bottom: var(--ca-space-8);
}

@media (max-width: 900px) {
  .docs__layout {
    flex-direction: column;
    align-items: stretch;
  }

  .docs__nav {
    display: none;
  }

  .docs__mobile-nav {
    display: block;
    width: 100%;
  }
}
</style>
