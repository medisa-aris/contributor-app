<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import { PERMISSION_CATALOG } from '@contributor/shared';
import {
  getRolePermissions,
  listPermissions,
  listRoles,
  replaceRolePermissions,
  type AdminPermissionRow,
  type AdminRoleRow,
} from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaCheckbox,
  CaPageHeader,
  CaSpinner,
} from '@/components/ui';

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const toast = useToastStore();

const canAssign = computed(() => auth.can('rbac.permissions.assign'));
const roleId = computed(() => String(route.params.id));

const role = ref<AdminRoleRow | null>(null);
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);

type MatrixPermission = {
  identifier: string;
  name: string;
  description: string | null;
};

type MatrixModule = {
  key: string;
  permissions: MatrixPermission[];
};

type MatrixApplication = {
  key: string;
  label: string;
  modules: MatrixModule[];
};

const matrix = ref<MatrixApplication[]>([]);
const selected = ref<Set<string>>(new Set());
const original = ref<Set<string>>(new Set());

function guessApplication(identifier: string): string {
  if (identifier.startsWith('ai.')) return 'ai-workspace';
  if (identifier.startsWith('knowledge.')) return 'knowledge-center';
  if (identifier.startsWith('agents.')) return 'agent-center';
  if (identifier.startsWith('integrations.')) return 'integration-center';
  return 'administration';
}

function buildMatrix(dbRows: AdminPermissionRow[]) {
  const catalogById = new Map(PERMISSION_CATALOG.map((p) => [p.id as string, p]));
  const dbById = new Map(dbRows.map((r) => [r.identifier, r]));
  const identifiers = new Set<string>([
    ...PERMISSION_CATALOG.map((p) => p.id as string),
    ...dbRows.map((r) => r.identifier),
  ]);

  const apps = new Map<string, Map<string, MatrixPermission[]>>();
  for (const identifier of identifiers) {
    const def = catalogById.get(identifier);
    const row = dbById.get(identifier);
    const application = def?.application ?? guessApplication(identifier);
    const module = def?.module ?? 'other';
    if (!apps.has(application)) apps.set(application, new Map());
    const modules = apps.get(application)!;
    if (!modules.has(module)) modules.set(module, []);
    modules.get(module)!.push({
      identifier,
      name: row?.name ?? def?.name ?? identifier,
      description: row?.description ?? def?.description ?? null,
    });
  }

  matrix.value = [...apps.entries()]
    .map(([key, modules]) => ({
      key,
      label: appLabel(key),
      modules: [...modules.entries()]
        .map(([moduleKey, permissions]) => ({
          key: moduleKey,
          permissions: permissions.sort((a, b) => a.identifier.localeCompare(b.identifier)),
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function appLabel(key: string): string {
  const path = `admin.roleDetail.apps.${key}`;
  const label = t(path);
  return label === path ? t('admin.roleDetail.other') : label;
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [roles, dbRows, assigned] = await Promise.all([
      listRoles(),
      listPermissions(),
      getRolePermissions(roleId.value),
    ]);
    role.value = roles.find((r) => r.id === roleId.value) ?? null;
    buildMatrix(dbRows);
    selected.value = new Set(assigned);
    original.value = new Set(assigned);
  } catch {
    loadError.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

const dirty = computed(() => {
  if (selected.value.size !== original.value.size) return true;
  for (const id of selected.value) {
    if (!original.value.has(id)) return true;
  }
  return false;
});

const allIdentifiers = computed(() =>
  matrix.value.flatMap((app) =>
    app.modules.flatMap((m) => m.permissions.map((p) => p.identifier)),
  ),
);

function toggle(identifier: string, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) next.add(identifier);
  else next.delete(identifier);
  selected.value = next;
}

function moduleState(permissions: MatrixPermission[]): {
  checked: boolean;
  indeterminate: boolean;
} {
  const count = permissions.filter((p) => selected.value.has(p.identifier)).length;
  return {
    checked: count === permissions.length && count > 0,
    indeterminate: count > 0 && count < permissions.length,
  };
}

function toggleModule(permissions: MatrixPermission[], checked: boolean) {
  const next = new Set(selected.value);
  for (const p of permissions) {
    if (checked) next.add(p.identifier);
    else next.delete(p.identifier);
  }
  selected.value = next;
}

function selectAll() {
  selected.value = new Set(allIdentifiers.value);
}

function clearAll() {
  selected.value = new Set();
}

async function save() {
  saving.value = true;
  try {
    await replaceRolePermissions(roleId.value, [...selected.value].sort());
    original.value = new Set(selected.value);
    toast.push({ variant: 'success', title: t('admin.roles.matrixSaved') });
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
    <div v-if="loading" class="rd-loading"><CaSpinner size="large" /></div>

    <template v-else-if="loadError">
      <p class="admin-error">{{ loadError }}</p>
      <CaButton variant="secondary" @click="load">{{ t('common.retry') }}</CaButton>
    </template>

    <template v-else-if="!role">
      <p class="admin-error">{{ t('admin.roleDetail.notFound') }}</p>
      <RouterLink class="rd-back" to="/administration/roles">
        {{ t('admin.roleDetail.back') }}
      </RouterLink>
    </template>

    <template v-else>
      <CaPageHeader :title="role.name" :description="role.description ?? undefined">
        <template #actions>
          <CaButton v-if="canAssign" variant="primary" :loading="saving" :disabled="!dirty" @click="save">
            {{ t('admin.roles.matrixSave') }}
          </CaButton>
        </template>
      </CaPageHeader>

      <div class="rd-meta">
        <CaBadge :variant="role.is_system ? 'brand' : 'neutral'">
          {{ role.is_system ? t('admin.roles.systemBadge') : t('admin.roles.customBadge') }}
        </CaBadge>
        <span class="admin-mono">{{ role.code }}</span>
        <span>{{ t('admin.roles.permissionCount', { count: selected.size }) }}</span>
        <RouterLink class="rd-back" to="/administration/roles">
          {{ t('admin.roleDetail.back') }}
        </RouterLink>
      </div>

      <div class="rd-matrix">
        <div class="rd-matrix__toolbar">
          <p class="rd-matrix__hint">{{ t('admin.roles.matrixDescription') }}</p>
          <div class="rd-matrix__actions">
            <CaButton size="small" variant="subtle" :disabled="!canAssign" @click="selectAll">
              {{ t('admin.roleDetail.selectAll') }}
            </CaButton>
            <CaButton size="small" variant="subtle" :disabled="!canAssign" @click="clearAll">
              {{ t('admin.roleDetail.clear') }}
            </CaButton>
          </div>
        </div>

        <p v-if="dirty" class="rd-matrix__dirty">{{ t('admin.roles.matrixDirty') }}</p>

        <div v-for="app in matrix" :key="app.key" class="rd-app">
          <h2 class="rd-app__title">{{ app.label }}</h2>
          <div v-for="mod in app.modules" :key="mod.key" class="rd-module">
            <div class="rd-module__head">
              <CaCheckbox
                :label="mod.key"
                :disabled="!canAssign"
                :model-value="moduleState(mod.permissions).checked"
                :indeterminate="moduleState(mod.permissions).indeterminate"
                @update:model-value="(v) => toggleModule(mod.permissions, v)"
              />
            </div>
            <ul class="rd-perms">
              <li v-for="perm in mod.permissions" :key="perm.identifier" class="rd-perm">
                <CaCheckbox
                  :disabled="!canAssign"
                  :model-value="selected.has(perm.identifier)"
                  @update:model-value="(v) => toggle(perm.identifier, v)"
                >
                  <span class="rd-perm__name">{{ perm.name }}</span>
                  <span class="admin-mono rd-perm__id">{{ perm.identifier }}</span>
                  <span v-if="perm.description" class="rd-perm__desc">
                    {{ perm.description }}
                  </span>
                </CaCheckbox>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.rd-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-24) 0;
}

.rd-back {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
  text-decoration: none;
}

.rd-back:hover {
  color: var(--ca-fg-1);
  text-decoration: underline;
}

.rd-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ca-space-8);
  margin: var(--ca-space-4) 0 var(--ca-space-12);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.rd-matrix__toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ca-space-8);
  flex-wrap: wrap;
}

.rd-matrix__hint {
  margin: 0;
  max-width: 60ch;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.rd-matrix__actions {
  display: flex;
  gap: var(--ca-space-4);
}

.rd-matrix__dirty {
  margin: var(--ca-space-6) 0 0;
  font-size: var(--ca-text-200);
  color: var(--ca-color-brand);
}

.rd-app {
  margin-top: var(--ca-space-12);
}

.rd-app__title {
  margin: 0 0 var(--ca-space-6);
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.rd-module {
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  padding: var(--ca-space-6) var(--ca-space-8);
  margin-bottom: var(--ca-space-6);
  background: var(--ca-bg-surface);
}

.rd-module__head {
  font-weight: var(--ca-font-weight-semibold);
  text-transform: capitalize;
}

.rd-perms {
  list-style: none;
  margin: var(--ca-space-4) 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--ca-space-4) var(--ca-space-12);
}

.rd-perm :deep(.ca-checkbox) {
  align-items: flex-start;
}

.rd-perm :deep(.ca-checkbox__label) {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rd-perm__name {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
}

.rd-perm__id {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-4);
}

.rd-perm__desc {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-4);
}
</style>
