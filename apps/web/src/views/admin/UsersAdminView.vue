<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ApiError } from '@/api/http';
import {
  createUser,
  listDepartments,
  listUsers,
  updateUser,
  type AdminDepartmentNode,
  type AdminUserRow,
} from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { usePagedList } from '@/composables/usePagedList';
import {
  CaAvatar,
  CaBadge,
  CaButton,
  CaCheckbox,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaPagination,
  CaSelect,
  CaStatCard,
  CaTable,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';
import { downloadCsv } from '@/utils/csv';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canManage = computed(() => auth.can('rbac.users.manage'));
const canInspect = computed(() => auth.can('rbac.effective.inspect'));

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
  { key: 'name', label: t('admin.users.columnName'), sortValue: (row) => row.display_name },
  { key: 'department', label: t('admin.users.columnDepartment'), sortValue: (row) => row.department_name },
  { key: 'status', label: t('admin.users.columnStatus') },
  { key: 'lastLogin', label: t('admin.users.columnLastLogin'), sortValue: (row) => row.last_login_at },
  { key: 'created', label: t('admin.users.columnCreated'), sortValue: (row) => row.created_at },
]);

function applyFilters(): void {
  setFilter({
    search: search.value.trim() || undefined,
    status: statusFilter.value || undefined,
    departmentId: departmentFilter.value || undefined,
  });
}

const userCounts = ref<{ total: number; active: number; disabled: number } | null>(null);

async function loadCounts(): Promise<void> {
  try {
    const [all, active, disabled] = await Promise.all([
      listUsers({ page: 1, pageSize: 1 }),
      listUsers({ page: 1, pageSize: 1, status: 'active' }),
      listUsers({ page: 1, pageSize: 1, status: 'disabled' }),
    ]);
    userCounts.value = { total: all.total, active: active.total, disabled: disabled.total };
  } catch {
    userCounts.value = null;
  }
}

const selectedId = ref<string | null>(null);
const selected = computed(() => items.value.find((u) => u.id === selectedId.value) ?? null);

function selectRow(row: AdminUserRow): void {
  selectedId.value = row.id;
}

const statusDialogOpen = ref(false);
const statusSaving = ref(false);

async function confirmStatusChange(): Promise<void> {
  const user = selected.value;
  if (!user) return;
  statusSaving.value = true;
  try {
    await updateUser(user.id, { status: user.status === 'active' ? 'disabled' : 'active' });
    toast.push({ variant: 'success', title: t('admin.users.statusChanged') });
    statusDialogOpen.value = false;
    await Promise.all([load(), loadCounts()]);
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') });
  } finally {
    statusSaving.value = false;
  }
}

function statusText(row: AdminUserRow): string {
  return row.status === 'active' ? t('admin.users.statusActive') : t('admin.users.statusDisabled');
}

function exportCsv(): void {
  downloadCsv(
    'pengguna',
    [
      t('admin.users.columnName'),
      t('admin.users.formEmail'),
      t('admin.users.columnDepartment'),
      t('admin.users.columnStatus'),
      t('admin.users.columnLastLogin'),
      t('admin.users.columnCreated'),
    ],
    items.value.map((u) => [
      u.display_name,
      u.email,
      u.department_name ?? '',
      statusText(u),
      formatDateTime(u.last_login_at),
      formatDateTime(u.created_at),
    ]),
  );
}

onMounted(async () => {
  void load();
  void loadCounts();
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
    await Promise.all([load(), loadCounts()]);
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

    <section v-if="userCounts" class="ca-kpis" :aria-label="t('admin.users.title')">
      <CaStatCard :label="t('admin.users.kpiTotal')" :value="userCounts.total" :hint="t('admin.users.kpiTotalHint')" />
      <CaStatCard
        :label="t('admin.users.kpiActive')"
        :value="userCounts.active"
        tone="success"
        :hint="t('admin.users.kpiActiveHint')"
      />
      <CaStatCard :label="t('admin.users.kpiDisabled')" :value="userCounts.disabled" :hint="t('admin.users.kpiDisabledHint')" />
    </section>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <div class="users-layout">
      <section class="ca-panel users-list">
        <CaTable
          table-key="admin-users"
          :columns="columns"
          :rows="items"
          :row-key="(row) => row.id"
          :row-active="(row) => row.id === selectedId"
          :loading="loading"
          :empty-title="t('table.empty')"
          @row-click="selectRow"
        >
          <template #toolbar>
            <div class="ca-toolbar">
              <CaInput
                v-model="search"
                type="search"
                class="ca-toolbar__search"
                :placeholder="t('admin.users.searchPlaceholder')"
                :aria-label="t('common.search')"
                @keyup.enter="applyFilters"
              />
              <CaSelect
                v-model="departmentFilter"
                class="ca-toolbar__select"
                :options="[{ value: '', label: t('common.all') }, ...departmentOptions]"
                :aria-label="t('admin.users.filterDepartment')"
                @update:model-value="applyFilters"
              />
              <CaSelect
                v-model="statusFilter"
                class="ca-toolbar__select"
                :options="statusOptions"
                :aria-label="t('admin.users.filterStatus')"
                @update:model-value="applyFilters"
              />
              <CaButton @click="applyFilters">{{ t('common.search') }}</CaButton>
            </div>
            <CaButton :disabled="items.length === 0" @click="exportCsv">{{ t('admin.users.exportCsv') }}</CaButton>
          </template>
          <template #cell-name="{ row }">
            <div class="users-person">
              <CaAvatar :name="row.display_name" size="small" />
              <div class="admin-cell">
                <RouterLink class="admin-name-link" :to="`/administration/users/${row.id}`" @click.stop>
                  {{ row.display_name }}
                </RouterLink>
                <span class="admin-cell__sub">
                  {{ row.email }}
                  <CaBadge v-if="row.is_superadmin" size="small" variant="brand">
                    {{ t('admin.users.superadminBadge') }}
                  </CaBadge>
                </span>
              </div>
            </div>
          </template>
          <template #cell-department="{ row }">
            {{ row.department_name ?? '—' }}
          </template>
          <template #cell-status="{ row }">
            <CaBadge :variant="statusVariant(row)" size="small">{{ statusText(row) }}</CaBadge>
          </template>
          <template #cell-lastLogin="{ row }">
            {{ formatDateTime(row.last_login_at) }}
          </template>
          <template #cell-created="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>
        </CaTable>

        <CaPagination :page="page" :limit="pageSize" :total="total" @change="goPage" />
      </section>

      <aside class="ca-panel users-detail" :aria-label="t('admin.users.detailLabel')">
        <template v-if="selected">
          <div class="users-detail__who">
            <CaAvatar :name="selected.display_name" size="large" />
            <div class="users-detail__name">
              <h2 class="ca-panel__title">{{ selected.display_name }}</h2>
              <span class="admin-cell__sub">{{ selected.email }}</span>
            </div>
          </div>
          <dl class="users-detail__dl">
            <dt>{{ t('admin.users.columnDepartment') }}</dt>
            <dd>{{ selected.department_name ?? '—' }}</dd>
            <dt>{{ t('admin.users.columnStatus') }}</dt>
            <dd><CaBadge :variant="statusVariant(selected)" size="small">{{ statusText(selected) }}</CaBadge></dd>
            <dt>{{ t('admin.users.columnLastLogin') }}</dt>
            <dd>{{ formatDateTime(selected.last_login_at) }}</dd>
            <dt>{{ t('admin.users.columnCreated') }}</dt>
            <dd>{{ formatDateTime(selected.created_at) }}</dd>
          </dl>
          <div class="users-detail__actions">
            <CaButton :to="`/administration/users/${selected.id}`" block>{{ t('admin.users.editUser') }}</CaButton>
            <CaButton
              v-if="canInspect"
              :to="`/administration/effective-permissions?user=${encodeURIComponent(selected.email)}`"
              block
            >
              {{ t('admin.users.checkEffective') }}
            </CaButton>
            <CaButton
              v-if="canManage && selected.id !== auth.user?.id"
              :variant="selected.status === 'active' ? 'danger' : 'secondary'"
              block
              @click="statusDialogOpen = true"
            >
              {{ selected.status === 'active' ? t('admin.users.disableUser') : t('admin.users.enableUser') }}
            </CaButton>
          </div>
        </template>
        <p v-else class="users-detail__empty">{{ t('admin.users.selectHint') }}</p>
      </aside>
    </div>

    <CaDialog
      v-if="selected"
      v-model:open="statusDialogOpen"
      size="small"
      :title="
        selected.status === 'active'
          ? t('admin.users.disableTitle', { name: selected.display_name })
          : t('admin.users.enableTitle', { name: selected.display_name })
      "
    >
      <p>{{ selected.status === 'active' ? t('admin.users.disableBody') : t('admin.users.enableBody') }}</p>
      <template #footer>
        <CaButton @click="statusDialogOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton
          :variant="selected.status === 'active' ? 'danger' : 'primary'"
          :loading="statusSaving"
          @click="confirmStatusChange"
        >
          {{ selected.status === 'active' ? t('admin.users.disableUser') : t('admin.users.enableUser') }}
        </CaButton>
      </template>
    </CaDialog>

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

.users-layout {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-12);
  align-items: flex-start;
}

.users-list {
  flex: 999 1 560px;
  min-width: 0;
}

.users-list :deep(tbody tr) {
  cursor: pointer;
}

.users-detail {
  flex: 1 1 var(--ca-context-panel-width);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-10);
  position: sticky;
  top: calc(var(--ca-topbar-height) + var(--ca-space-8));
}

.users-detail + .users-detail {
  margin-top: 0;
}

.users-detail__who {
  display: flex;
  align-items: center;
  gap: var(--ca-space-6);
}

.users-detail__name {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.users-detail__dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--ca-space-4) var(--ca-space-8);
  margin: 0;
}

.users-detail__dl dt {
  color: var(--ca-fg-3);
}

.users-detail__dl dd {
  margin: 0;
  font-weight: var(--ca-font-weight-semibold);
}

.users-detail__actions {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
}

.users-detail__empty {
  color: var(--ca-fg-3);
}

.users-person {
  display: flex;
  align-items: center;
  gap: var(--ca-space-6);
}
</style>
