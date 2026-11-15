<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import { memoryThemes, type MemoryThemeSubjectDto } from '@/api/memory';
import { CaBadge, CaEmptyState, CaIcon, CaSpinner } from '@/components/ui';

/**
 * Tema memori (P3): kata kunci terbanyak per buku memori — buku sendiri dan bawahan yang
 * mengizinkan pintunya. Hanya kata kunci dan jumlah; isi catatan tidak pernah dikirim ke sini.
 */
const { t } = useI18n();
const loading = ref(true);
const error = ref('');
const subjects = ref<MemoryThemeSubjectDto[]>([]);

const maxWeight = computed(() =>
  Math.max(1, ...subjects.value.flatMap((s) => s.themes.map((theme) => theme.weight))),
);

/** Ukuran chip 1–4 relatif terhadap tema terbesar di peta. */
function size(weight: number): number {
  return Math.max(1, Math.round((weight / maxWeight.value) * 4));
}

function typeSummary(subject: MemoryThemeSubjectDto): string {
  return Object.entries(subject.counts)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([type, n]) => `${t(`memory.types.${type}`)} ${n}`)
    .join(' · ');
}

onMounted(async () => {
  try {
    subjects.value = await memoryThemes();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="mt">
    <p class="mt__desc">{{ t('memory.themes.description') }}</p>
    <div v-if="loading" class="mt__state"><CaSpinner /></div>
    <p v-else-if="error" class="admin-error" role="alert">{{ error }}</p>
    <CaEmptyState
      v-else-if="subjects.length === 0 || subjects.every((s) => s.total === 0)"
      :title="t('memory.themes.empty')"
    />
    <ul v-else class="mt__grid">
      <li
        v-for="subject in subjects"
        :key="subject.subjectId"
        class="mt__card"
        :class="{ 'mt__card--own': subject.own }"
      >
        <header class="mt__head">
          <span class="mt__icon" aria-hidden="true">
            <CaIcon :name="subject.kind === 'agent' ? 'bot' : 'people'" :size="16" />
          </span>
          <div class="mt__who">
            <strong class="mt__name">{{ subject.own ? `${subject.name} (${t('memory.themes.you')})` : subject.name }}</strong>
            <span class="mt__meta">
              {{ subject.departmentName ?? '' }}{{ subject.departmentName ? ' · ' : '' }}{{ t('memory.themes.entries', { n: subject.total }) }}
            </span>
          </div>
        </header>
        <ul v-if="subject.themes.length" class="mt__themes" :aria-label="t('memory.themes.tab')">
          <li
            v-for="theme in subject.themes"
            :key="theme.term"
            class="mt__theme"
            :class="`mt__theme--s${size(theme.weight)}`"
            :title="t('memory.themes.entries', { n: theme.weight })"
          >
            {{ theme.term }}
          </li>
        </ul>
        <p v-else class="mt__meta">{{ t('memory.themes.noThemes') }}</p>
        <footer v-if="subject.total" class="mt__types">
          <CaBadge size="small" no-icon>{{ typeSummary(subject) }}</CaBadge>
        </footer>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mt {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-5);
  height: 100%;
  overflow: auto;
}

.mt__desc {
  margin: 0;
  max-width: 90ch;
  color: var(--ca-fg-2);
  font-size: var(--ca-text-300);
}

.mt__state {
  display: grid;
  place-items: center;
  min-height: 200px;
}

.mt__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--ca-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mt__card {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  padding: var(--ca-space-4);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl, 8px);
  background: var(--ca-bg-surface-1);
}

.mt__card--own {
  border-color: var(--ca-color-brand);
  box-shadow: inset 3px 0 0 var(--ca-color-brand);
}

.mt__head {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
}

.mt__icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 50%;
  background: var(--ca-bg-surface-2);
  color: var(--ca-fg-2);
}

.mt__who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mt__name {
  color: var(--ca-fg-1);
  overflow-wrap: anywhere;
}

.mt__meta {
  margin: 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.mt__themes {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--ca-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mt__theme {
  padding: 2px var(--ca-space-2);
  border-radius: 999px;
  background: var(--ca-bg-surface-2);
  color: var(--ca-fg-2);
  line-height: 1.4;
}

.mt__theme--s1 {
  font-size: var(--ca-text-200);
}

.mt__theme--s2 {
  font-size: var(--ca-text-300);
}

.mt__theme--s3 {
  font-size: var(--ca-text-400);
  color: var(--ca-fg-1);
}

.mt__theme--s4 {
  font-size: var(--ca-text-500);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-color-brand);
}

.mt__types {
  margin-top: auto;
}
</style>
