<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ApiError } from '@/api/http';
import {
  createGroup,
  deleteGroup,
  listGroups,
  updateGroup,
  type AdminGroupRow,
} from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import {
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

const canManage = computed(() => auth.can('rbac.groups.manage'));

const rows = ref<AdminGroupRow[]>([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await listGroups();
  } catch {
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

const columns = computed<CaTableColumn[]>(() => {
  const base: CaTableColumn[] = [
    { key: 'name', label: t('admin.groups.columnName') },
    { key: 'member_count', label: t('admin.groups.columnMembers'), width: '110px' },
    { key: 'role_count', label: t('admin.groups.columnRoles'), width: '110px' },
    { key: 'created_at', label: t('admin.groups.columnCreated'), width: '170px' },
  ];
  if (canManage.value) base.push({ key: 'actions', label: '', width: '150px', align: 'end' });
  return base;
});

const showForm = ref(false);
const showDelete = ref(false);
const saving = ref(false);
const formError = ref('');
const editing = ref<AdminGroupRow | null>(null);
const deleting = ref<AdminGroupRow | null>(null);

const form = ref({ code: '', name: '', description: '' });
const codePattern = /^[a-z][a-z0-9_.-]{2,99}$/;

function openCreate() {
  editing.value = null;
  form.value = { code: '', name: '', description: '' };
  formError.value = '';
  showForm.value = true;
}

function openEdit(row: AdminGroupRow) {
  editing.value = row;
  form.value = { code: row.code, name: row.name, description: row.description ?? '' };
  formError.value = '';
  showForm.value = true;
}

function openDelete(row: AdminGroupRow) {
  deleting.value = row;
  showDelete.value = true;
}

async function submit() {
  formError.value = '';
  const { code, name, description } = form.value;
  if (!name.trim() || (!editing.value && !code.trim())) {
    formError.value = t('errors.requiredFields');
    return;
  }
  if (!editing.value && !codePattern.test(code.trim())) {
    formError.value = t('admin.groups.formCodeHint');
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await updateGroup(editing.value.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast.push({ variant: 'success', title: t('admin.groups.updated') });
    } else {
      await createGroup({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast.push({ variant: 'success', title: t('admin.groups.created') });
    }
    showForm.value = false;
    await load();
  } catch (err) {
    formError.value =
      err instanceof ApiError && err.status === 409
        ? t('admin.groups.formCodeTaken')
        : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!deleting.value) return;
  saving.value = true;
  try {
    await deleteGroup(deleting.value.id);
    toast.push({ variant: 'success', title: t('admin.groups.deleted') });
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

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.groups.title')"
      :description="t('admin.groups.description')"
    >
      <template #actions>
        <CaButton v-if="canManage" variant="primary" @click="openCreate">
          {{ t('admin.groups.addButton') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <p v-if="error" class="admin-error">{{ error }}</p>

    <CaTable :columns="columns" :rows="rows" :row-key="(row) => row.id" :loading="loading">
      <template #cell-name="{ row }">
        <RouterLink class="admin-name-link" :to="`/administration/groups/${row.id}`">
          {{ row.name }}
        </RouterLink>
        <div class="admin-cell__sub admin-mono">{{ row.code }}</div>
      </template>
      <template #cell-member_count="{ row }">
        {{ t('admin.groups.memberCount', { count: row.member_count }) }}
      </template>
      <template #cell-role_count="{ row }">
        {{ t('admin.groups.roleCount', { count: row.role_count }) }}
      </template>
      <template #cell-created_at="{ row }">
        {{ formatDateTime(row.created_at) }}
      </template>
      <template #cell-actions="{ row }">
        <div class="grp-actions">
          <CaButton size="small" variant="subtle" @click="openEdit(row)">
            {{ t('admin.groups.editAction') }}
          </CaButton>
          <CaButton size="small" variant="subtle" @click="openDelete(row)">
            {{ t('admin.groups.deleteAction') }}
          </CaButton>
        </div>
      </template>
    </CaTable>

    <CaDialog
      v-model:open="showForm"
      :title="editing ? t('admin.groups.editTitle') : t('admin.groups.createTitle')"
      size="small"
    >
      <div class="admin-form">
        <CaField v-if="!editing" :label="t('admin.groups.formCode')" :hint="t('admin.groups.formCodeHint')">
          <CaInput v-model="form.code" placeholder="project_x" />
        </CaField>
        <CaField :label="t('admin.groups.formName')">
          <CaInput v-model="form.name" />
        </CaField>
        <CaField :label="t('admin.groups.formDescription')">
          <CaInput v-model="form.description" />
        </CaField>
        <p v-if="formError" class="admin-error">{{ formError }}</p>
      </div>
      <template #footer>
        <CaButton variant="subtle" @click="showForm = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="primary" :disabled="saving" @click="submit">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="showDelete"
      :title="t('admin.groups.deleteTitle')"
      size="small"
    >
      <p class="grp-delete-text">
        {{ t('admin.groups.deleteConfirm', { name: deleting?.name ?? '' }) }}
      </p>
      <template #footer>
        <CaButton variant="subtle" @click="showDelete = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="danger" :disabled="saving" @click="confirmDelete">
          {{ t('admin.groups.deleteAction') }}
        </CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.grp-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ca-space-4);
}

.grp-delete-text {
  margin: 0;
  color: var(--ca-fg-2);
}
</style>
