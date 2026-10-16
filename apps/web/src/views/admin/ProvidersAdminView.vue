<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getProviders, type AdminProvidersOverview } from '@/api/admin';
import {
  CaBadge,
  CaCard,
  CaPageHeader,
  CaSpinner,
} from '@/components/ui';

const { t } = useI18n();

const overview = ref<AdminProvidersOverview | null>(null);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    overview.value = await getProviders();
  } catch {
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.providers.title')"
      :description="t('admin.providers.description')"
    />

    <div v-if="loading" class="prv-loading"><CaSpinner size="large" /></div>
    <p v-else-if="error" class="admin-error">{{ error }}</p>

    <template v-else-if="overview">
      <p class="prv-default">
        {{ t('admin.providers.defaultProviderLabel') }}:
        <span class="admin-mono">{{ overview.defaultProvider }}</span>
      </p>

      <div class="prv-grid">
        <CaCard v-for="provider in overview.providers" :key="provider.name">
          <div class="prv-card">
            <div class="prv-card__head">
              <h2 class="prv-card__name">{{ provider.name }}</h2>
              <div class="prv-card__badges">
                <CaBadge v-if="provider.isDefault" variant="brand">
                  {{ t('admin.providers.defaultBadge') }}
                </CaBadge>
                <CaBadge :variant="provider.configured ? 'success' : 'neutral'">
                  {{ provider.configured ? t('admin.providers.configuredBadge') : t('admin.providers.notConfiguredBadge') }}
                </CaBadge>
              </div>
            </div>

            <dl v-if="provider.configured" class="prv-meta">
              <div class="prv-meta__row">
                <dt>{{ t('admin.providers.model') }}</dt>
                <dd class="admin-mono">{{ provider.model ?? '—' }}</dd>
              </div>
              <div class="prv-meta__row">
                <dt>{{ t('admin.providers.baseUrl') }}</dt>
                <dd class="admin-mono">{{ provider.baseUrl ?? '—' }}</dd>
              </div>
            </dl>
            <p v-else class="prv-hint">{{ t('admin.providers.notConfiguredHint') }}</p>
          </div>
        </CaCard>
      </div>
    </template>
  </section>
</template>

<style scoped>
.prv-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-24) 0;
}

.prv-default {
  margin: 0 0 var(--ca-space-8);
  color: var(--ca-fg-2);
  font-size: var(--ca-text-200);
}

.prv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--ca-space-8);
}

.prv-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-6);
  flex-wrap: wrap;
}

.prv-card__name {
  margin: 0;
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
  text-transform: capitalize;
}

.prv-card__badges {
  display: flex;
  gap: var(--ca-space-4);
}

.prv-meta {
  margin: var(--ca-space-6) 0 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.prv-meta__row {
  display: flex;
  gap: var(--ca-space-6);
  font-size: var(--ca-text-200);
}

.prv-meta__row dt {
  width: 90px;
  flex-shrink: 0;
  color: var(--ca-fg-3);
}

.prv-meta__row dd {
  margin: 0;
  color: var(--ca-fg-1);
  word-break: break-all;
}

.prv-hint {
  margin: var(--ca-space-6) 0 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}
</style>
