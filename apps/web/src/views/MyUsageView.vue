<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatTokens, myModels, myUsage, setPreferredModel, type MyUsageRow, type UserModelDto } from '@/api/models';
import { ApiError } from '@/api/http';
import { useToastStore } from '@/stores/toast.store';
import { CaBadge, CaEmptyState, CaField, CaPageHeader, CaSelect, CaSpinner } from '@/components/ui';

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(true);
const failed = ref(false);
const rows = ref<MyUsageRow[]>([]);
const models = ref<UserModelDto[]>([]);
const preferred = ref('');

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    const [usage, mine] = await Promise.all([myUsage(), myModels()]);
    rows.value = usage.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.week - a.week);
    models.value = mine.models;
    preferred.value = mine.preferredModelId ?? '';
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

const preferredOptions = computed(() => [
  { value: '', label: t('models.usage.followDefault') },
  ...models.value.map((m) => ({ value: m.id, label: m.displayName })),
]);

async function savePreferred(value: string): Promise<void> {
  try {
    await setPreferredModel(value || null);
    preferred.value = value;
    toast.push({ variant: 'success', title: t('models.picker.preferredSaved') }, 3000);
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') }, 5000);
  }
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function percent(used: number, limit: number): number {
  return Math.min(100, Math.round((used / limit) * 100));
}

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader :title="t('models.usage.title')" :description="t('models.usage.description')" />
    <div v-if="loading" class="usg-loading"><CaSpinner size="large" /></div>
    <p v-else-if="failed" class="admin-error">{{ t('errors.loadFailed') }}</p>
    <template v-else>
      <section class="ca-panel usg-pref">
        <CaField :label="t('models.usage.preferred')" :hint="t('models.usage.preferredHint')">
          <template #default="{ id }">
            <CaSelect :id="id" :model-value="preferred" :options="preferredOptions" @update:model-value="savePreferred" />
          </template>
        </CaField>
      </section>

      <CaEmptyState v-if="rows.length === 0" :title="t('models.usage.empty')" />
      <div v-else class="usg-list">
        <article v-for="row in rows" :key="row.modelId" class="ca-panel usg-card">
          <header class="usg-card__head">
            <strong>{{ row.displayName }}</strong>
            <CaBadge v-if="row.isDefault" variant="brand" size="small">{{ t('models.picker.defaultLimited') }}</CaBadge>
            <CaBadge v-if="!row.allowed" variant="warning" size="small">{{ t('models.usage.notAllowed') }}</CaBadge>
            <span v-if="row.estimated" class="usg-muted">{{ t('models.usage.estimated') }}</span>
          </header>
          <dl class="usg-stats">
            <div>
              <dt>{{ t('models.usage.columns.today') }}</dt>
              <dd>{{ formatTokens(row.today) }}</dd>
            </div>
            <div>
              <dt>{{ t('models.usage.columns.week') }}</dt>
              <dd>{{ formatTokens(row.week) }}</dd>
            </div>
          </dl>
          <p v-if="row.quotas.length === 0" class="usg-muted">{{ t('models.usage.unlimited') }}</p>
          <div v-for="quota in row.quotas" :key="quota.period" class="usg-quota">
            <div class="usg-quota__label">
              <span>{{ quota.period === 'day' ? t('models.usage.today') : t('models.usage.thisWeek') }}</span>
              <span>{{ formatTokens(quota.used) }} / {{ formatTokens(quota.limit) }}</span>
            </div>
            <div
              class="usg-bar"
              role="progressbar"
              :aria-valuenow="percent(quota.used, quota.limit)"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span
                class="usg-bar__fill"
                :class="{
                  'usg-bar__fill--warn': percent(quota.used, quota.limit) >= 80,
                  'usg-bar__fill--full': percent(quota.used, quota.limit) >= 100,
                }"
                :style="{ width: `${percent(quota.used, quota.limit)}%` }"
              />
            </div>
            <p class="usg-muted">
              {{ t('models.usage.resets', { when: formatWhen(quota.resetsAt) }) }} · {{ quota.sourceLabel }}
            </p>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.usg-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-8);
}
.usg-pref {
  margin-bottom: var(--ca-space-5);
  max-width: 520px;
}
.usg-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--ca-space-4);
}
.usg-card {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}
.usg-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-2);
}
.usg-stats {
  display: flex;
  gap: var(--ca-space-6);
  margin: 0;
}
.usg-stats dt {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}
.usg-stats dd {
  margin: 0;
  font-size: var(--ca-text-500, 1.25rem);
  font-weight: 600;
}
.usg-muted {
  margin: 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}
.usg-quota {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.usg-quota__label {
  display: flex;
  justify-content: space-between;
  font-size: var(--ca-text-200);
}
.usg-bar {
  height: 8px;
  border-radius: 999px;
  background: var(--ca-bg-surface-3);
  overflow: hidden;
}
.usg-bar__fill {
  display: block;
  height: 100%;
  background: var(--ca-color-brand, #16a34a);
}
.usg-bar__fill--warn {
  background: #d97706;
}
.usg-bar__fill--full {
  background: var(--ca-fg-danger, #b3261e);
}
</style>
