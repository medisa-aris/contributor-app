<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ApiError } from '@/api/http';
import { listCollections, searchKnowledge, type KnowledgeSearchHit } from '@/api/knowledge';
import { useAuthStore } from '@/stores/auth.store';
import { CaButton, CaIcon, CaPageHeader, CaSpinner } from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();

const query = ref('');
const lastQuery = ref('');
const collectionFilter = ref('');
const selectedSources = ref<string[]>([]);
const hits = ref<KnowledgeSearchHit[]>([]);
const searched = ref(false);
const searching = ref(false);
const error = ref('');
const collections = ref<{ id: string; name: string }[]>([]);

onMounted(async () => {
  try {
    const result = await listCollections({ page: 1, pageSize: 100 });
    collections.value = result.items.map((c) => ({ id: c.id, name: c.name }));
  } catch {
    collections.value = [];
  }
});

/** Sumber dihitung dari hasil terakhir agar jumlah per sumber tetap terlihat saat difilter. */
const sourceFacets = computed(() => {
  const map = new Map<string, { id: string; name: string; count: number }>();
  for (const hit of hits.value) {
    const entry = map.get(hit.source_id) ?? { id: hit.source_id, name: hit.source_name, count: 0 };
    entry.count += 1;
    map.set(hit.source_id, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
});

const visibleHits = computed(() =>
  selectedSources.value.length === 0
    ? hits.value
    : hits.value.filter((hit) => selectedSources.value.includes(hit.source_id)),
);

const maxRank = computed(() => Math.max(0.0001, ...hits.value.map((h) => h.rank)));
const rankFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });

async function runSearch(): Promise<void> {
  const q = query.value.trim();
  if (q.length < 2) {
    error.value = t('knowledge.searchTooShort');
    return;
  }
  searching.value = true;
  error.value = '';
  try {
    const result = await searchKnowledge({ query: q, collectionId: collectionFilter.value || undefined });
    hits.value = result.hits;
    lastQuery.value = q;
    selectedSources.value = selectedSources.value.filter((id) => result.hits.some((h) => h.source_id === id));
    searched.value = true;
  } catch (caught) {
    hits.value = [];
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    searching.value = false;
  }
}

function setCollection(id: string): void {
  collectionFilter.value = id;
  if (searched.value) void runSearch();
}

function toggleSource(id: string): void {
  selectedSources.value = selectedSources.value.includes(id)
    ? selectedSources.value.filter((s) => s !== id)
    : [...selectedSources.value, id];
}

function sourceName(id: string): string {
  return sourceFacets.value.find((s) => s.id === id)?.name ?? id;
}

// Cuplikan dari ts_headline membungkus kata kunci dengan <mark>…</mark>.
// Pecah menjadi segmen teks polos agar aman dirender tanpa v-html.
type SnippetSegment = { text: string; highlighted: boolean };

function snippetSegments(snippet: string): SnippetSegment[] {
  const parts = snippet.split(/<\/?mark>/);
  const segments: SnippetSegment[] = [];
  let highlighted = false;
  for (const part of parts) {
    if (part.length > 0) segments.push({ text: part, highlighted });
    highlighted = !highlighted;
  }
  return segments;
}

function askRoute(hit: KnowledgeSearchHit): string {
  return `/workspace/second-brain?q=${encodeURIComponent(`${lastQuery.value} — ${hit.title}`)}`;
}
</script>

<template>
  <div class="ksearch">
    <CaPageHeader :title="t('knowledge.searchTitle')" :description="t('knowledge.searchDescription')" />

    <form class="ksearch-form ca-panel" role="search" @submit.prevent="runSearch">
      <label class="ksearch-field">
        <CaIcon name="search" :size="16" />
        <span class="ca-visually-hidden">{{ t('knowledge.searchInputPlaceholder') }}</span>
        <input
          v-model="query"
          type="search"
          class="ksearch-field__input"
          :placeholder="t('knowledge.searchInputPlaceholder')"
        />
        <button v-if="query" type="button" class="ksearch-field__clear" :aria-label="t('knowledge.clearQuery')" @click="query = ''">
          <CaIcon name="close" :size="14" />
        </button>
      </label>
      <CaButton variant="primary" type="submit" :loading="searching">{{ t('common.search') }}</CaButton>
    </form>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <div class="ksearch-body">
      <aside class="ksearch-filters ca-panel" :aria-label="t('knowledge.filtersLabel')">
        <fieldset v-if="sourceFacets.length > 0" class="ksearch-group">
          <legend class="ksearch-legend">{{ t('knowledge.filterSource') }}</legend>
          <label v-for="source in sourceFacets" :key="source.id" class="ksearch-option">
            <input type="checkbox" :checked="selectedSources.includes(source.id)" @change="toggleSource(source.id)" />
            <span class="ksearch-option__label">{{ source.name }}</span>
            <span class="ksearch-option__count">{{ source.count }}</span>
          </label>
        </fieldset>
        <fieldset class="ksearch-group">
          <legend class="ksearch-legend">{{ t('knowledge.filterCollection') }}</legend>
          <label class="ksearch-option">
            <input type="radio" name="ksearch-collection" :checked="collectionFilter === ''" @change="setCollection('')" />
            <span class="ksearch-option__label">{{ t('knowledge.allCollections') }}</span>
          </label>
          <label v-for="collection in collections" :key="collection.id" class="ksearch-option">
            <input
              type="radio"
              name="ksearch-collection"
              :checked="collectionFilter === collection.id"
              @change="setCollection(collection.id)"
            />
            <span class="ksearch-option__label">{{ collection.name }}</span>
          </label>
        </fieldset>
      </aside>

      <section class="ksearch-results" :aria-label="t('knowledge.searchTitle')" aria-live="polite">
        <div v-if="searching" class="ksearch-loading"><CaSpinner size="large" /></div>
        <template v-else-if="searched">
          <div class="ksearch-summary">
            <span class="ksearch-summary__text">
              <strong>{{ t('knowledge.resultCount', { count: visibleHits.length }) }}</strong>
              <span class="ksearch-muted">{{ t('knowledge.resultFor', { q: lastQuery }) }}</span>
            </span>
            <span v-for="id in selectedSources" :key="id" class="ksearch-chip">
              {{ t('knowledge.filterSource') }}: {{ sourceName(id) }}
              <button type="button" :aria-label="t('knowledge.clearSourceFilter', { name: sourceName(id) })" @click="toggleSource(id)">
                <CaIcon name="close" :size="12" />
              </button>
            </span>
          </div>
          <p v-if="visibleHits.length === 0" class="ksearch-muted">{{ t('knowledge.searchNoResult') }}</p>
          <article v-for="hit in visibleHits" :key="hit.document_id" class="ksearch-hit ca-panel">
            <header class="ksearch-hit__head">
              <h2 class="ksearch-hit__title">{{ hit.title }}</h2>
              <span class="ksearch-rank">
                <span class="ksearch-muted">{{ t('knowledge.relevance') }}</span>
                <span class="ksearch-rank__bar" aria-hidden="true">
                  <span :style="{ width: `${Math.round((hit.rank / maxRank) * 100)}%` }" />
                </span>
                <span class="ksearch-rank__value">{{ rankFormatter.format(hit.rank) }}</span>
              </span>
            </header>
            <p class="ksearch-hit__snippet">
              <template v-for="(segment, idx) in snippetSegments(hit.snippet)" :key="idx">
                <mark v-if="segment.highlighted" class="ksearch-hit__mark">{{ segment.text }}</mark>
                <template v-else>{{ segment.text }}</template>
              </template>
            </p>
            <footer class="ksearch-hit__foot">
              <span class="ksearch-hit__source">
                <span class="ksearch-tag">{{ hit.source_name }}</span>
                <code v-if="hit.locator" class="ksearch-hit__locator">{{ hit.locator }}</code>
              </span>
              <RouterLink v-if="auth.can('ai.secondbrain.query')" :to="askRoute(hit)" class="ksearch-ask">
                {{ t('knowledge.askMultiBrain') }}
              </RouterLink>
            </footer>
          </article>
        </template>
        <p v-else class="ksearch-muted">{{ t('knowledge.searchHint') }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ksearch-form {
  display: flex;
  gap: var(--ca-space-6);
  align-items: center;
  margin-bottom: var(--ca-space-12);
  padding: var(--ca-space-8);
}

.ksearch-field {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
  height: 36px;
  padding: 0 var(--ca-space-4) 0 var(--ca-space-6);
  border: 1px solid var(--ca-stroke-2);
  border-bottom: 2px solid var(--ca-color-brand);
  border-radius: var(--ca-radius-md);
  color: var(--ca-fg-3);
}

.ksearch-field__input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ca-fg-1);
  outline: none;
}

.ksearch-field__input::-webkit-search-cancel-button {
  display: none;
}

.ksearch-summary__text {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
}

.ksearch-field__clear {
  display: flex;
  border: 0;
  background: transparent;
  color: var(--ca-fg-3);
  cursor: pointer;
}

.ksearch-body {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-12);
  align-items: flex-start;
}

.ksearch-filters {
  flex: 1 1 240px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-10);
}

.ksearch-group {
  margin: 0;
  padding: 0;
  border: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
}

.ksearch-legend {
  margin-bottom: var(--ca-space-4);
  font-weight: var(--ca-font-weight-semibold);
}

.ksearch-option {
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
  cursor: pointer;
}

.ksearch-option input {
  margin: 0;
  width: 16px;
  height: 16px;
  accent-color: var(--ca-color-brand-strong);
}

.ksearch-option__label {
  flex: 1;
}

.ksearch-option__count {
  color: var(--ca-fg-3);
  font-variant-numeric: tabular-nums;
}

.ksearch-results {
  flex: 999 1 480px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-8);
}

.ksearch-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-20) 0;
}

.ksearch-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-4) var(--ca-space-8);
}

.ksearch-muted {
  color: var(--ca-fg-3);
}

.ksearch-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-3);
  padding: var(--ca-space-1) var(--ca-space-3) var(--ca-space-1) var(--ca-space-4);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand-text);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
}

.ksearch-chip button {
  display: flex;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ksearch-hit {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
}

.ksearch-hit + .ksearch-hit {
  margin-top: 0;
}

.ksearch-hit__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ca-space-8);
  flex-wrap: wrap;
}

.ksearch-hit__title {
  font-size: var(--ca-text-450);
  line-height: var(--ca-line-450);
  font-weight: var(--ca-font-weight-semibold);
}

.ksearch-rank {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-4);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}

.ksearch-rank__bar {
  display: flex;
  width: 64px;
  height: 6px;
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface-2);
  overflow: hidden;
}

.ksearch-rank__bar span {
  background: var(--ca-chart-1);
}

.ksearch-rank__value {
  font-weight: var(--ca-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.ksearch-hit__snippet {
  color: var(--ca-fg-1);
}

.ksearch-hit__mark {
  background: var(--ca-color-brand-subtle);
  color: var(--ca-fg-1);
  font-weight: var(--ca-font-weight-semibold);
  border-radius: var(--ca-radius-sm);
  padding: 0 2px;
}

.ksearch-hit__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
}

.ksearch-hit__source {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-4);
}

.ksearch-tag {
  padding: var(--ca-space-1) var(--ca-space-4);
  border-radius: var(--ca-radius-md);
  border: 1px solid var(--ca-stroke-2);
  background: var(--ca-bg-surface-2);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}

.ksearch-hit__locator {
  font-family: var(--ca-font-family-mono);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.ksearch-ask {
  font-weight: var(--ca-font-weight-semibold);
}
</style>
