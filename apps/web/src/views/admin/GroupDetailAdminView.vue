<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import {
  addGroupMembers,
  assignGroupRole,
  getGroup,
  listDepartments,
  listRoles,
  listUsers,
  removeGroupMember,
  revokeGroupRole,
  type AdminDepartmentNode,
  type AdminDataScope,
  type AdminGroupDetail,
  type AdminGroupMember,
  type AdminRoleRow,
  type AdminUserRow,
} from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaCheckbox,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaSelect,
  CaSpinner,
  type CaSelectOption,
} from '@/components/ui';

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const toast = useToastStore();

const canManageMembers = computed(() => auth.can('rbac.groups.manage'));
const canAssignRoles = computed(() => auth.can('rbac.permissions.assign'));

const groupId = computed(() => String(route.params.id));
const group = ref<AdminGroupDetail | null>(null);
const loading = ref(true);
const error = ref('');
const saving = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    group.value = await getGroup(groupId.value);
  } catch {
    group.value = null;
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

const showMembers = ref(false);
const memberSearch = ref('');
const memberResults = ref<AdminUserRow[]>([]);
const memberSearching = ref(false);
const pendingIds = ref<Set<string>>(new Set());

const memberIds = computed(() => new Set((group.value?.members ?? []).map((m) => m.id)));

async function searchUsers() {
  const term = memberSearch.value.trim();
  if (term.length < 2) {
    memberResults.value = [];
    return;
  }
  memberSearching.value = true;
  try {
    const result = await listUsers({ search: term, page: 1, pageSize: 10 });
    memberResults.value = result.items.filter((u) => !memberIds.value.has(u.id));
  } catch {
    memberResults.value = [];
  } finally {
    memberSearching.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(memberSearch, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchUsers, 300);
});

function togglePending(userId: string, checked: boolean) {
  const next = new Set(pendingIds.value);
  if (checked) next.add(userId);
  else next.delete(userId);
  pendingIds.value = next;
}

function openMembers() {
  memberSearch.value = '';
  memberResults.value = [];
  pendingIds.value = new Set();
  showMembers.value = true;
}

async function submitMembers() {
  if (pendingIds.value.size === 0) return;
  saving.value = true;
  try {
    await addGroupMembers(groupId.value, [...pendingIds.value]);
    toast.push({ variant: 'success', title: t('admin.groupDetail.membersAdded') });
    showMembers.value = false;
    await load();
  } catch {
    toast.push({ variant: 'danger', title: t('errors.saveFailed') });
  } finally {
    saving.value = false;
  }
}

const confirmingUser = ref<AdminGroupMember | null>(null);
const showRemoveConfirm = ref(false);

function openRemoveMember(member: AdminGroupMember) {
  confirmingUser.value = member;
  showRemoveConfirm.value = true;
}

async function confirmRemoveMember() {
  if (!confirmingUser.value) return;
  saving.value = true;
  try {
    await removeGroupMember(groupId.value, confirmingUser.value.id);
    toast.push({ variant: 'success', title: t('admin.groupDetail.memberRemoved') });
    showRemoveConfirm.value = false;
    await load();
  } catch {
    toast.push({ variant: 'danger', title: t('errors.saveFailed') });
  } finally {
    saving.value = false;
  }
}

const showRole = ref(false);
const rolesCatalog = ref<AdminRoleRow[]>([]);
const departments = ref<AdminDepartmentNode[]>([]);
const roleForm = ref({ roleId: '', dataScope: 'department' as AdminDataScope, departmentId: '' });

const roleOptions = computed<CaSelectOption[]>(() => {
  const assigned = new Set((group.value?.roles ?? []).map((r) => r.roleId));
  return rolesCatalog.value
    .filter((r) => !assigned.has(r.id))
    .map((r) => ({ value: r.id, label: r.name }));
});

const scopeOptions = computed<CaSelectOption[]>(() => [
  { value: 'global', label: t('admin.groupDetail.scopeGlobal') },
  { value: 'department', label: t('admin.groupDetail.scopeDepartment') },
  { value: 'own', label: t('admin.groupDetail.scopeOwn') },
]);

const departmentOptions = computed<CaSelectOption[]>(() => flattenDepartments(departments.value));

function flattenDepartments(nodes: AdminDepartmentNode[], depth = 0): CaSelectOption[] {
  const options: CaSelectOption[] = [];
  for (const node of nodes) {
    options.push({ value: node.id, label: `${'— '.repeat(depth)}${node.name}` });
    options.push(...flattenDepartments(node.children, depth + 1));
  }
  return options;
}

async function openRole() {
  roleForm.value = { roleId: '', dataScope: 'department', departmentId: '' };
  showRole.value = true;
  if (rolesCatalog.value.length === 0) {
    try {
      rolesCatalog.value = await listRoles();
    } catch {
      toast.push({ variant: 'danger', title: t('errors.loadFailed') });
    }
  }
  if (departments.value.length === 0) {
    try {
      departments.value = await listDepartments();
    } catch {
      departments.value = [];
    }
  }
}

async function submitRole() {
  const { roleId, dataScope, departmentId } = roleForm.value;
  if (!roleId) return;
  saving.value = true;
  try {
    await assignGroupRole(groupId.value, {
      roleId,
      dataScope,
      departmentId: dataScope === 'department' && departmentId ? departmentId : undefined,
    });
    toast.push({ variant: 'success', title: t('admin.groupDetail.roleAssigned') });
    showRole.value = false;
    await load();
  } catch {
    toast.push({ variant: 'danger', title: t('errors.saveFailed') });
  } finally {
    saving.value = false;
  }
}

const confirmingRole = ref<{ id: string; label: string } | null>(null);
const showRevokeConfirm = ref(false);

function openRevokeRole(assignmentId: string, roleName: string) {
  confirmingRole.value = { id: assignmentId, label: roleName };
  showRevokeConfirm.value = true;
}

async function confirmRevokeRole() {
  if (!confirmingRole.value) return;
  saving.value = true;
  try {
    await revokeGroupRole(groupId.value, confirmingRole.value.id);
    toast.push({ variant: 'success', title: t('admin.groupDetail.roleRevoked') });
    showRevokeConfirm.value = false;
    await load();
  } catch {
    toast.push({ variant: 'danger', title: t('errors.saveFailed') });
  } finally {
    saving.value = false;
  }
}

function scopeLabel(scope: AdminDataScope): string {
  if (scope === 'global') return t('admin.groupDetail.scopeGlobal');
  if (scope === 'department') return t('admin.groupDetail.scopeDepartment');
  return t('admin.groupDetail.scopeOwn');
}

function departmentName(id: string | null): string {
  if (!id) return '—';
  const all = flattenDepartments(departments.value);
  return all.find((option) => option.value === id)?.label.replace(/^— /, '') ?? id;
}

onMounted(() => {
  load();
  listDepartments()
    .then((nodes) => {
      departments.value = nodes;
    })
    .catch(() => undefined);
});
</script>

<template>
  <section>
    <div v-if="loading" class="gd-loading"><CaSpinner size="large" /></div>

    <template v-else-if="error">
      <p class="admin-error">{{ error }}</p>
      <CaButton variant="secondary" @click="load">{{ t('common.retry') }}</CaButton>
    </template>

    <template v-else-if="group">
      <CaPageHeader :title="group.name" :description="group.description ?? undefined" />

      <div class="gd-meta">
        <span class="admin-mono">{{ group.code }}</span>
        <span>{{ t('admin.groups.memberCount', { count: group.members.length }) }}</span>
        <span>{{ t('admin.groups.roleCount', { count: group.roles.length }) }}</span>
        <RouterLink class="gd-back" to="/administration/groups">
          {{ t('admin.groupDetail.back') }}
        </RouterLink>
      </div>

      <div class="gd-section">
        <div class="gd-section__head">
          <div>
            <h2 class="gd-section__title">{{ t('admin.groupDetail.membersTitle') }}</h2>
            <p class="gd-section__desc">{{ t('admin.groupDetail.membersDescription') }}</p>
          </div>
          <CaButton v-if="canManageMembers" variant="secondary" @click="openMembers">
            {{ t('admin.groupDetail.addMembers') }}
          </CaButton>
        </div>

        <ul v-if="group.members.length > 0" class="gd-rows">
          <li v-for="member in group.members" :key="member.id" class="gd-row">
            <div class="gd-row__main">
              <RouterLink class="admin-name-link" :to="`/administration/users/${member.id}`">
                {{ member.display_name }}
              </RouterLink>
              <span class="gd-row__sub">{{ member.email }}</span>
            </div>
            <span v-if="member.department_name" class="gd-row__dept">{{ member.department_name }}</span>
            <CaBadge :variant="member.status === 'active' ? 'success' : 'neutral'">
              {{ member.status === 'active' ? t('admin.users.statusActive') : t('admin.users.statusDisabled') }}
            </CaBadge>
            <CaButton v-if="canManageMembers" size="small" variant="subtle" @click="openRemoveMember(member)">
              {{ t('admin.groupDetail.removeMember') }}
            </CaButton>
          </li>
        </ul>
        <p v-else class="gd-empty">{{ t('admin.groupDetail.noMembers') }}</p>
      </div>

      <div class="gd-section">
        <div class="gd-section__head">
          <div>
            <h2 class="gd-section__title">{{ t('admin.groupDetail.rolesTitle') }}</h2>
            <p class="gd-section__desc">{{ t('admin.groupDetail.rolesDescription') }}</p>
          </div>
          <CaButton v-if="canAssignRoles" variant="secondary" @click="openRole">
            {{ t('admin.groupDetail.addRole') }}
          </CaButton>
        </div>

        <ul v-if="group.roles.length > 0" class="gd-rows">
          <li v-for="assignment in group.roles" :key="assignment.id" class="gd-row">
            <div class="gd-row__main">
              <RouterLink class="admin-name-link" :to="`/administration/roles/${assignment.roleId}`">
                {{ assignment.roleName }}
              </RouterLink>
              <span class="admin-mono gd-row__sub">{{ assignment.roleCode }}</span>
            </div>
            <span class="gd-row__dept">
              {{ scopeLabel(assignment.dataScope) }}
              <template v-if="assignment.dataScope === 'department' && assignment.departmentId">
                · {{ departmentName(assignment.departmentId) }}
              </template>
            </span>
            <CaButton v-if="canAssignRoles" size="small" variant="subtle" @click="openRevokeRole(assignment.id, assignment.roleName)">
              {{ t('common.remove') }}
            </CaButton>
          </li>
        </ul>
        <p v-else class="gd-empty">{{ t('admin.groupDetail.noRoles') }}</p>
      </div>

      <CaDialog
        v-model:open="showMembers"
        :title="t('admin.groupDetail.addMembersTitle')"
        size="medium"
      >
        <div class="admin-form">
          <CaField :label="t('admin.groupDetail.search')">
            <CaInput
              v-model="memberSearch"
              :placeholder="t('admin.groupDetail.memberSearchPlaceholder')"
            />
          </CaField>
          <p v-if="memberSearching" class="gd-search-state">{{ t('common.loading') }}</p>
          <ul v-else-if="memberResults.length > 0" class="gd-search-list">
            <li v-for="user in memberResults" :key="user.id" class="gd-search-item">
              <CaCheckbox
                :model-value="pendingIds.has(user.id)"
                @update:model-value="(v) => togglePending(user.id, v)"
              >
                <span class="gd-row__main">
                  <span>{{ user.display_name }}</span>
                  <span class="gd-row__sub">{{ user.email }}</span>
                </span>
              </CaCheckbox>
            </li>
          </ul>
          <p v-else-if="memberSearch.trim().length >= 2" class="gd-search-state">
            {{ t('common.none') }}
          </p>
          <p v-else class="gd-search-state">{{ t('admin.groupDetail.memberSearchHint') }}</p>
        </div>
        <template #footer>
          <span class="gd-selected">{{ t('admin.groupDetail.selectedCount', { count: pendingIds.size }) }}</span>
          <CaButton variant="subtle" @click="showMembers = false">
            {{ t('common.cancel') }}
          </CaButton>
          <CaButton
            variant="primary"
            :disabled="saving || pendingIds.size === 0"
            @click="submitMembers"
          >
            {{ t('common.save') }}
          </CaButton>
        </template>
      </CaDialog>

      <CaDialog
        v-model:open="showRole"
        :title="t('admin.groupDetail.assignRoleTitle')"
        size="small"
      >
        <div class="admin-form">
          <CaField :label="t('admin.groupDetail.formRole')">
            <CaSelect
              v-model="roleForm.roleId"
              :options="roleOptions"
              :placeholder="t('admin.policies.formSubjectPlaceholder')"
            />
          </CaField>
          <CaField :label="t('admin.groupDetail.formDataScope')">
            <CaSelect v-model="roleForm.dataScope" :options="scopeOptions" />
          </CaField>
          <CaField
            v-if="roleForm.dataScope === 'department'"
            :label="t('admin.groupDetail.scopeDepartment')"
          >
            <CaSelect v-model="roleForm.departmentId" :options="departmentOptions" />
          </CaField>
        </div>
        <template #footer>
          <CaButton variant="subtle" @click="showRole = false">
            {{ t('common.cancel') }}
          </CaButton>
          <CaButton
            variant="primary"
            :disabled="saving || !roleForm.roleId"
            @click="submitRole"
          >
            {{ t('common.save') }}
          </CaButton>
        </template>
      </CaDialog>

      <CaDialog
        v-model:open="showRemoveConfirm"
        :title="t('admin.groupDetail.removeMember')"
        size="small"
      >
        <p class="gd-confirm-text">
          {{ t('admin.groupDetail.removeMemberConfirm', { name: confirmingUser?.display_name ?? '' }) }}
        </p>
        <template #footer>
          <CaButton variant="subtle" @click="showRemoveConfirm = false">
            {{ t('common.cancel') }}
          </CaButton>
          <CaButton variant="danger" :disabled="saving" @click="confirmRemoveMember">
            {{ t('admin.groupDetail.removeMember') }}
          </CaButton>
        </template>
      </CaDialog>

      <CaDialog
        v-model:open="showRevokeConfirm"
        :title="t('admin.groupDetail.rolesTitle')"
        size="small"
      >
        <p class="gd-confirm-text">
          {{ t('admin.groupDetail.revokeRoleConfirm', { name: confirmingRole?.label ?? '' }) }}
        </p>
        <template #footer>
          <CaButton variant="subtle" @click="showRevokeConfirm = false">
            {{ t('common.cancel') }}
          </CaButton>
          <CaButton variant="danger" :disabled="saving" @click="confirmRevokeRole">
            {{ t('common.remove') }}
          </CaButton>
        </template>
      </CaDialog>
    </template>
  </section>
</template>

<style scoped>
.gd-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-24) 0;
}

.gd-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ca-space-8);
  margin: var(--ca-space-4) 0 var(--ca-space-12);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.gd-back {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
  text-decoration: none;
  margin-left: auto;
}

.gd-back:hover {
  color: var(--ca-fg-1);
  text-decoration: underline;
}

.gd-section {
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-bg-surface);
  padding: var(--ca-space-8);
  margin-bottom: var(--ca-space-12);
}

.gd-section__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ca-space-8);
  margin-bottom: var(--ca-space-8);
}

.gd-section__title {
  margin: 0;
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.gd-section__desc {
  margin: 2px 0 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.gd-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.gd-row {
  display: flex;
  align-items: center;
  gap: var(--ca-space-8);
  padding: var(--ca-space-6) 0;
  border-top: 1px solid var(--ca-stroke-3);
}

.gd-row__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.gd-row__sub {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.gd-row__dept {
  margin-left: auto;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.gd-empty {
  margin: 0;
  padding: var(--ca-space-8) 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.gd-search-state {
  margin: 0;
  padding: var(--ca-space-6) 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.gd-search-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 280px;
  overflow-y: auto;
}

.gd-search-item {
  padding: var(--ca-space-4) 0;
}

.gd-selected {
  margin-right: auto;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.gd-confirm-text {
  margin: 0;
  color: var(--ca-fg-2);
}
</style>
