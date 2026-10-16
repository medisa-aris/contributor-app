<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  getEffectivePermissions,
  listUsers,
  type AdminDataScope,
  type AdminUserRow,
  type EffectiveChainEntry,
  type EffectiveDecision,
  type EffectivePermissionsResponse,
} from '@/api/admin';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaInput,
  CaPageHeader,
  CaSelect,
  CaSpinner,
  CaTable,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';

const { t } = useI18n();

const search = ref('');
const searchResults = ref<AdminUserRow[]>([]);
const searching = ref(false);
const searchError = ref('');

const selectedUser = ref<AdminUserRow | null>(null);
const effective = ref<EffectivePermissionsResponse | null>(null);
const loading = ref(false);
const error = ref('');

const decisionFilter = ref('');
const permissionFilter = ref('');

const decisionOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('admin.effectivePermissions.filterAll') },
  { value: 'allowed', label: t('admin.effectivePermissions.filterAllowed') },
  { value: 'denied', label: t('admin.effectivePermissions.filterDenied') },
]);

async function runSearch() {
  const term = search.value.trim();
  if (term.length < 2) {
    searchResults.value = [];
    return;
  }
  searching.value = true;
  searchError.value = '';
  try {
    const result = await listUsers({ search: term, page: 1, pageSize: 10 });
    searchResults.value = result.items;
  } catch {
    searchError.value = t('errors.loadFailed');
  } finally {
    searching.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 300);
});

async function pickUser(user: AdminUserRow) {
  selectedUser.value = user;
  searchResults.value = [];
  search.value = '';
  decisionFilter.value = '';
  permissionFilter.value = '';
  loading.value = true;
  error.value = '';
  try {
    effective.value = await getEffectivePermissions(user.id);
  } catch {
    effective.value = null;
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

function resetUser() {
  selectedUser.value = null;
  effective.value = null;
  error.value = '';
}

const filteredDecisions = computed<EffectiveDecision[]>(() => {
  const decisions = effective.value?.decisions ?? [];
  const term = permissionFilter.value.trim().toLowerCase();
  return decisions.filter((d) => {
    if (decisionFilter.value === 'allowed' && !d.allowed) return false;
    if (decisionFilter.value === 'denied' && d.allowed) return false;
    if (term && !d.permission.toLowerCase().includes(term)) return false;
    return true;
  });
});

const columns = computed<CaTableColumn[]>(() => [
  { key: 'permission', label: t('admin.effectivePermissions.columnPermission') },
  { key: 'decision', label: t('admin.effectivePermissions.columnDecision'), width: '120px', sortValue: (row) => row.allowed },
  { key: 'reason', label: t('admin.effectivePermissions.columnReason'), width: '220px' },
  { key: 'scope', label: t('admin.effectivePermissions.columnScope'), width: '120px' },
]);

function reasonLabel(reason: string): string {
  const path = `admin.effectivePermissions.reasons.${reason}`;
  const label = t(path);
  return label === path ? reason : label;
}

function scopeLabel(scope: AdminDataScope | null): string {
  if (!scope) return '—';
  if (scope === 'global') return t('admin.groupDetail.scopeGlobal');
  if (scope === 'department') return t('admin.groupDetail.scopeDepartment');
  return t('admin.groupDetail.scopeOwn');
}

const chainOpen = ref(false);
const chainPermission = ref('');
const chain = ref<EffectiveChainEntry[]>([]);

function openChain(decision: EffectiveDecision) {
  chainPermission.value = decision.permission;
  chain.value = decision.chain;
  chainOpen.value = true;
}

function chainEffectVariant(effect: EffectiveChainEntry['effect']): 'success' | 'danger' | 'neutral' {
  if (effect === 'allow') return 'success';
  if (effect === 'deny') return 'danger';
  return 'neutral';
}
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.effectivePermissions.title')"
      :description="t('admin.effectivePermissions.description')"
    />

    <div v-if="!selectedUser" class="eff-search">
      <CaInput
        v-model="search"
        type="search"
        :placeholder="t('admin.effectivePermissions.searchPlaceholder')"
      />
      <p v-if="searching" class="eff-search__state">{{ t('common.loading') }}</p>
      <ul v-else-if="searchResults.length > 0" class="eff-list">
        <li v-for="user in searchResults" :key="user.id">
          <button type="button" class="eff-list__item" @click="pickUser(user)">
            <span class="eff-list__name">{{ user.display_name }}</span>
            <span class="eff-list__mail">{{ user.email }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="search.trim().length >= 2" class="eff-search__state">
        {{ t('common.none') }}
      </p>
      <p v-else class="eff-search__state">
        {{ t('admin.effectivePermissions.pickUserHint') }}
      </p>
      <p v-if="searchError" class="admin-error">{{ searchError }}</p>
    </div>

    <template v-else>
      <div class="eff-user">
        <div class="eff-user__main">
          <span class="eff-user__name">{{ selectedUser.display_name }}</span>
          <span class="eff-user__mail">{{ selectedUser.email }}</span>
        </div>
        <CaBadge v-if="effective?.isSuperadmin" variant="brand">
          {{ t('admin.users.superadminBadge') }}
        </CaBadge>
        <span v-if="effective" class="eff-user__version">
          {{ t('admin.effectivePermissions.rbacVersion', { version: effective.rbacVersion }) }}
        </span>
        <CaButton size="small" variant="subtle" @click="resetUser">
          {{ t('admin.effectivePermissions.changeUser') }}
        </CaButton>
      </div>

      <div v-if="loading" class="eff-loading"><CaSpinner size="large" /></div>

      <template v-else-if="effective">
        <p v-if="effective.isSuperadmin" class="eff-superadmin">
          {{ t('admin.effectivePermissions.superadminNotice') }}
        </p>

        <div class="eff-assignments">
          <h2 class="eff-section__title">{{ t('admin.effectivePermissions.assignmentsTitle') }}</h2>
          <div v-if="effective.assignments.length > 0" class="eff-chips">
            <span v-for="(a, i) in effective.assignments" :key="i" class="eff-chip">
              {{ a.roleName }}
              <span class="eff-chip__scope">{{ scopeLabel(a.dataScope) }}</span>
            </span>
          </div>
          <p v-else class="eff-search__state">—</p>
        </div>

        <div class="eff-decisions">
          <h2 class="eff-section__title">{{ t('admin.effectivePermissions.decisionsTitle') }}</h2>
          <div class="admin-filters">
            <div class="admin-filters__field">
              <CaSelect v-model="decisionFilter" :options="decisionOptions" />
            </div>
            <div class="admin-filters__field admin-filters__wide">
              <CaInput
                v-model="permissionFilter"
                type="search"
                :placeholder="t('admin.effectivePermissions.filterPlaceholder')"
              />
            </div>
            <div class="admin-filters__spacer" />
            <span class="eff-user__version">
              {{ filteredDecisions.length }} / {{ effective.decisions.length }}
            </span>
          </div>

          <CaTable
            table-key="admin-effective-permissions"
            :columns="columns"
            :rows="filteredDecisions"
            :row-key="(row) => row.permission"
          >
            <template #cell-permission="{ row }">
              <button type="button" class="eff-perm-link admin-mono" @click="openChain(row)">
                {{ row.permission }}
              </button>
            </template>
            <template #cell-decision="{ row }">
              <CaBadge :variant="row.allowed ? 'success' : 'danger'">
                {{ row.allowed ? t('admin.effectivePermissions.allowed') : t('admin.effectivePermissions.denied') }}
              </CaBadge>
            </template>
            <template #cell-reason="{ row }">
              {{ reasonLabel(row.reason) }}
            </template>
            <template #cell-scope="{ row }">
              {{ scopeLabel(row.scope) }}
            </template>
          </CaTable>
        </div>
      </template>

      <p v-else-if="error" class="admin-error">{{ error }}</p>
    </template>

    <CaDialog
      v-model:open="chainOpen"
      :title="t('admin.effectivePermissions.chainTitle')"
      :subtitle="chainPermission"
      size="medium"
    >
      <ul v-if="chain.length > 0" class="eff-chain">
        <li v-for="(entry, i) in chain" :key="i" class="eff-chain__item">
          <CaBadge :variant="chainEffectVariant(entry.effect)">{{ entry.kind }}</CaBadge>
          <div class="eff-chain__body">
            <span class="eff-chain__label">{{ entry.label }}</span>
            <span class="eff-chain__detail">{{ entry.detail }}</span>
          </div>
        </li>
      </ul>
      <p v-else class="eff-search__state">
        {{ t('admin.effectivePermissions.chainEmpty') }}
      </p>
    </CaDialog>
  </section>
</template>

<style scoped>
.eff-search {
  max-width: 560px;
}

.eff-search__state {
  margin: var(--ca-space-6) 0 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.eff-list {
  list-style: none;
  margin: var(--ca-space-6) 0 0;
  padding: 0;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-bg-surface);
  overflow: hidden;
}

.eff-list__item {
  display: flex;
  align-items: baseline;
  gap: var(--ca-space-8);
  width: 100%;
  padding: var(--ca-space-6) var(--ca-space-8);
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.eff-list__item:hover {
  background: var(--ca-bg-surface-hover);
}

.eff-list__name {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.eff-list__mail {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.eff-user {
  display: flex;
  align-items: center;
  gap: var(--ca-space-8);
  flex-wrap: wrap;
  margin: var(--ca-space-4) 0 var(--ca-space-12);
}

.eff-user__main {
  display: flex;
  flex-direction: column;
}

.eff-user__name {
  font-size: var(--ca-text-500);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.eff-user__mail {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.eff-user__version {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.eff-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-24) 0;
}

.eff-superadmin {
  margin: 0 0 var(--ca-space-8);
  padding: var(--ca-space-6) var(--ca-space-8);
  background: var(--ca-info-bg);
  color: var(--ca-info-fg);
  border-radius: var(--ca-radius-md);
  font-size: var(--ca-text-200);
}

.eff-section__title {
  margin: 0 0 var(--ca-space-6);
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.eff-assignments {
  margin-bottom: var(--ca-space-12);
}

.eff-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-4);
}

.eff-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-4);
  padding: 2px var(--ca-space-6);
  border-radius: var(--ca-radius-circular);
  background: var(--ca-bg-surface-3);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
}

.eff-chip__scope {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-100);
}

.eff-perm-link {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  color: var(--ca-color-link);
  font-size: var(--ca-text-200);
}

.eff-perm-link:hover {
  text-decoration: underline;
}

.eff-chain {
  list-style: none;
  margin: 0;
  padding: 0;
}

.eff-chain__item {
  display: flex;
  align-items: flex-start;
  gap: var(--ca-space-8);
  padding: var(--ca-space-6) 0;
  border-bottom: 1px solid var(--ca-stroke-3);
}

.eff-chain__item:last-child {
  border-bottom: none;
}

.eff-chain__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.eff-chain__label {
  color: var(--ca-fg-1);
  font-size: var(--ca-text-200);
  font-weight: var(--ca-font-weight-medium);
}

.eff-chain__detail {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-100);
}
</style>
