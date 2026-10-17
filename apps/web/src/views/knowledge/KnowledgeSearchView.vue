<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  listCollections,
  listSources,
  searchKnowledge,
  type KnowledgeSearchHit,
} from '@/api/knowledge';
import {
  CaBadge,
  CaButton,
  CaCard,
  CaInput,
  CaPageHeader,
  CaSelect,
  CaSpinner,
  type CaSelectOption,
} from '@/components/ui';

const { t } = useI18n();

const query = ref('');
const sourceFilter = ref('');
const collectionFilter = ref('');
const hits = ref<KnowledgeSearchHit[]>([]);
const total = ref(0);
const searched = ref(false);
const searching = ref(false);
const error = ref('');

const sourceOptions = ref<CaSelectOption[]>([{ value: '', label: t('common.all') }]);
const collectionOptions = ref<CaSelectOption[]>([{ value: '', label: t('common.all') }]);

async function loadScopes(): Promise<void> {
  try {
    const [srcResult, colResult] = await Promise.all([
      listSources({ page: 1, pageSize: 100 }),
      listCollections({ page: 1, pageSize: 100 }),
    ]);
    sourceOptions.value = [
      { value: '', label: t('common.all') },
      ...srcResult.items.map((s) => ({ value: s.id, label: s.name })),
    ];
    collectionOptions.value = [
      { value: '', label: t('common.all') },
      ...colResult.items.map((c) => ({ value: c.id, label: c.name })),
    ];
  } catch {
    sourceOptions.value = [{ value: '', label: t('common.all') }];
    collectionOptions.value = [{ value: '', label: t('common.all') }];
  }
}

onMounted(() => void loadScopes());

async function runSearch(): Promise<void> {
  const q = query.value.trim();
  if (q.length < 2) {
    error.value = t('knowledge.searchTooShort');
    return;
  }
  searching.value = true;
  error.value = '';
  try {
    const result = await searchKnowledge({
      query: q,
      sourceIds: sourceFilter.value ? [sourceFilter.value] : undefined,
      collectionId: collectionFilter.value || undefined,
    });
    hits.value = result.hits;
    total.value = result.total;
    searched.value = true;
  } catch (caught) {
    hits.value = [];
    total.value = 0;
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    searching.value = false;
  }
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

const resultSummary = computed(() =>
  searched.value ? t('knowledge.resultCount', { count: total.value }) : '',
);
</script>

<template>
  <div>
    <CaPageHeader
      :title="t('knowledge.searchTitle')"
      :description="t('knowledge.searchDescription')"
    />

    <CaCard>
      <form class="ksearch-form" @submit.prevent="runSearch">
        <CaInput
          v-model="query"
          type="search"
          class="ksearch-form__input"
          :placeholder="t('knowledge.searchInputPlaceholder')"
          :aria-label="t('knowledge.searchInputPlaceholder')"
        />
        <CaSelect
          v-model="sourceFilter"
          class="ksearch-form__select"
          :options="sourceOptions"
          :aria-label="t('knowledge.filterSource')"
        />
        <CaSelect
          v-model="collectionFilter"
          class="ksearch-form__select"
          :options="collectionOptions"
          :aria-label="t('knowledge.filterCollection')"
        />
        <CaButton variant="primary" type="submit" :loading="searching">
          {{ t('common.search') }}
        </CaButton>
      </form>
    </CaCard>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <div v-if="searching" class="ksearch-loading"><CaSpinner size="large" /></div>

    <template v-else-if="searched">
      <p class="ksearch-summary">{{ resultSummary }}</p>

      <p v-if="hits.length === 0" class="ksearch-none">{{ t('knowledge.searchNoResult') }}</p>

      <div v-else class="ksearch-results">
        <CaCard v-for="hit in hits" :key="hit.document_id" :padded="true">
          <article class="ksearch-hit">
            <header class="ksearch-hit__head">
              <h2 class="ksearch-hit__title">{{ hit.title }}</h2>
              <div class="ksearch-hit__badges">
                <CaBadge variant="brand" size="small">#{{ hit.rank }}</CaBadge>
                <CaBadge variant="informative" size="small">{{ hit.source_name }}</CaBadge>
              </div>
            </header>
            <p class="ksearch-hit__snippet">
              <template v-for="(segment, idx) in snippetSegments(hit.snippet)" :key="idx">
                <mark v-if="segment.highlighted" class="ksearch-hit__mark">{{ segment.text }}</mark>
                <template v-else>{{ segment.text }}</template>
              </template>
            </p>
            <footer v-if="hit.locator" class="ksearch-hit__locator">
              {{ t('knowledge.locatorLabel') }}: <span class="admin-mono">{{ hit.locator }}</span>
            </footer>
          </article>
        </CaCard>
      </div>
    </template>

    <p v-else class="ksearch-hint">{{ t('knowledge.searchHint') }}</p>
  </div>
</template>

<style scoped>
.ksearch-form {
  display: flex;
  gap: var(--ca-space-4);
  align-items: center;
  flex-wrap: wrap;
}

.ksearch-form__input {
  flex: 1 1 280px;
}

.ksearch-form__select {
  width: 220px;
}

.ksearch-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-20) 0;
}

.ksearch-summary {
  margin: var(--ca-space-6) 0;
  font-size: var(--ca-text-300);
  color: var(--ca-fg-2);
}

.ksearch-none,
.ksearch-hint {
  margin: var(--ca-space-6) 0;
  font-size: var(--ca-text-300);
  color: var(--ca-fg-3);
}

.ksearch-results {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-5);
}

.ksearch-hit {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.ksearch-hit__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
}

.ksearch-hit__title {
  margin: 0;
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.ksearch-hit__badges {
  display: flex;
  gap: var(--ca-space-3);
}

.ksearch-hit__snippet {
  margin: 0;
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
  color: var(--ca-fg-2);
}

.ksearch-hit__mark {
  background: var(--ca-color-brand-bg, rgba(100, 120, 255, 0.18));
  color: var(--ca-fg-1);
  border-radius: 2px;
  padding: 0 2px;
}

.ksearch-hit__locator {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}
</style>
