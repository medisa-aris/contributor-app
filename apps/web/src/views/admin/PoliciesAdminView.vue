<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  createPolicy,
  deletePolicy,
  listGroups,
  listPolicies,
  listRoles,
  listUsers,
  updatePolicy,
  type AdminPolicyRow,
  type PolicyEffect,
  type PolicySubjectType,
} from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaSelect,
  CaSwitch,
  CaTable,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canManage = computed(() => auth.can('rbac.policies.manage'));

const rows = ref<AdminPolicyRow[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await listPolicies();
  } catch {
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

const columns = computed<CaTableColumn[]>(() => {
  const base: CaTableColumn[] = [
    { key: 'name', label: t('admin.policies.columnName') },
    { key: 'effect', label: t('admin.policies.columnEffect'), width: '90px' },
    { key: 'subject', label: t('admin.policies.columnSubject') },
    { key: 'permission_pattern', label: t('admin.policies.columnPattern') },
    { key: 'priority', label: t('admin.policies.columnPriority'), width: '90px' },
    { key: 'is_active', label: t('admin.policies.columnActive'), width: '100px' },
  ];
  if (canManage.value) base.push({ key: 'actions', label: '', width: '150px', align: 'end' });
  return base;
});

const showForm = ref(false);
const showDelete = ref(false);
const saving = ref(false);
const formError = ref('');
const editing = ref<AdminPolicyRow | null>(null);
const deleting = ref<AdminPolicyRow | null>(null);

const subjectUsers = ref<CaSelectOption[]>([]);
const subjectGroups = ref<CaSelectOption[]>([]);
const subjectRoles = ref<CaSelectOption[]>([]);
let pickersLoaded = false;

const createForm = ref({
  name: '',
  effect: 'deny' as PolicyEffect,
  subjectType: 'role' as PolicySubjectType,
  subjectId: '',
  permissionPattern: '',
  resourceType: '',
  resourceId: '',
  priority: '100',
});

const editForm = ref({
  name: '',
  priority: '100',
  isActive: true,
  resourceType: '',
  resourceId: '',
});

const effectOptions = computed<CaSelectOption[]>(() => [
  { value: 'deny', label: t('admin.policies.effectDeny') },
  { value: 'allow', label: t('admin.policies.effectAllow') },
]);

const subjectTypeOptions = computed<CaSelectOption[]>(() => [
  { value: 'user', label: t('admin.policies.subjectUser') },
  { value: 'group', label: t('admin.policies.subjectGroup') },
  { value: 'role', label: t('admin.policies.subjectRole') },
]);

const subjectOptions = computed<CaSelectOption[]>(() => {
  if (createForm.value.subjectType === 'user') return subjectUsers.value;
  if (createForm.value.subjectType === 'group') return subjectGroups.value;
  return subjectRoles.value;
});

async function ensurePickers() {
  if (pickersLoaded) return;
  pickersLoaded = true;
  const [users, groups, roles] = await Promise.all([
    listUsers({ page: 1, pageSize: 200 }),
    listGroups(),
    listRoles(),
  ]);
  subjectUsers.value = users.items.map((u) => ({ value: u.id, label: u.display_name }));
  subjectGroups.value = groups.map((g) => ({ value: g.id, label: g.name }));
  subjectRoles.value = roles.map((r) => ({ value: r.id, label: r.name }));
}

function openCreate() {
  editing.value = null;
  createForm.value = {
    name: '',
    effect: 'deny',
    subjectType: 'role',
    subjectId: '',
    permissionPattern: '',
    resourceType: '',
    resourceId: '',
    priority: '100',
  };
  formError.value = '';
  showForm.value = true;
  ensurePickers().catch(() => {
    toast.push({ variant: 'danger', title: t('errors.loadFailed') });
  });
}

function openEdit(row: AdminPolicyRow) {
  editing.value = row;
  editForm.value = {
    name: row.name,
    priority: String(row.priority),
    isActive: row.is_active,
    resourceType: row.resource_type ?? '',
    resourceId: row.resource_id ?? '',
  };
  formError.value = '';
  showForm.value = true;
}

function openDelete(row: AdminPolicyRow) {
  deleting.value = row;
  showDelete.value = true;
}

async function submitCreate() {
  formError.value = '';
  const f = createForm.value;
  if (!f.name.trim() || !f.subjectId || !f.permissionPattern.trim()) {
    formError.value = t('errors.requiredFields');
    return;
  }
  saving.value = true;
  try {
    await createPolicy({
      name: f.name.trim(),
      effect: f.effect,
      subjectType: f.subjectType,
      subjectId: f.subjectId,
      permissionPattern: f.permissionPattern.trim(),
      resourceType: f.resourceType.trim() || null,
      resourceId: f.resourceId.trim() || null,
      priority: Number(f.priority) || 100,
    });
    toast.push({ variant: 'success', title: t('admin.policies.created') });
    showForm.value = false;
    await load();
  } catch {
    formError.value = t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function submitEdit() {
  if (!editing.value) return;
  formError.value = '';
  const f = editForm.value;
  if (!f.name.trim()) {
    formError.value = t('errors.requiredFields');
    return;
  }
  saving.value = true;
  try {
    await updatePolicy(editing.value.id, {
      name: f.name.trim(),
      priority: Number(f.priority) || 100,
      isActive: f.isActive,
      resourceType: f.resourceType.trim() || null,
      resourceId: f.resourceId.trim() || null,
    });
    toast.push({ variant: 'success', title: t('admin.policies.updated') });
    showForm.value = false;
    await load();
  } catch {
    formError.value = t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!deleting.value) return;
  saving.value = true;
  try {
    await deletePolicy(deleting.value.id);
    toast.push({ variant: 'success', title: t('admin.policies.deleted') });
    showDelete.value = false;
    await load();
  } catch (err) {
    toast.push({
      variant: 'danger',
      title: err instanceof ApiError && err.status === 409 ? err.message : t('errors.saveFailed'),
    });
  } finally {
    saving.value = false;
  }
}

function subjectTypeLabel(type: PolicySubjectType): string {
  if (type === 'user') return t('admin.policies.subjectUser');
  if (type === 'group') return t('admin.policies.subjectGroup');
  return t('admin.policies.subjectRole');
}

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.policies.title')"
      :description="t('admin.policies.description')"
    >
      <template #actions>
        <CaButton v-if="canManage" variant="primary" @click="openCreate">
          {{ t('admin.policies.addButton') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <p v-if="error" class="admin-error">{{ error }}</p>

    <CaTable :columns="columns" :rows="rows" :row-key="(row) => row.id" :loading="loading">
      <template #cell-name="{ row }">
        <span class="pol-name">{{ row.name }}</span>
        <div v-if="row.resource_type" class="admin-cell__sub admin-mono">
          {{ row.resource_type }}{{ row.resource_id ? `:${row.resource_id}` : '' }}
        </div>
      </template>
      <template #cell-effect="{ row }">
        <CaBadge :variant="row.effect === 'deny' ? 'danger' : 'success'">
          {{ row.effect === 'deny' ? t('admin.policies.effectDeny') : t('admin.policies.effectAllow') }}
        </CaBadge>
      </template>
      <template #cell-subject="{ row }">
        {{ row.subject_label ?? row.subject_id }}
        <div class="admin-cell__sub">{{ subjectTypeLabel(row.subject_type) }}</div>
      </template>
      <template #cell-permission_pattern="{ row }">
        <span class="admin-mono">{{ row.permission_pattern }}</span>
      </template>
      <template #cell-priority="{ row }">
        {{ row.priority }}
        <div class="admin-cell__sub">{{ formatDateTime(row.created_at) }}</div>
      </template>
      <template #cell-is_active="{ row }">
        <CaBadge :variant="row.is_active ? 'success' : 'neutral'">
          {{ row.is_active ? t('admin.policies.activeBadge') : t('admin.policies.inactiveBadge') }}
        </CaBadge>
      </template>
      <template #cell-actions="{ row }">
        <div class="pol-actions">
          <CaButton size="small" variant="subtle" @click="openEdit(row)">
            {{ t('admin.policies.editAction') }}
          </CaButton>
          <CaButton size="small" variant="subtle" @click="openDelete(row)">
            {{ t('admin.policies.deleteAction') }}
          </CaButton>
        </div>
      </template>
    </CaTable>

    <CaDialog
      v-model:open="showForm"
      :title="editing ? t('admin.policies.editTitle') : t('admin.policies.createTitle')"
      size="medium"
    >
      <div v-if="editing" class="admin-form">
        <CaField :label="t('admin.policies.formName')">
          <CaInput v-model="editForm.name" />
        </CaField>
        <CaField :label="t('admin.policies.formPriority')" :hint="t('admin.policies.formPriorityHint')">
          <CaInput v-model="editForm.priority" />
        </CaField>
        <div class="admin-form__row">
          <CaField :label="`${t('admin.policies.formResourceType')} (${t('admin.policies.resourceOptional')})`">
            <CaInput v-model="editForm.resourceType" />
          </CaField>
          <CaField :label="`${t('admin.policies.formResourceId')} (${t('admin.policies.resourceOptional')})`">
            <CaInput v-model="editForm.resourceId" />
          </CaField>
        </div>
        <CaSwitch v-model="editForm.isActive" :label="t('admin.policies.formActive')" />
        <p v-if="formError" class="admin-error">{{ formError }}</p>
      </div>

      <div v-else class="admin-form">
        <CaField :label="t('admin.policies.formName')">
          <CaInput v-model="createForm.name" />
        </CaField>
        <div class="admin-form__row">
          <CaField :label="t('admin.policies.formEffect')">
            <CaSelect v-model="createForm.effect" :options="effectOptions" />
          </CaField>
          <CaField :label="t('admin.policies.formPriority')" :hint="t('admin.policies.formPriorityHint')">
            <CaInput v-model="createForm.priority" />
          </CaField>
        </div>
        <div class="admin-form__row">
          <CaField :label="t('admin.policies.formSubjectType')">
            <CaSelect v-model="createForm.subjectType" :options="subjectTypeOptions" />
          </CaField>
          <CaField :label="t('admin.policies.formSubject')">
            <CaSelect
              v-model="createForm.subjectId"
              :options="subjectOptions"
              :placeholder="t('admin.policies.formSubjectPlaceholder')"
            />
          </CaField>
        </div>
        <CaField :label="t('admin.policies.formPattern')" :hint="t('admin.policies.formPatternHint')">
          <CaInput v-model="createForm.permissionPattern" placeholder="knowledge.*" />
        </CaField>
        <div class="admin-form__row">
          <CaField :label="`${t('admin.policies.formResourceType')} (${t('admin.policies.resourceOptional')})`">
            <CaInput v-model="createForm.resourceType" />
          </CaField>
          <CaField :label="`${t('admin.policies.formResourceId')} (${t('admin.policies.resourceOptional')})`">
            <CaInput v-model="createForm.resourceId" />
          </CaField>
        </div>
        <p v-if="formError" class="admin-error">{{ formError }}</p>
      </div>

      <template #footer>
        <CaButton variant="subtle" @click="showForm = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton
          variant="primary"
          :disabled="saving"
          @click="editing ? submitEdit() : submitCreate()"
        >
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="showDelete"
      :title="t('admin.policies.deleteTitle')"
      size="small"
    >
      <p class="pol-delete-text">
        {{ t('admin.policies.deleteConfirm', { name: deleting?.name ?? '' }) }}
      </p>
      <template #footer>
        <CaButton variant="subtle" @click="showDelete = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="danger" :disabled="saving" @click="confirmDelete">
          {{ t('admin.policies.deleteAction') }}
        </CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.pol-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ca-space-4);
}

.pol-name {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.pol-delete-text {
  margin: 0;
  color: var(--ca-fg-2);
}
</style>
