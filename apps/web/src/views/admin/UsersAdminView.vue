<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ApiError } from '@/api/http';
import {
  createUser,
  listDepartments,
  listUsers,
  type AdminDepartmentNode,
  type AdminUserRow,
} from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { usePagedList } from '@/composables/usePagedList';
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
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canManage = computed(() => auth.can('rbac.users.manage'));

const { items, total, page, pageSize, loading, error, load, setFilter, goPage } =
  usePagedList<AdminUserRow>(listUsers, { pageSize: 25 });

const search = ref('');
const statusFilter = ref('');
const departmentFilter = ref('');

const statusOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('common.all') },
  { value: 'active', label: t('admin.users.statusActive') },
  { value: 'disabled', label: t('admin.users.statusDisabled') },
]);

function flattenDepartments(
  nodes: AdminDepartmentNode[],
  depth = 0,
): CaSelectOption[] {
  const options: CaSelectOption[] = [];
  for (const node of nodes) {
    options.push({ value: node.id, label: `${'— '.repeat(depth)}${node.name}` });
    options.push(...flattenDepartments(node.children, depth + 1));
  }
  return options;
}

const departments = ref<AdminDepartmentNode[]>([]);
const departmentOptions = computed<CaSelectOption[]>(() => flattenDepartments(departments.value));

const columns = computed<CaTableColumn[]>(() => [
  { key: 'name', label: t('admin.users.columnName') },
  { key: 'department', label: t('admin.users.columnDepartment') },
  { key: 'status', label: t('admin.users.columnStatus') },
  { key: 'lastLogin', label: t('admin.users.columnLastLogin') },
  { key: 'created', label: t('admin.users.columnCreated') },
]);

function applyFilters(): void {
  setFilter({
    search: search.value.trim() || undefined,
    status: statusFilter.value || undefined,
    departmentId: departmentFilter.value || undefined,
  });
}

onMounted(async () => {
  void load();
  try {
    departments.value = await listDepartments();
  } catch {
    departments.value = [];
  }
});

const createOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const form = ref({
  email: '',
  displayName: '',
  password: '',
  departmentId: '',
  isSuperadmin: false,
});

function openCreate(): void {
  form.value = { email: '', displayName: '', password: '', departmentId: '', isSuperadmin: false };
  formError.value = '';
  createOpen.value = true;
}

async function submitCreate(): Promise<void> {
  formError.value = '';
  if (
    form.value.email.trim().length === 0 ||
    form.value.displayName.trim().length < 2 ||
    form.value.password.length < 10
  ) {
    formError.value = t('errors.requiredFields');
    return;
  }
  saving.value = true;
  try {
    await createUser({
      email: form.value.email.trim().toLowerCase(),
      displayName: form.value.displayName.trim(),
      password: form.value.password,
      departmentId: form.value.departmentId || null,
      isSuperadmin: form.value.isSuperadmin,
    });
    toast.push({ variant: 'success', title: t('admin.users.created') });
    createOpen.value = false;
    await load();
  } catch (caught) {
    formError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

function statusVariant(row: AdminUserRow): 'success' | 'neutral' {
  return row.status === 'active' ? 'success' : 'neutral';
}
</script>

<template>
  <div>
    <CaPageHeader :title="t('admin.users.title')" :description="t('admin.users.description')">
      <template #actions>
        <CaButton v-if="canManage" variant="primary" @click="openCreate">
          {{ t('admin.users.addButton') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <div class="admin-filters">
      <CaInput
        v-model="search"
        class="admin-filters__wide"
        :placeholder="t('admin.users.searchPlaceholder')"
        :aria-label="t('common.search')"
        @keyup.enter="applyFilters"
      />
      <CaSelect
        v-model="statusFilter"
        class="admin-filters__field"
        :options="statusOptions"
        :aria-label="t('admin.users.filterStatus')"
        @update:model-value="applyFilters"
      />
      <CaSelect
        v-model="departmentFilter"
        class="admin-filters__field"
        :options="departmentOptions"
        :aria-label="t('admin.users.filterDepartment')"
        @update:model-value="applyFilters"
      />
      <CaButton variant="secondary" @click="applyFilters">{{ t('common.search') }}</CaButton>
    </div>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <CaTable
      :columns="columns"
      :rows="items"
      :row-key="(row) => row.id"
      :loading="loading"
      :empty-title="t('table.empty')"
    >
      <template #cell-name="{ row }">
        <div class="admin-cell">
          <RouterLink class="admin-name-link" :to="`/administration/users/${row.id}`">
            {{ row.display_name }}
          </RouterLink>
          <span class="admin-cell__sub">
            {{ row.email }}
            <CaBadge v-if="row.is_superadmin" size="small" variant="brand">
              {{ t('admin.users.superadminBadge') }}
            </CaBadge>
          </span>
        </div>
      </template>
      <template #cell-department="{ row }">
        {{ row.department_name ?? '—' }}
      </template>
      <template #cell-status="{ row }">
        <CaBadge :variant="statusVariant(row)" size="small">
          {{ row.status === 'active' ? t('admin.users.statusActive') : t('admin.users.statusDisabled') }}
        </CaBadge>
      </template>
      <template #cell-lastLogin="{ row }">
        {{ formatDateTime(row.last_login_at) }}
      </template>
      <template #cell-created="{ row }">
        {{ formatDateTime(row.created_at) }}
      </template>
    </CaTable>

    <CaPagination :page="page" :limit="pageSize" :total="total" @change="goPage" />

    <CaDialog v-model:open="createOpen" :title="t('admin.users.createTitle')" :subtitle="t('admin.users.createSubtitle')">
      <p v-if="formError" class="admin-error" role="alert">{{ formError }}</p>
      <form class="admin-form" @submit.prevent="submitCreate">
        <CaField :label="t('admin.users.formName')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="form.displayName" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('admin.users.formEmail')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="form.email" :aria-describedby="describedBy" type="email" />
          </template>
        </CaField>
        <CaField
          :label="t('admin.users.formPassword')"
          :hint="t('admin.users.formPasswordHint')"
          required
        >
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="form.password" :aria-describedby="describedBy" type="password" />
          </template>
        </CaField>
        <CaField :label="t('admin.users.formDepartment')">
          <template #default="{ id, describedBy }">
            <CaSelect :id="id" v-model="form.departmentId" :aria-describedby="describedBy" :options="departmentOptions" />
          </template>
        </CaField>
        <CaCheckbox v-if="auth.isSuperadmin" v-model="form.isSuperadmin">
          {{ t('admin.users.formSuperadmin') }}
        </CaCheckbox>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="createOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="saving" @click="submitCreate">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>
  </div>
</template>

<style scoped>
.admin-cell .ca-badge {
  margin-left: var(--ca-space-2);
}
</style>
