<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ApiError } from '@/api/http';
import {
  createRole,
  deleteRole,
  listRoles,
  updateRole,
  type AdminRoleRow,
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
  CaTable,
  type CaTableColumn,
} from '@/components/ui';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canManage = computed(() => auth.can('rbac.roles.manage'));

const rows = ref<AdminRoleRow[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await listRoles();
  } catch {
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

const columns = computed<CaTableColumn[]>(() => {
  const base: CaTableColumn[] = [
    { key: 'name', label: t('admin.roles.columnName') },
    { key: 'permission_count', label: t('admin.roles.columnPermissions'), width: '110px' },
    { key: 'assignment_count', label: t('admin.roles.columnAssignments'), width: '110px' },
    { key: 'is_system', label: t('admin.roles.columnType'), width: '110px' },
    { key: 'created_at', label: t('admin.roles.columnCreated'), width: '170px' },
  ];
  if (canManage.value) base.push({ key: 'actions', label: '', width: '150px', align: 'end' });
  return base;
});

const showCreate = ref(false);
const showEdit = ref(false);
const showDelete = ref(false);
const saving = ref(false);
const formError = ref('');
const target = ref<AdminRoleRow | null>(null);

const createForm = ref({ code: '', name: '', description: '' });
const editForm = ref({ name: '', description: '' });

const codePattern = /^[a-z][a-z0-9_.-]{2,99}$/;

function openCreate() {
  createForm.value = { code: '', name: '', description: '' };
  formError.value = '';
  showCreate.value = true;
}

function openEdit(row: AdminRoleRow) {
  target.value = row;
  editForm.value = { name: row.name, description: row.description ?? '' };
  formError.value = '';
  showEdit.value = true;
}

function openDelete(row: AdminRoleRow) {
  target.value = row;
  showDelete.value = true;
}

async function submitCreate() {
  formError.value = '';
  const { code, name, description } = createForm.value;
  if (!code.trim() || !name.trim()) {
    formError.value = t('errors.requiredFields');
    return;
  }
  if (!codePattern.test(code.trim())) {
    formError.value = t('admin.roles.formCodeHint');
    return;
  }
  saving.value = true;
  try {
    await createRole({
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
    });
    toast.push({ variant: 'success', title: t('admin.roles.created') });
    showCreate.value = false;
    await load();
  } catch (err) {
    formError.value =
      err instanceof ApiError && err.status === 409
        ? t('admin.roles.formCodeTaken')
        : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function submitEdit() {
  if (!target.value) return;
  formError.value = '';
  const { name, description } = editForm.value;
  if (!name.trim()) {
    formError.value = t('errors.requiredFields');
    return;
  }
  saving.value = true;
  try {
    await updateRole(target.value.id, {
      name: name.trim(),
      description: description.trim() || undefined,
    });
    toast.push({ variant: 'success', title: t('admin.roles.updated') });
    showEdit.value = false;
    await load();
  } catch {
    formError.value = t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!target.value) return;
  saving.value = true;
  try {
    await deleteRole(target.value.id);
    toast.push({ variant: 'success', title: t('admin.roles.deleted') });
    showDelete.value = false;
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
      :title="t('admin.roles.title')"
      :description="t('admin.roles.description')"
    >
      <template #actions>
        <CaButton v-if="canManage" variant="primary" @click="openCreate">
          {{ t('admin.roles.addButton') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <p v-if="error" class="admin-error">{{ error }}</p>

    <CaTable
      :columns="columns"
      :rows="rows"
      :row-key="(row) => row.id"
      :loading="loading"
    >
      <template #cell-name="{ row }">
        <RouterLink class="admin-name-link" :to="`/administration/roles/${row.id}`">
          {{ row.name }}
        </RouterLink>
        <div class="admin-cell__sub admin-mono">{{ row.code }}</div>
      </template>
      <template #cell-permission_count="{ row }">
        {{ t('admin.roles.permissionCount', { count: row.permission_count }) }}
      </template>
      <template #cell-assignment_count="{ row }">
        {{ t('admin.roles.assignmentCount', { count: row.assignment_count }) }}
      </template>
      <template #cell-is_system="{ row }">
        <CaBadge :variant="row.is_system ? 'brand' : 'neutral'">
          {{ row.is_system ? t('admin.roles.systemBadge') : t('admin.roles.customBadge') }}
        </CaBadge>
      </template>
      <template #cell-created_at="{ row }">
        {{ formatDateTime(row.created_at) }}
      </template>
      <template #cell-actions="{ row }">
        <div class="roles-actions">
          <CaButton size="small" variant="subtle" @click="openEdit(row)">
            {{ t('admin.roles.editAction') }}
          </CaButton>
          <CaButton
            v-if="!row.is_system"
            size="small"
            variant="subtle"
            @click="openDelete(row)"
          >
            {{ t('admin.roles.deleteAction') }}
          </CaButton>
        </div>
      </template>
    </CaTable>

    <CaDialog
      v-model:open="showCreate"
      :title="t('admin.roles.createTitle')"
      size="small"
    >
      <div class="admin-form">
        <CaField :label="t('admin.roles.formCode')" :hint="t('admin.roles.formCodeHint')">
          <CaInput v-model="createForm.code" placeholder="hr_admin" />
        </CaField>
        <CaField :label="t('admin.roles.formName')">
          <CaInput v-model="createForm.name" />
        </CaField>
        <CaField :label="t('admin.roles.formDescription')">
          <CaInput v-model="createForm.description" />
        </CaField>
        <p v-if="formError" class="admin-error">{{ formError }}</p>
      </div>
      <template #footer>
        <CaButton variant="subtle" @click="showCreate = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="primary" :disabled="saving" @click="submitCreate">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="showEdit"
      :title="t('admin.roles.editTitle')"
      size="small"
    >
      <div class="admin-form">
        <CaField :label="t('admin.roles.formName')">
          <CaInput v-model="editForm.name" />
        </CaField>
        <CaField :label="t('admin.roles.formDescription')">
          <CaInput v-model="editForm.description" />
        </CaField>
        <p v-if="formError" class="admin-error">{{ formError }}</p>
      </div>
      <template #footer>
        <CaButton variant="subtle" @click="showEdit = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="primary" :disabled="saving" @click="submitEdit">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="showDelete"
      :title="t('admin.roles.deleteTitle')"
      size="small"
    >
      <p class="roles-delete-text">
        {{ t('admin.roles.deleteConfirm', { name: target?.name ?? '' }) }}
      </p>
      <template #footer>
        <CaButton variant="subtle" @click="showDelete = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="danger" :disabled="saving" @click="confirmDelete">
          {{ t('admin.roles.deleteAction') }}
        </CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.roles-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ca-space-4);
}

.roles-delete-text {
  margin: 0;
  color: var(--ca-fg-3);
}
</style>
