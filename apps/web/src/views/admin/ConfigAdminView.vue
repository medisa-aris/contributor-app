<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { listConfig, updateConfig, type AdminConfigEntry } from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaSwitch,
  CaTable,
  type CaTableColumn,
} from '@/components/ui';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canManage = computed(() => auth.can('config.manage'));

const rows = ref<AdminConfigEntry[]>([]);
const loading = ref(true);
const error = ref('');
const search = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await listConfig();
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
      row.key.toLowerCase().includes(term) || (row.description ?? '').toLowerCase().includes(term),
  );
});

const columns = computed<CaTableColumn[]>(() => {
  const base: CaTableColumn[] = [
    { key: 'key', label: t('admin.config.columnKey') },
    { key: 'value', label: t('admin.config.columnValue') },
    { key: 'is_public', label: t('admin.config.columnPublic'), width: '120px' },
    { key: 'updated_at', label: t('admin.config.columnUpdated'), width: '170px' },
  ];
  if (canManage.value)
    base.push({ key: 'actions', label: '', width: '90px', align: 'end', sortable: false });
  return base;
});

type ValueKind = 'boolean' | 'number' | 'string' | 'json';

function valueKind(value: unknown): ValueKind {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'json';
}

function valuePreview(value: unknown): string {
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no');
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const showEdit = ref(false);
const saving = ref(false);
const formError = ref('');
const target = ref<AdminConfigEntry | null>(null);
const editKind = ref<ValueKind>('string');
const editValue = ref<string | boolean>('');

function openEdit(row: AdminConfigEntry) {
  target.value = row;
  editKind.value = valueKind(row.value);
  if (editKind.value === 'boolean') editValue.value = row.value === true;
  else if (editKind.value === 'json') editValue.value = valuePreview(row.value);
  else editValue.value = String(row.value ?? '');
  formError.value = '';
  showEdit.value = true;
}

async function submit() {
  if (!target.value) return;
  formError.value = '';
  let payload: unknown;
  if (editKind.value === 'boolean') {
    payload = editValue.value === true;
  } else if (editKind.value === 'number') {
    const num = Number(editValue.value);
    if (String(editValue.value).trim() === '' || Number.isNaN(num)) {
      formError.value = t('admin.config.invalidNumber');
      return;
    }
    payload = num;
  } else if (editKind.value === 'json') {
    try {
      payload = JSON.parse(String(editValue.value));
    } catch {
      formError.value = t('admin.config.invalidJson');
      return;
    }
  } else {
    payload = String(editValue.value);
  }
  saving.value = true;
  try {
    await updateConfig(target.value.key, payload);
    toast.push({ variant: 'success', title: t('admin.config.updated') });
    showEdit.value = false;
    await load();
  } catch {
    formError.value = t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader :title="t('admin.config.title')" :description="t('admin.config.description')" />

    <div class="admin-filters">
      <div class="admin-filters__field admin-filters__wide">
        <CaInput
          v-model="search"
          type="search"
          :placeholder="t('admin.config.searchPlaceholder')"
        />
      </div>
    </div>

    <p v-if="error" class="admin-error">{{ error }}</p>

    <CaTable
      table-key="admin-config"
      :columns="columns"
      :rows="filtered"
      :row-key="(row) => row.key"
      :loading="loading"
    >
      <template #cell-key="{ row }">
        <span class="admin-mono">{{ row.key }}</span>
        <div v-if="row.description" class="admin-cell__sub">{{ row.description }}</div>
      </template>
      <template #cell-value="{ row }">
        <span class="cfg-value">{{ valuePreview(row.value) }}</span>
      </template>
      <template #cell-is_public="{ row }">
        <CaBadge :variant="row.is_public ? 'informative' : 'neutral'">
          {{ row.is_public ? t('admin.config.publicBadge') : t('admin.config.privateBadge') }}
        </CaBadge>
      </template>
      <template #cell-updated_at="{ row }">
        {{ formatDateTime(row.updated_at) }}
      </template>
      <template #cell-actions="{ row }">
        <CaButton size="small" variant="subtle" @click="openEdit(row)">
          {{ t('admin.config.editAction') }}
        </CaButton>
      </template>
    </CaTable>

    <CaDialog
      v-model:open="showEdit"
      :title="t('admin.config.editTitle')"
      :subtitle="target?.key"
      size="small"
    >
      <div class="admin-form">
        <CaField
          :label="t('admin.config.columnValue')"
          :hint="editKind === 'json' ? t('admin.config.valueHintJson') : undefined"
        >
          <div v-if="editKind === 'boolean'" class="cfg-boolean">
            <CaSwitch
              :model-value="editValue === true"
              @update:model-value="(v) => (editValue = v)"
            />
            <span>{{ editValue === true ? t('common.yes') : t('common.no') }}</span>
          </div>
          <CaInput
            v-else
            :model-value="String(editValue)"
            @update:model-value="(v) => (editValue = v)"
          />
        </CaField>
        <p v-if="formError" class="admin-error">{{ formError }}</p>
      </div>
      <template #footer>
        <CaButton variant="subtle" @click="showEdit = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="primary" :disabled="saving" @click="submit">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.cfg-value {
  font-family: var(--ca-font-family-mono);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-2);
  white-space: pre-wrap;
  word-break: break-word;
}

.cfg-boolean {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-2);
}
</style>
