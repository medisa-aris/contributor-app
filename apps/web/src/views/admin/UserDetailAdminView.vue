<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, RouterLink } from 'vue-router';
import { ApiError } from '@/api/http';
import {
  assignUserRole,
  getUser,
  listDepartments,
  listRoles,
  resetUserPassword,
  revokeUserRole,
  updateUser,
  type AdminDepartmentNode,
  type AdminRoleAssignment,
  type AdminRoleRow,
  type AdminUserDetail,
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
  CaSpinner,
  CaSwitch,
  type CaSelectOption,
} from '@/components/ui';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const toast = useToastStore();

const userId = computed(() => String(route.params.id));

const user = ref<AdminUserDetail | null>(null);
const loading = ref(true);
const error = ref('');

const canManage = computed(() => auth.can('rbac.users.manage'));
const canAssign = computed(() => auth.can('rbac.permissions.assign'));

const roles = ref<AdminRoleRow[]>([]);
const departments = ref<AdminDepartmentNode[]>([]);

const roleOptions = computed<CaSelectOption[]>(() =>
  roles.value.map((role) => ({ value: role.id, label: `${role.name} (${role.code})` })),
);

function flattenDepartments(nodes: AdminDepartmentNode[], depth = 0): CaSelectOption[] {
  const options: CaSelectOption[] = [];
  for (const node of nodes) {
    options.push({ value: node.id, label: `${'— '.repeat(depth)}${node.name}` });
    options.push(...flattenDepartments(node.children, depth + 1));
  }
  return options;
}

const departmentOptions = computed<CaSelectOption[]>(() => flattenDepartments(departments.value));

const scopeOptions = computed<CaSelectOption[]>(() => [
  { value: 'global', label: t('admin.users.scopeGlobal') },
  { value: 'department', label: t('admin.users.scopeDepartment') },
  { value: 'own', label: t('admin.users.scopeOwn') },
]);

async function loadUser(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    user.value = await getUser(userId.value);
  } catch (caught) {
    user.value = null;
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  void loadUser();
  const [rolesResult, departmentsResult] = await Promise.allSettled([
    listRoles(),
    listDepartments(),
  ]);
  if (rolesResult.status === 'fulfilled') roles.value = rolesResult.value;
  if (departmentsResult.status === 'fulfilled') departments.value = departmentsResult.value;
});

const editName = ref('');
const editDepartmentId = ref('');
const editSuperadmin = ref(false);

function syncEditForm(): void {
  editName.value = user.value?.display_name ?? '';
  editDepartmentId.value = user.value?.department_id ?? '';
  editSuperadmin.value = user.value?.is_superadmin ?? false;
}

async function saveProfile(): Promise<void> {
  if (!user.value) return;
  const self = user.value.id === auth.user?.id;
  const superadminChanged = auth.isSuperadmin && editSuperadmin.value !== user.value.is_superadmin;
  savingProfile.value = true;
  try {
    await updateUser(user.value.id, {
      displayName: editName.value.trim() || undefined,
      departmentId: editDepartmentId.value || null,
      ...(auth.isSuperadmin ? { isSuperadmin: editSuperadmin.value } : {}),
    });
    toast.push({
      variant: 'success',
      title: superadminChanged ? t('admin.users.superadminUpdated') : t('admin.users.saved'),
    });
    await loadUser();
    syncEditForm();
    if (self && superadminChanged) await auth.fetchMe();
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  } finally {
    savingProfile.value = false;
  }
}

const savingProfile = ref(false);

async function toggleStatus(): Promise<void> {
  if (!user.value) return;
  const next = user.value.status === 'active' ? 'disabled' : 'active';
  try {
    await updateUser(user.value.id, { status: next });
    toast.push({
      variant: 'success',
      title: next === 'disabled' ? t('admin.users.disabled') : t('admin.users.enabled'),
    });
    await loadUser();
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

const resetOpen = ref(false);
const resetPassword = ref('');
const resetSaving = ref(false);
const resetError = ref('');

function openReset(): void {
  resetPassword.value = '';
  resetError.value = '';
  resetOpen.value = true;
}

async function submitReset(): Promise<void> {
  if (!user.value) return;
  if (resetPassword.value.length < 10) {
    resetError.value = t('errors.requiredFields');
    return;
  }
  resetSaving.value = true;
  try {
    await resetUserPassword(user.value.id, resetPassword.value);
    toast.push({ variant: 'success', title: t('admin.users.resetDone') });
    resetOpen.value = false;
  } catch (caught) {
    resetError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    resetSaving.value = false;
  }
}

const assignOpen = ref(false);
const assignSaving = ref(false);
const assignError = ref('');
const assignForm = ref({ roleId: '', dataScope: 'department', departmentId: '' });

function openAssign(): void {
  assignForm.value = {
    roleId: '',
    dataScope: 'department',
    departmentId: user.value?.department_id ?? '',
  };
  assignError.value = '';
  assignOpen.value = true;
}

async function submitAssign(): Promise<void> {
  if (!user.value || assignForm.value.roleId.length === 0) {
    assignError.value = t('errors.requiredFields');
    return;
  }
  assignSaving.value = true;
  try {
    await assignUserRole(user.value.id, {
      roleId: assignForm.value.roleId,
      dataScope: assignForm.value.dataScope as 'global' | 'department' | 'own',
      departmentId:
        assignForm.value.dataScope === 'department' ? assignForm.value.departmentId || null : null,
    });
    toast.push({ variant: 'success', title: t('admin.users.roleAssigned') });
    assignOpen.value = false;
    await loadUser();
  } catch (caught) {
    assignError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    assignSaving.value = false;
  }
}

async function revokeAssignment(assignment: AdminRoleAssignment): Promise<void> {
  if (!user.value) return;
  try {
    await revokeUserRole(user.value.id, assignment.id);
    toast.push({ variant: 'success', title: t('admin.users.roleRevoked') });
    await loadUser();
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

function scopeLabel(scope: string): string {
  if (scope === 'global') return t('admin.users.scopeGlobal');
  if (scope === 'own') return t('admin.users.scopeOwn');
  return t('admin.users.scopeDepartment');
}

function departmentName(id: string | null): string {
  if (!id) return '—';
  const all = flattenDepartments(departments.value);
  return all.find((option) => option.value === id)?.label.replace(/^— /, '') ?? id;
}
</script>

<template>
  <div>
    <div v-if="loading" class="udetail-loading"><CaSpinner size="large" /></div>

    <template v-else-if="user">
      <CaPageHeader :title="user.display_name" :description="user.email">
        <template #actions>
          <RouterLink class="udetail-back" to="/administration/users">
            {{ t('common.back') }}
          </RouterLink>
        </template>
      </CaPageHeader>

      <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

      <div class="udetail-badges">
        <CaBadge :variant="user.status === 'active' ? 'success' : 'neutral'" size="small">
          {{
            user.status === 'active'
              ? t('admin.users.statusActive')
              : t('admin.users.statusDisabled')
          }}
        </CaBadge>
        <CaBadge v-if="user.is_superadmin" variant="brand" size="small">
          {{ t('admin.users.superadminBadge') }}
        </CaBadge>
        <span class="admin-cell__sub">{{ formatDateTime(user.created_at) }}</span>
      </div>

      <section class="admin-section">
        <h2 class="admin-section__title">{{ t('admin.users.infoSection') }}</h2>
        <form class="udetail-form" @submit.prevent="saveProfile">
          <CaField :label="t('admin.users.formName')">
            <template #default="{ id, describedBy }">
              <CaInput
                :id="id"
                v-model="editName"
                :aria-describedby="describedBy"
                :disabled="!canManage"
              />
            </template>
          </CaField>
          <CaField :label="t('admin.users.formDepartment')">
            <template #default="{ id, describedBy }">
              <CaSelect
                :id="id"
                v-model="editDepartmentId"
                :aria-describedby="describedBy"
                :options="departmentOptions"
                :disabled="!canManage"
              />
            </template>
          </CaField>
          <div v-if="auth.isSuperadmin" class="udetail-superadmin">
            <div class="udetail-superadmin__text">
              <p class="udetail-superadmin__title">{{ t('admin.users.superadminTitle') }}</p>
              <p class="udetail-superadmin__hint">{{ t('admin.users.superadminHint') }}</p>
            </div>
            <CaSwitch
              v-model="editSuperadmin"
              :disabled="!canManage"
              :label="
                editSuperadmin ? t('admin.users.superadminOn') : t('admin.users.superadminOff')
              "
            />
          </div>
          <div v-if="canManage" class="admin-form__actions">
            <CaButton variant="secondary" @click="openReset">
              {{ t('admin.users.resetPassword') }}
            </CaButton>
            <CaButton
              :variant="user.status === 'active' ? 'danger' : 'secondary'"
              @click="toggleStatus"
            >
              {{ user.status === 'active' ? t('admin.users.disable') : t('admin.users.enable') }}
            </CaButton>
            <CaButton variant="primary" type="submit" :loading="savingProfile">
              {{ t('common.save') }}
            </CaButton>
          </div>
        </form>
      </section>

      <section class="admin-section">
        <div class="udetail-section-head">
          <h2 class="admin-section__title">{{ t('admin.users.rolesSection') }}</h2>
          <CaButton v-if="canAssign" variant="secondary" @click="openAssign">
            {{ t('admin.users.addRole') }}
          </CaButton>
        </div>
        <p v-if="user.assignments.length === 0" class="admin-cell__sub">
          {{ t('admin.users.noRoles') }}
        </p>
        <ul v-else class="udetail-list">
          <li v-for="assignment in user.assignments" :key="assignment.id" class="udetail-item">
            <div class="admin-cell">
              <span class="admin-cell__primary">
                {{ assignment.roleName }}
                <span class="admin-mono">{{ assignment.roleCode }}</span>
              </span>
              <span class="admin-cell__sub">
                {{ t('admin.users.roleScope') }}: {{ scopeLabel(assignment.dataScope) }}
                <template v-if="assignment.departmentId">
                  · {{ departmentName(assignment.departmentId) }}
                </template>
                ·
                {{
                  assignment.source === 'group'
                    ? t('admin.users.sourceGroup')
                    : t('admin.users.sourceUser')
                }}
                <template v-if="assignment.groupName">({{ assignment.groupName }})</template>
              </span>
            </div>
            <CaButton
              v-if="canAssign && assignment.source === 'user'"
              variant="secondary"
              size="small"
              @click="revokeAssignment(assignment)"
            >
              {{ t('admin.users.revokeRole') }}
            </CaButton>
          </li>
        </ul>
      </section>

      <section class="admin-section">
        <h2 class="admin-section__title">{{ t('admin.users.groupsSection') }}</h2>
        <p v-if="user.groups.length === 0" class="admin-cell__sub">
          {{ t('admin.users.noGroups') }}
        </p>
        <ul v-else class="udetail-list">
          <li v-for="group in user.groups" :key="group.id" class="udetail-item">
            <div class="admin-cell">
              <RouterLink class="admin-name-link" :to="`/administration/groups/${group.id}`">
                {{ group.name }}
              </RouterLink>
              <span class="admin-cell__sub admin-mono">{{ group.code }}</span>
            </div>
          </li>
        </ul>
      </section>

      <CaDialog
        v-model:open="resetOpen"
        :title="t('admin.users.resetTitle')"
        :subtitle="t('admin.users.resetSubtitle')"
        size="small"
      >
        <p v-if="resetError" class="admin-error" role="alert">{{ resetError }}</p>
        <CaField :label="t('admin.users.resetField')" required>
          <template #default="{ id, describedBy }">
            <CaInput
              :id="id"
              v-model="resetPassword"
              :aria-describedby="describedBy"
              type="password"
            />
          </template>
        </CaField>
        <template #footer>
          <CaButton variant="secondary" @click="resetOpen = false">{{
            t('common.cancel')
          }}</CaButton>
          <CaButton variant="primary" :loading="resetSaving" @click="submitReset">
            {{ t('common.save') }}
          </CaButton>
        </template>
      </CaDialog>

      <CaDialog v-model:open="assignOpen" :title="t('admin.users.assignTitle')" size="small">
        <p v-if="assignError" class="admin-error" role="alert">{{ assignError }}</p>
        <form class="admin-form" @submit.prevent="submitAssign">
          <CaField :label="t('admin.users.assignRoleLabel')" required>
            <template #default="{ id, describedBy }">
              <CaSelect
                :id="id"
                v-model="assignForm.roleId"
                :aria-describedby="describedBy"
                :options="roleOptions"
              />
            </template>
          </CaField>
          <CaField :label="t('admin.users.assignScopeLabel')">
            <template #default="{ id, describedBy }">
              <CaSelect
                :id="id"
                v-model="assignForm.dataScope"
                :aria-describedby="describedBy"
                :options="scopeOptions"
              />
            </template>
          </CaField>
          <CaField
            v-if="assignForm.dataScope === 'department'"
            :label="t('admin.users.assignDepartmentLabel')"
          >
            <template #default="{ id, describedBy }">
              <CaSelect
                :id="id"
                v-model="assignForm.departmentId"
                :aria-describedby="describedBy"
                :options="departmentOptions"
              />
            </template>
          </CaField>
        </form>
        <template #footer>
          <CaButton variant="secondary" @click="assignOpen = false">{{
            t('common.cancel')
          }}</CaButton>
          <CaButton variant="primary" :loading="assignSaving" @click="submitAssign">
            {{ t('common.save') }}
          </CaButton>
        </template>
      </CaDialog>
    </template>

    <div v-else>
      <CaPageHeader :title="t('admin.users.detailTitle')" />
      <p class="admin-error" role="alert">{{ error || t('errors.loadFailed') }}</p>
      <RouterLink class="admin-name-link" to="/administration/users">{{
        t('common.back')
      }}</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.udetail-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-12) 0;
}

.udetail-back {
  color: var(--ca-color-brand);
  text-decoration: none;
  font-weight: var(--ca-font-weight-medium);
  font-size: var(--ca-text-200);
}

.udetail-badges {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  margin-top: calc(-1 * var(--ca-space-3));
}

.udetail-form {
  display: grid;
  grid-template-columns: minmax(220px, 320px) minmax(220px, 320px);
  gap: var(--ca-space-4);
  align-items: start;
}

.udetail-form .admin-form__actions {
  grid-column: 1 / -1;
}

.udetail-superadmin {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
  padding: var(--ca-space-4);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-md);
}

.udetail-superadmin__text {
  min-width: 0;
}

.udetail-superadmin__title {
  margin: 0;
  font-weight: var(--ca-font-weight-semibold);
  font-size: var(--ca-text-300);
}

.udetail-superadmin__hint {
  margin: var(--ca-space-1) 0 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}

.udetail-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-3);
  margin-bottom: var(--ca-space-3);
}

.udetail-section-head .admin-section__title {
  margin-bottom: 0;
}

.udetail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.udetail-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-3);
  padding: var(--ca-space-3) var(--ca-space-4);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-md);
}

@media (max-width: 720px) {
  .udetail-form {
    grid-template-columns: 1fr;
  }
}
</style>
