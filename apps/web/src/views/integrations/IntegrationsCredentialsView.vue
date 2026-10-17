<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import { getCredentialStatus, type CredentialStatusRow } from '@/api/integrations';
import { useAuthStore } from '@/stores/auth.store';
import {
  CaBadge,
  CaCard,
  CaPageHeader,
  CaSpinner,
  CaTable,
  type CaTableColumn,
} from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();

const credentials = ref<CredentialStatusRow[]>([]);
const loading = ref(true);
const error = ref('');

const columns = computed<CaTableColumn[]>(() => [
  { key: 'env', label: t('integrations.columnEnv') },
  { key: 'configured', label: t('integrations.columnCredentialStatus') },
]);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    credentials.value = await getCredentialStatus();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (auth.can('integrations.view')) void load();
});
</script>

<template>
  <div>
    <CaPageHeader
      :title="t('integrations.credentialsTitle')"
      :description="t('integrations.credentialsDescription')"
    />

    <div v-if="loading" class="cred-loading"><CaSpinner /></div>
    <p v-else-if="error" class="admin-error" role="alert">{{ error }}</p>

    <template v-else>
      <CaCard>
        <div class="cred-policy">
          <h2 class="cred-policy__heading">{{ t('integrations.policyHeading') }}</h2>
          <ul class="cred-policy__list">
            <li>{{ t('integrations.policyItem1') }}</li>
            <li>{{ t('integrations.policyItem2') }}</li>
            <li>{{ t('integrations.policyItem3') }}</li>
            <li>{{ t('integrations.policyItem4') }}</li>
          </ul>
        </div>
      </CaCard>

      <CaTable
        class="cred-table"
        table-key="integration-credentials"
        :columns="columns"
        :rows="credentials"
        :row-key="(row) => row.env"
        :loading="false"
        :empty-title="t('table.empty')"
      >
        <template #cell-env="{ row }">
          <span class="admin-mono">{{ row.env }}</span>
        </template>
        <template #cell-configured="{ row }">
          <CaBadge :variant="row.configured ? 'success' : 'neutral'" size="small">
            {{
              row.configured ? t('integrations.configuredBadge') : t('integrations.missingBadge')
            }}
          </CaBadge>
        </template>
      </CaTable>
    </template>
  </div>
</template>

<style scoped>
.cred-loading {
  padding: var(--ca-space-10) 0;
}

.cred-policy__heading {
  margin: 0 0 var(--ca-space-3);
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.cred-policy__list {
  margin: 0;
  padding-left: var(--ca-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
  font-size: var(--ca-text-300);
  color: var(--ca-fg-2);
}

.cred-table {
  margin-top: var(--ca-space-8);
}
</style>
