<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { PERMISSION_CATALOG } from '@contributor/shared';
import {
  listUsers,
  runAuthzTest,
  type AdminDataScope,
  type AdminUserRow,
  type AuthzTestResponse,
  type EffectiveChainEntry,
} from '@/api/admin';
import {
  CaBadge,
  CaButton,
  CaField,
  CaInput,
  CaPageHeader,
  CaSelect,
  CaSpinner,
  type CaSelectOption,
} from '@/components/ui';
import { useToastStore } from '@/stores/toast.store';

const { t } = useI18n();
const toast = useToastStore();

const userSearch = ref('');
const userResults = ref<AdminUserRow[]>([]);
const searching = ref(false);
const selectedUser = ref<AdminUserRow | null>(null);

const form = ref({
  permission: '',
  resourceType: '',
  resourceId: '',
  resourceOwnerId: '',
});

const running = ref(false);
const result = ref<AuthzTestResponse | null>(null);

const permissionOptions = computed<CaSelectOption[]>(() =>
  PERMISSION_CATALOG.map((p) => ({ value: p.id, label: `${p.name} — ${p.id}` })),
);

async function runSearch() {
  const term = userSearch.value.trim();
  if (term.length < 2) {
    userResults.value = [];
    return;
  }
  searching.value = true;
  try {
    const res = await listUsers({ search: term, page: 1, pageSize: 10 });
    userResults.value = res.items;
  } catch {
    userResults.value = [];
  } finally {
    searching.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(userSearch, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 300);
});

function pickUser(user: AdminUserRow) {
  selectedUser.value = user;
  userSearch.value = '';
  userResults.value = [];
}

async function run() {
  if (!selectedUser.value) {
    toast.push({ variant: 'warning', title: t('admin.authzTest.userRequired') });
    return;
  }
  if (!form.value.permission) {
    toast.push({ variant: 'warning', title: t('admin.authzTest.permissionRequired') });
    return;
  }
  running.value = true;
  result.value = null;
  try {
    result.value = await runAuthzTest({
      userId: selectedUser.value.id,
      permission: form.value.permission,
      resourceType: form.value.resourceType.trim() || undefined,
      resourceId: form.value.resourceId.trim() || undefined,
      resourceOwnerId: form.value.resourceOwnerId.trim() || undefined,
    });
  } catch {
    toast.push({ variant: 'danger', title: t('admin.authzTest.runFailed') });
  } finally {
    running.value = false;
  }
}

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

function chainEffectVariant(effect: EffectiveChainEntry['effect']): 'success' | 'danger' | 'neutral' {
  if (effect === 'allow') return 'success';
  if (effect === 'deny') return 'danger';
  return 'neutral';
}
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.authzTest.title')"
      :description="t('admin.authzTest.description')"
    />

    <div class="at-form">
      <CaField :label="t('admin.authzTest.formUser')">
        <template v-if="selectedUser">
          <div class="at-user">
            <span class="at-user__name">{{ selectedUser.display_name }}</span>
            <span class="at-user__mail">{{ selectedUser.email }}</span>
            <CaButton size="small" variant="subtle" @click="selectedUser = null">
              {{ t('admin.effectivePermissions.changeUser') }}
            </CaButton>
          </div>
        </template>
        <template v-else>
          <CaInput
            v-model="userSearch"
            type="search"
            :placeholder="t('admin.authzTest.pickUserPlaceholder')"
          />
        </template>
      </CaField>

      <ul v-if="!selectedUser && userResults.length > 0" class="at-results">
        <li v-for="user in userResults" :key="user.id">
          <button type="button" class="at-results__item" @click="pickUser(user)">
            <span class="at-user__name">{{ user.display_name }}</span>
            <span class="at-user__mail">{{ user.email }}</span>
          </button>
        </li>
      </ul>

      <CaField :label="t('admin.authzTest.formPermission')">
        <CaSelect
          v-model="form.permission"
          :options="permissionOptions"
          :placeholder="t('admin.authzTest.pickPermissionPlaceholder')"
        />
      </CaField>

      <div class="admin-form__row">
        <CaField :label="`${t('admin.authzTest.formResourceType')} (${t('admin.policies.resourceOptional')})`">
          <CaInput v-model="form.resourceType" />
        </CaField>
        <CaField :label="`${t('admin.authzTest.formResourceId')} (${t('admin.policies.resourceOptional')})`">
          <CaInput v-model="form.resourceId" />
        </CaField>
        <CaField :label="`${t('admin.authzTest.formResourceOwner')} (${t('admin.policies.resourceOptional')})`">
          <CaInput v-model="form.resourceOwnerId" />
        </CaField>
      </div>

      <div class="admin-form__actions">
        <CaButton variant="primary" :loading="running" @click="run">
          {{ t('admin.authzTest.run') }}
        </CaButton>
      </div>
    </div>

    <div v-if="running" class="at-loading"><CaSpinner size="large" /></div>

    <div v-else-if="result" class="at-result">
      <h2 class="at-result__title">{{ t('admin.authzTest.resultTitle') }}</h2>
      <div class="at-result__verdict">
        <CaBadge :variant="result.allowed ? 'success' : 'danger'">
          {{ result.allowed ? t('admin.effectivePermissions.allowed') : t('admin.effectivePermissions.denied') }}
        </CaBadge>
        <span class="at-result__reason">{{ reasonLabel(result.reason) }}</span>
        <span class="at-result__scope">{{ scopeLabel(result.scope) }}</span>
      </div>

      <h3 class="at-chain__title">{{ t('admin.authzTest.chainTitle') }}</h3>
      <ul v-if="result.chain.length > 0" class="at-chain">
        <li v-for="(entry, i) in result.chain" :key="i" class="at-chain__item">
          <CaBadge :variant="chainEffectVariant(entry.effect)">{{ entry.kind }}</CaBadge>
          <div class="at-chain__body">
            <span class="at-chain__label">{{ entry.label }}</span>
            <span class="at-chain__detail">{{ entry.detail }}</span>
          </div>
        </li>
      </ul>
      <p v-else class="at-empty">{{ t('admin.authzTest.chainEmpty') }}</p>
    </div>
  </section>
</template>

<style scoped>
.at-form {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.at-user {
  display: flex;
  align-items: center;
  gap: var(--ca-space-6);
}

.at-user__name {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.at-user__mail {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.at-results {
  list-style: none;
  margin: 0 0 var(--ca-space-8);
  padding: 0;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-bg-surface);
  overflow: hidden;
}

.at-results__item {
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

.at-results__item:hover {
  background: var(--ca-bg-surface-hover);
}

.at-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-24) 0;
}

.at-result {
  margin-top: var(--ca-space-12);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-bg-surface);
  padding: var(--ca-space-8);
  max-width: 720px;
}

.at-result__title {
  margin: 0 0 var(--ca-space-6);
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.at-result__verdict {
  display: flex;
  align-items: center;
  gap: var(--ca-space-8);
}

.at-result__reason {
  color: var(--ca-fg-1);
  font-size: var(--ca-text-300);
}

.at-result__scope {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.at-chain__title {
  margin: var(--ca-space-12) 0 var(--ca-space-4);
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.at-chain {
  list-style: none;
  margin: 0;
  padding: 0;
}

.at-chain__item {
  display: flex;
  align-items: flex-start;
  gap: var(--ca-space-8);
  padding: var(--ca-space-6) 0;
  border-bottom: 1px solid var(--ca-stroke-3);
}

.at-chain__item:last-child {
  border-bottom: none;
}

.at-chain__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.at-chain__label {
  color: var(--ca-fg-1);
  font-size: var(--ca-text-200);
  font-weight: var(--ca-font-weight-medium);
}

.at-chain__detail {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-100);
}

.at-empty {
  margin: var(--ca-space-4) 0 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}
</style>
