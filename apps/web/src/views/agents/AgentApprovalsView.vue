<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  decideApproval,
  listApprovals,
  type ApprovalRow,
} from '@/api/agents';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { usePagedList } from '@/composables/usePagedList';
import { formatDateTime } from '@/utils/format';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaField,
  CaPageHeader,
  CaPagination,
  CaSelect,
  CaTable,
  CaTextarea,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canApprove = computed(() => auth.can('agents.approve'));

const statusFilter = ref('pending');

const statusOptions = computed<CaSelectOption[]>(() => [
  { value: 'pending', label: t('agents.approvalPending') },
  { value: 'approved', label: t('agents.approvalApproved') },
  { value: 'rejected', label: t('agents.approvalRejected') },
  { value: '', label: t('common.all') },
]);

const { items, total, page, pageSize, loading, error, load, setFilter, goPage } =
  usePagedList<ApprovalRow>(listApprovals, { pageSize: 25 });

function applyFilter(): void {
  setFilter({ status: statusFilter.value || undefined });
}

watch(statusFilter, () => applyFilter());
onMounted(() => void load());

const columns = computed<CaTableColumn[]>(() => {
  const cols: CaTableColumn[] = [
    { key: 'summary', label: t('agents.columnSummary') },
    { key: 'agent', label: t('agents.columnAgent') },
    { key: 'requester', label: t('agents.columnRequester') },
    { key: 'status', label: t('agents.columnStatus') },
    { key: 'created', label: t('agents.columnCreated'), sortValue: (row) => row.created_at },
  ];
  if (canApprove.value) cols.push({ key: 'actions', label: t('table.actions'), sortable: false });
  return cols;
});

function statusVariant(row: ApprovalRow): 'success' | 'danger' | 'warning' | 'neutral' {
  if (row.status === 'approved') return 'success';
  if (row.status === 'rejected') return 'danger';
  return 'warning';
}

function statusLabel(row: ApprovalRow): string {
  if (row.status === 'approved') return t('agents.approvalApproved');
  if (row.status === 'rejected') return t('agents.approvalRejected');
  return t('agents.approvalPending');
}

// --- Dialog putusan ---
const decideOpen = ref(false);
const decideSaving = ref(false);
const decideError = ref('');
const decideTarget = ref<ApprovalRow | null>(null);
const decideAction = ref<'approved' | 'rejected'>('approved');
const decideNote = ref('');

function openDecide(row: ApprovalRow, action: 'approved' | 'rejected'): void {
  decideTarget.value = row;
  decideAction.value = action;
  decideNote.value = '';
  decideError.value = '';
  decideOpen.value = true;
}

async function submitDecide(): Promise<void> {
  if (!decideTarget.value) return;
  decideError.value = '';
  decideSaving.value = true;
  try {
    await decideApproval(decideTarget.value.id, {
      decision: decideAction.value,
      note: decideNote.value.trim() || undefined,
    });
    toast.push({
      variant: decideAction.value === 'approved' ? 'success' : 'info',
      title:
        decideAction.value === 'approved'
          ? t('agents.approvalApprovedToast')
          : t('agents.approvalRejectedToast'),
    });
    decideOpen.value = false;
    await load();
  } catch (caught) {
    decideError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    decideSaving.value = false;
  }
}
</script>

<template>
  <div>
    <CaPageHeader
      :title="t('agents.approvalsTitle')"
      :description="t('agents.approvalsDescription')"
    />

    <div class="admin-filters">
      <CaSelect
        v-model="statusFilter"
        class="admin-filters__field"
        :options="statusOptions"
        :aria-label="t('agents.columnStatus')"
      />
      <CaButton variant="secondary" @click="applyFilter">{{ t('common.apply') }}</CaButton>
    </div>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <CaTable
      table-key="agent-approvals"
      :columns="columns"
      :rows="items"
      :row-key="(row) => row.id"
      :loading="loading"
      :empty-title="t('agents.approvalsEmpty')"
    >
      <template #cell-summary="{ row }">
        <span class="appr-summary">{{ row.summary }}</span>
      </template>
      <template #cell-agent="{ row }">
        {{ row.agent_name ?? '—' }}
      </template>
      <template #cell-requester="{ row }">
        <div class="appr-requester">
          <span>{{ row.requester_email ?? '—' }}</span>
          <span v-if="row.decided_by_email" class="appr-requester__sub">
            {{ t('agents.decidedBy') }}: {{ row.decided_by_email }}
          </span>
        </div>
      </template>
      <template #cell-status="{ row }">
        <CaBadge :variant="statusVariant(row as ApprovalRow)" size="small">
          {{ statusLabel(row as ApprovalRow) }}
        </CaBadge>
      </template>
      <template #cell-created="{ row }">
        {{ formatDateTime(row.created_at) }}
      </template>
      <template #cell-actions="{ row }">
        <div v-if="(row as ApprovalRow).status === 'pending'" class="appr-actions">
          <CaButton size="small" variant="primary" @click="openDecide(row as ApprovalRow, 'approved')">
            {{ t('agents.approveAction') }}
          </CaButton>
          <CaButton size="small" variant="danger" @click="openDecide(row as ApprovalRow, 'rejected')">
            {{ t('agents.rejectAction') }}
          </CaButton>
        </div>
      </template>
    </CaTable>

    <CaPagination :page="page" :limit="pageSize" :total="total" @change="goPage" />

    <CaDialog
      v-model:open="decideOpen"
      :title="decideAction === 'approved' ? t('agents.approveTitle') : t('agents.rejectTitle')"
      :subtitle="decideTarget?.summary ?? ''"
    >
      <p v-if="decideError" class="admin-error" role="alert">{{ decideError }}</p>
      <form class="admin-form" @submit.prevent="submitDecide">
        <CaField :label="t('agents.decisionNote')">
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="decideNote" :aria-describedby="describedBy" :rows="3" />
          </template>
        </CaField>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="decideOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton
          :variant="decideAction === 'approved' ? 'primary' : 'danger'"
          :loading="decideSaving"
          @click="submitDecide"
        >
          {{
            decideAction === 'approved' ? t('agents.approveAction') : t('agents.rejectAction')
          }}
        </CaButton>
      </template>
    </CaDialog>
  </div>
</template>

<style scoped>
.appr-summary {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.appr-requester {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.appr-requester__sub {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.appr-actions {
  display: flex;
  gap: var(--ca-space-3);
}
</style>
