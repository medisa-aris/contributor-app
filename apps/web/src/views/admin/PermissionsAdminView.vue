<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { listPermissions, syncPermissions, type AdminPermissionRow } from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaInput,
  CaPageHeader,
  CaTable,
  type CaTableColumn,
} from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canSync = computed(() => auth.can('rbac.permissions.assign'));

const rows = ref<AdminPermissionRow[]>([]);
const loading = ref(true);
const error = ref('');
const search = ref('');
const syncing = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await listPermissions();
  } catch {
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return rows.value;
  return rows.value.filter(
    (row) =>
      row.identifier.toLowerCase().includes(term) ||
      row.name.toLowerCase().includes(term),
  );
});

const columns = computed<CaTableColumn[]>(() => [
  { key: 'identifier', label: t('admin.permissions.columnIdentifier'), width: '260px' },
  { key: 'name', label: t('admin.permissions.columnName') },
  { key: 'description', label: t('admin.permissions.columnDescription') },
  { key: 'is_system', label: t('admin.permissions.columnType'), width: '100px' },
  { key: 'role_count', label: t('admin.permissions.columnRoles'), width: '130px' },
]);

async function runSync() {
  syncing.value = true;
  try {
    const result = await syncPermissions();
    toast.push({
      variant: 'success',
      title: t('admin.permissions.syncDone', { added: result.added, total: result.total }),
    });
    await load();
  } catch {
    toast.push({ variant: 'danger', title: t('errors.saveFailed') });
  } finally {
    syncing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.permissions.title')"
      :description="t('admin.permissions.description')"
    >
      <template #actions>
        <CaButton v-if="canSync" variant="secondary" :loading="syncing" @click="runSync">
          {{ t('admin.permissions.syncButton') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <div class="admin-filters">
      <div class="admin-filters__field admin-filters__wide">
        <CaInput
          v-model="search"
          type="search"
          :placeholder="t('admin.permissions.searchPlaceholder')"
        />
      </div>
      <div class="admin-filters__spacer" />
      <span class="perm-count">{{ filtered.length }} / {{ rows.length }}</span>
    </div>

    <p v-if="error" class="admin-error">{{ error }}</p>

    <CaTable
      table-key="admin-permissions"
      :columns="columns"
      :rows="filtered"
      :row-key="(row) => row.id"
      :loading="loading"
      :empty-title="t('admin.permissions.empty')"
    >
      <template #cell-identifier="{ row }">
        <span class="admin-mono">{{ row.identifier }}</span>
      </template>
      <template #cell-name="{ row }">
        <span class="perm-name">{{ row.name }}</span>
      </template>
      <template #cell-description="{ row }">
        <span class="perm-desc">{{ row.description ?? '—' }}</span>
      </template>
      <template #cell-is_system="{ row }">
        <CaBadge :variant="row.is_system ? 'brand' : 'neutral'">
          {{ row.is_system ? t('admin.permissions.systemBadge') : t('admin.permissions.customBadge') }}
        </CaBadge>
      </template>
      <template #cell-role_count="{ row }">
        {{ t('admin.permissions.roleCount', { count: row.role_count }) }}
      </template>
    </CaTable>
  </section>
</template>

<style scoped>
.perm-count {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.perm-name {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.perm-desc {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}
</style>
