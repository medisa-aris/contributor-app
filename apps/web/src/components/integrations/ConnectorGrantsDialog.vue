<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import { listDepartments, listGroups, listRoles, listUsers } from '@/api/admin/access';
import type { AdminDepartmentNode } from '@/api/admin/types';
import {
  addConnectorGrant,
  deleteConnectorGrant,
  listConnectorGrants,
  listDbTables,
  type ConnectorAccess,
  type ConnectorGrantRow,
  type ConnectorType,
  type GrantSubjectType,
} from '@/api/connectors';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaField,
  CaSelect,
  CaSpinner,
  CaTextarea,
  type CaSelectOption,
} from '@/components/ui';

const props = defineProps<{
  connectorType: ConnectorType;
  connectorId: string;
  connectorName: string;
  /** Konektor database yang tidak mengizinkan tulis: opsi read_write tetap boleh tetapi diberi catatan. */
  allowWrite?: boolean;
  canConfigure: boolean;
}>();

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const toast = useToastStore();

const grants = ref<ConnectorGrantRow[]>([]);
const loading = ref(false);
const error = ref('');
const saving = ref(false);

const subjectType = ref<GrantSubjectType>('department');
const subjectId = ref('');
const access = ref<ConnectorAccess>('read');
const allowlistText = ref('');
const subjectOptions = ref<Record<GrantSubjectType, CaSelectOption[]>>({
  user: [],
  role: [],
  department: [],
  group: [],
});
const tables = ref<string[]>([]);

const subjectTypeOptions = computed<CaSelectOption[]>(() => [
  { value: 'department', label: t('connectors.subjectDepartment') },
  { value: 'role', label: t('connectors.subjectRole') },
  { value: 'group', label: t('connectors.subjectGroup') },
  { value: 'user', label: t('connectors.subjectUser') },
]);

const accessOptions = computed<CaSelectOption[]>(() => [
  { value: 'read', label: t('connectors.accessRead') },
  { value: 'read_write', label: t('connectors.accessReadWrite') },
]);

function flattenDepartments(nodes: AdminDepartmentNode[], depth = 0): CaSelectOption[] {
  return nodes.flatMap((node) => [
    { value: node.id, label: `${'— '.repeat(depth)}${node.name} (${node.code})` },
    ...flattenDepartments(node.children ?? [], depth + 1),
  ]);
}

async function loadSubjects(): Promise<void> {
  const [users, roles, groups, departments] = await Promise.allSettled([
    listUsers({ page: 1, pageSize: 100 }),
    listRoles(),
    listGroups(),
    listDepartments(),
  ]);
  subjectOptions.value = {
    user:
      users.status === 'fulfilled'
        ? users.value.items.map((u) => ({ value: u.id, label: `${u.display_name} <${u.email}>` }))
        : [],
    role: roles.status === 'fulfilled' ? roles.value.map((r) => ({ value: r.id, label: r.name })) : [],
    group: groups.status === 'fulfilled' ? groups.value.map((g) => ({ value: g.id, label: g.name })) : [],
    department: departments.status === 'fulfilled' ? flattenDepartments(departments.value) : [],
  };
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    grants.value = await listConnectorGrants(props.connectorType, props.connectorId);
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

watch([open, () => props.connectorId], async ([value]) => {
  if (!value) return;
  subjectId.value = '';
  access.value = 'read';
  allowlistText.value = '';
  tables.value = [];
  await Promise.all([load(), props.canConfigure ? loadSubjects() : Promise.resolve()]);
  if (props.connectorType === 'database' && props.canConfigure) {
    listDbTables(props.connectorId)
      .then((rows) => {
        tables.value = rows.map((row) => (row.schema ? `${row.schema}.${row.name}` : row.name));
      })
      .catch(() => {
        tables.value = [];
      });
  }
}, { immediate: true });

watch(subjectType, () => {
  subjectId.value = '';
});

const subjectTypeLabel = (type: GrantSubjectType) =>
  subjectTypeOptions.value.find((option) => option.value === type)?.label ?? type;

async function submit(): Promise<void> {
  if (!subjectId.value) {
    error.value = t('connectors.subjectRequired');
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const allowlist = allowlistText.value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    grants.value = await addConnectorGrant(props.connectorType, props.connectorId, {
      subjectType: subjectType.value,
      subjectId: subjectId.value,
      access: access.value,
      ...(allowlist.length > 0 ? { tableAllowlist: allowlist } : {}),
    });
    subjectId.value = '';
    allowlistText.value = '';
    toast.push({ variant: 'success', title: t('connectors.grantSaved') });
    emit('changed');
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function revoke(grant: ConnectorGrantRow): Promise<void> {
  if (!window.confirm(t('connectors.revokeConfirm', { name: grant.subject_label ?? grant.subject_id }))) return;
  try {
    await deleteConnectorGrant(props.connectorType, props.connectorId, grant.id);
    grants.value = grants.value.filter((g) => g.id !== grant.id);
    toast.push({ variant: 'success', title: t('connectors.grantRevoked') });
    emit('changed');
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

function addTable(table: string): void {
  const current = allowlistText.value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!current.includes(table)) current.push(table);
  allowlistText.value = current.join('\n');
}
</script>

<template>
  <CaDialog
    v-model:open="open"
    size="large"
    :title="t('connectors.grantsTitle', { name: connectorName })"
    :subtitle="t('connectors.grantsSubtitle')"
  >
    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="grants__loading"><CaSpinner /></div>
    <template v-else>
      <p v-if="grants.length === 0" class="grants__empty">{{ t('connectors.noGrants') }}</p>
      <ul v-else class="grants__list">
        <li v-for="grant in grants" :key="grant.id" class="grants__item">
          <div class="grants__who">
            <CaBadge size="small">{{ subjectTypeLabel(grant.subject_type) }}</CaBadge>
            <span class="grants__name">{{ grant.subject_label ?? grant.subject_id }}</span>
          </div>
          <div class="grants__meta">
            <CaBadge :variant="grant.access === 'read_write' ? 'warning' : 'informative'" size="small">
              {{ grant.access === 'read_write' ? t('connectors.accessReadWrite') : t('connectors.accessRead') }}
            </CaBadge>
            <span v-if="grant.table_allowlist?.length" class="grants__tables">
              {{ t('connectors.tablesOnly', { tables: grant.table_allowlist.join(', ') }) }}
            </span>
            <CaButton v-if="canConfigure" size="small" variant="danger" @click="revoke(grant)">
              {{ t('connectors.revoke') }}
            </CaButton>
          </div>
        </li>
      </ul>
    </template>

    <form v-if="canConfigure" class="admin-form grants__form" @submit.prevent="submit">
      <h3 class="grants__heading">{{ t('connectors.addGrant') }}</h3>
      <div class="grants__row">
        <CaField :label="t('connectors.subjectType')">
          <template #default="{ id }">
            <CaSelect :id="id" v-model="subjectType" :options="subjectTypeOptions" />
          </template>
        </CaField>
        <CaField :label="t('connectors.subject')" required>
          <template #default="{ id }">
            <CaSelect
              :id="id"
              v-model="subjectId"
              :options="subjectOptions[subjectType]"
              :placeholder="t('connectors.subjectPlaceholder')"
            />
          </template>
        </CaField>
        <CaField :label="t('connectors.access')">
          <template #default="{ id }">
            <CaSelect :id="id" v-model="access" :options="accessOptions" />
          </template>
        </CaField>
      </div>
      <p v-if="subjectType === 'department'" class="grants__hint">{{ t('connectors.departmentHint') }}</p>
      <p v-if="access === 'read_write'" class="grants__hint grants__hint--warn">
        {{ allowWrite === false ? t('connectors.writeDisabledHint') : t('connectors.writeHint') }}
      </p>
      <CaField
        v-if="connectorType === 'database'"
        :label="t('connectors.tableAllowlist')"
        :hint="t('connectors.tableAllowlistHint')"
      >
        <template #default="{ id, describedBy }">
          <CaTextarea :id="id" v-model="allowlistText" :aria-describedby="describedBy" :rows="3" />
        </template>
      </CaField>
      <div v-if="tables.length" class="grants__chips">
        <button v-for="table in tables.slice(0, 60)" :key="table" type="button" class="grants__chip" @click="addTable(table)">
          + {{ table }}
        </button>
      </div>
    </form>

    <template #footer>
      <CaButton variant="secondary" @click="open = false">{{ t('common.close') }}</CaButton>
      <CaButton v-if="canConfigure" variant="primary" :loading="saving" @click="submit">
        {{ t('connectors.grantSubmit') }}
      </CaButton>
    </template>
  </CaDialog>
</template>

<style scoped>
.grants__loading {
  padding: var(--ca-space-6) 0;
  display: flex;
  justify-content: center;
}

.grants__empty {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-300);
}

.grants__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.grants__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
  padding: var(--ca-space-3) var(--ca-space-4);
  border: 1px solid var(--ca-border-subtle, var(--ca-border));
  border-radius: var(--ca-radius-medium, 8px);
}

.grants__who,
.grants__meta {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  flex-wrap: wrap;
}

.grants__name {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.grants__tables {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  font-family: var(--ca-font-family-monospace, monospace);
}

.grants__form {
  margin-top: var(--ca-space-6);
  padding-top: var(--ca-space-4);
  border-top: 1px solid var(--ca-border-subtle, var(--ca-border));
}

.grants__heading {
  margin: 0;
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-semibold);
}

.grants__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--ca-space-4);
}

.grants__hint {
  margin: 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.grants__hint--warn {
  color: var(--ca-fg-warning, var(--ca-fg-2));
}

.grants__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
  max-height: 120px;
  overflow-y: auto;
}

.grants__chip {
  border: 1px dashed var(--ca-border);
  background: transparent;
  color: var(--ca-fg-2);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: var(--ca-text-200);
  font-family: var(--ca-font-family-monospace, monospace);
  cursor: pointer;
}

.grants__chip:hover {
  border-style: solid;
  color: var(--ca-fg-1);
}
</style>
