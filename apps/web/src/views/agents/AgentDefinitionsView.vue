<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  createAgent,
  deleteAgent,
  listAgents,
  updateAgent,
  type AgentRow,
} from '@/api/agents';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { usePagedList } from '@/composables/usePagedList';
import { formatDateTime } from '@/utils/format';
import {
  CaBadge,
  CaButton,
  CaCheckbox,
  CaDialog,
  CaField,
  CaInput,
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

const canManage = computed(
  () =>
    auth.can('agents.create') || auth.can('agents.update') || auth.can('agents.delete'),
);
const canExecute = computed(() => auth.can('agents.execute'));

const { items, total, page, pageSize, loading, error, load, goPage } = usePagedList<AgentRow>(
  listAgents,
  { pageSize: 25 },
);

const columns = computed<CaTableColumn[]>(() => {
  const cols: CaTableColumn[] = [
    { key: 'name', label: t('agents.columnName'), sortValue: (row) => row.name },
    { key: 'approval', label: t('agents.columnApproval') },
    { key: 'tasks', label: t('agents.columnTasks'), align: 'end' as const },
    { key: 'status', label: t('agents.columnStatus') },
    { key: 'updated', label: t('agents.columnUpdated'), sortValue: (row) => row.updated_at },
  ];
  if (canManage.value) cols.push({ key: 'actions', label: t('table.actions'), sortable: false });
  return cols;
});

onMounted(() => void load());

// --- Dialog buat/ubah agen ---
const editOpen = ref(false);
const editSaving = ref(false);
const editError = ref('');
const editTarget = ref<AgentRow | null>(null);
const editForm = ref({
  code: '',
  name: '',
  description: '',
  instruction: '',
  tools: '',
  requireApproval: false,
  status: 'active' as 'active' | 'inactive',
});

function openCreate(): void {
  editTarget.value = null;
  editForm.value = {
    code: '',
    name: '',
    description: '',
    instruction: '',
    tools: '',
    requireApproval: false,
    status: 'active',
  };
  editError.value = '';
  editOpen.value = true;
}

function openEdit(row: AgentRow): void {
  editTarget.value = row;
  editForm.value = {
    code: row.code,
    name: row.name,
    description: row.description ?? '',
    instruction: row.instruction,
    tools: row.tool_allowlist.join(', '),
    requireApproval: row.require_approval,
    status: row.status,
  };
  editError.value = '';
  editOpen.value = true;
}

const statusOptions = computed<CaSelectOption[]>(() => [
  { value: 'active', label: t('agents.statusActive') },
  { value: 'inactive', label: t('agents.statusInactive') },
]);

async function submitEdit(): Promise<void> {
  editError.value = '';
  const tools = editForm.value.tools
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (editForm.value.name.trim().length < 3 || editForm.value.instruction.trim().length < 10) {
    editError.value = t('errors.requiredFields');
    return;
  }
  if (!editTarget.value && editForm.value.code.trim().length < 3) {
    editError.value = t('errors.requiredFields');
    return;
  }
  editSaving.value = true;
  try {
    if (editTarget.value) {
      await updateAgent(editTarget.value.id, {
        name: editForm.value.name.trim(),
        description: editForm.value.description.trim() || undefined,
        instruction: editForm.value.instruction.trim(),
        toolAllowlist: tools,
        requireApproval: editForm.value.requireApproval,
        status: editForm.value.status,
      });
      toast.push({ variant: 'success', title: t('agents.agentUpdated') });
    } else {
      await createAgent({
        code: editForm.value.code.trim(),
        name: editForm.value.name.trim(),
        description: editForm.value.description.trim() || undefined,
        instruction: editForm.value.instruction.trim(),
        toolAllowlist: tools,
        requireApproval: editForm.value.requireApproval,
      });
      toast.push({ variant: 'success', title: t('agents.agentCreated') });
    }
    editOpen.value = false;
    await load();
  } catch (caught) {
    editError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    editSaving.value = false;
  }
}

async function removeAgent(row: AgentRow): Promise<void> {
  try {
    await deleteAgent(row.id);
    toast.push({ variant: 'success', title: t('agents.agentDeleted') });
    await load();
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

function statusVariant(row: AgentRow): 'success' | 'neutral' {
  return row.status === 'active' ? 'success' : 'neutral';
}

function statusLabel(row: AgentRow): string {
  return row.status === 'active' ? t('agents.statusActive') : t('agents.statusInactive');
}
</script>

<template>
  <div>
    <CaPageHeader
      :title="t('agents.definitionsTitle')"
      :description="t('agents.definitionsDescription')"
    >
      <template #actions>
        <CaButton v-if="canManage" variant="primary" @click="openCreate">
          {{ t('agents.addAgent') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <CaTable
      table-key="agent-definitions"
      :columns="columns"
      :rows="items"
      :row-key="(row) => row.id"
      :loading="loading"
      :empty-title="t('table.empty')"
    >
      <template #cell-name="{ row }">
        <div class="agents-cell">
          <span class="agents-cell__name">{{ row.name }}</span>
          <span class="agents-cell__sub">{{ row.code }}</span>
        </div>
      </template>
      <template #cell-approval="{ row }">
        <CaBadge :variant="row.require_approval ? 'warning' : 'neutral'" size="small">
          {{
            row.require_approval ? t('agents.approvalRequired') : t('agents.approvalNotRequired')
          }}
        </CaBadge>
      </template>
      <template #cell-tasks="{ row }">
        {{ row.task_count ?? 0 }}
      </template>
      <template #cell-status="{ row }">
        <CaBadge :variant="statusVariant(row)" size="small">{{ statusLabel(row) }}</CaBadge>
      </template>
      <template #cell-updated="{ row }">
        {{ formatDateTime(row.updated_at) }}
      </template>
      <template #cell-actions="{ row }">
        <div class="agents-row-actions">
          <CaButton
            v-if="canExecute && row.status === 'active'"
            size="small"
            variant="secondary"
            :to="`/agents/operations?agent=${row.id}`"
          >
            {{ t('agents.runAction') }}
          </CaButton>
          <CaButton size="small" variant="secondary" @click="openEdit(row as AgentRow)">
            {{ t('common.edit') }}
          </CaButton>
          <CaButton size="small" variant="danger" @click="removeAgent(row as AgentRow)">
            {{ t('common.delete') }}
          </CaButton>
        </div>
      </template>
    </CaTable>

    <CaPagination :page="page" :limit="pageSize" :total="total" @change="goPage" />

    <CaDialog
      v-model:open="editOpen"
      :title="editTarget ? t('agents.editAgentTitle') : t('agents.createAgentTitle')"
      :subtitle="editTarget ? editTarget.code : t('agents.createAgentSubtitle')"
    >
      <p v-if="editError" class="admin-error" role="alert">{{ editError }}</p>
      <form class="admin-form" @submit.prevent="submitEdit">
        <CaField v-if="!editTarget" :label="t('agents.formCode')" :hint="t('knowledge.formSourceCodeHint')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="editForm.code" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('agents.formName')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="editForm.name" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('agents.formDescription')">
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="editForm.description" :aria-describedby="describedBy" :rows="2" />
          </template>
        </CaField>
        <CaField :label="t('agents.formInstruction')" :hint="t('agents.formInstructionHint')" required>
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="editForm.instruction" :aria-describedby="describedBy" :rows="6" />
          </template>
        </CaField>
        <CaField :label="t('agents.formTools')" :hint="t('agents.formToolsHint')">
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="editForm.tools" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField v-if="editTarget" :label="t('agents.columnStatus')">
          <template #default="{ id, describedBy }">
            <CaSelect :id="id" v-model="editForm.status" :aria-describedby="describedBy" :options="statusOptions" />
          </template>
        </CaField>
        <CaCheckbox v-model="editForm.requireApproval">
          {{ t('agents.formRequireApproval') }}
        </CaCheckbox>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="editOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="editSaving" @click="submitEdit">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>
  </div>
</template>

<style scoped>
.agents-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agents-cell__name {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.agents-cell__sub {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  font-family: var(--ca-font-family-monospace, monospace);
}

.agents-row-actions {
  display: flex;
  gap: var(--ca-space-3);
  flex-wrap: wrap;
}
</style>
