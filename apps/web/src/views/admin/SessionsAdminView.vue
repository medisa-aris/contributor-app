<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { listSessions, revokeSession, type AdminSessionRow } from '@/api/admin';
import { usePagedList } from '@/composables/usePagedList';
import { useToastStore } from '@/stores/toast.store';
import {
  CaButton,
  CaDialog,
  CaPageHeader,
  CaPagination,
  CaTable,
  type CaTableColumn,
} from '@/components/ui';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const toast = useToastStore();

const { items, total, page, pageSize, loading, error, load, goPage } =
  usePagedList<AdminSessionRow>(listSessions, { pageSize: 25 });

const columns = computed<CaTableColumn[]>(() => [
  { key: 'user', label: t('admin.sessions.columnUser') },
  { key: 'ip', label: t('admin.sessions.columnIp'), width: '140px' },
  { key: 'user_agent', label: t('admin.sessions.columnAgent') },
  { key: 'created_at', label: t('admin.sessions.columnCreated'), width: '170px' },
  { key: 'last_seen_at', label: t('admin.sessions.columnLastSeen'), width: '170px' },
  { key: 'expires_at', label: t('admin.sessions.columnExpires'), width: '170px' },
  { key: 'actions', label: '', width: '90px', align: 'end' as const },
]);

function agentSummary(value: string | null): string {
  if (!value) return '—';
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

const confirming = ref<AdminSessionRow | null>(null);
const showConfirm = ref(false);
const saving = ref(false);

function openRevoke(row: AdminSessionRow) {
  confirming.value = row;
  showConfirm.value = true;
}

async function confirmRevoke() {
  if (!confirming.value) return;
  saving.value = true;
  try {
    await revokeSession(confirming.value.id);
    toast.push({ variant: 'success', title: t('admin.sessions.revoked') });
    showConfirm.value = false;
    await load();
  } catch {
    toast.push({ variant: 'danger', title: t('errors.saveFailed') });
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.sessions.title')"
      :description="t('admin.sessions.description')"
    />

    <p v-if="error" class="admin-error">{{ error }}</p>

    <CaTable
      :columns="columns"
      :rows="items"
      :row-key="(row) => row.id"
      :loading="loading"
      :empty-title="t('admin.sessions.empty')"
    >
      <template #cell-user="{ row }">
        <span class="ses-user">{{ row.display_name }}</span>
        <div class="admin-cell__sub">{{ row.email }}</div>
      </template>
      <template #cell-ip="{ row }">
        <span class="admin-mono">{{ row.ip ?? '—' }}</span>
      </template>
      <template #cell-user_agent="{ row }">
        <span class="ses-agent">{{ agentSummary(row.user_agent) }}</span>
      </template>
      <template #cell-created_at="{ row }">
        {{ formatDateTime(row.created_at) }}
      </template>
      <template #cell-last_seen_at="{ row }">
        {{ formatDateTime(row.last_seen_at) }}
      </template>
      <template #cell-expires_at="{ row }">
        {{ formatDateTime(row.expires_at) }}
      </template>
      <template #cell-actions="{ row }">
        <CaButton size="small" variant="subtle" @click="openRevoke(row)">
          {{ t('admin.sessions.revokeAction') }}
        </CaButton>
      </template>
    </CaTable>

    <CaPagination :page="page" :limit="pageSize" :total="total" @change="goPage" />

    <CaDialog
      v-model:open="showConfirm"
      :title="t('admin.sessions.revokeTitle')"
      size="small"
    >
      <p class="ses-confirm-text">
        {{ t('admin.sessions.revokeConfirm', { name: confirming?.display_name ?? '' }) }}
      </p>
      <template #footer>
        <CaButton variant="subtle" @click="showConfirm = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="danger" :disabled="saving" @click="confirmRevoke">
          {{ t('admin.sessions.revokeAction') }}
        </CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.ses-user {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.ses-agent {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-2);
}

.ses-confirm-text {
  margin: 0;
  color: var(--ca-fg-2);
}
</style>
