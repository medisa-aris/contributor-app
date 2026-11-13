<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  createDbConnector,
  DB_DEFAULT_PORTS,
  DB_ENGINE_LABELS,
  deleteDbConnector,
  listDbConnectors,
  listDbTables,
  testDbConnector,
  updateDbConnector,
  type DbConnectorInput,
  type DbConnectorRow,
  type DbEngine,
  type DbTableInfo,
} from '@/api/connectors';
import { useToastStore } from '@/stores/toast.store';
import { formatDateTime } from '@/utils/format';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaField,
  CaInput,
  CaSelect,
  CaSpinner,
  CaSwitch,
  CaTable,
  CaTextarea,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';
import ConnectorGrantsDialog from './ConnectorGrantsDialog.vue';

const props = defineProps<{ canConfigure: boolean }>();

const { t } = useI18n();
const toast = useToastStore();

const items = ref<DbConnectorRow[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    items.value = await listDbConnectors();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const columns = computed<CaTableColumn[]>(() => {
  const cols: CaTableColumn[] = [
    { key: 'name', label: t('integrations.columnName'), sortValue: (row) => row.name },
    { key: 'target', label: t('connectors.columnTarget') },
    { key: 'policy', label: t('connectors.columnPolicy') },
    { key: 'health', label: t('integrations.columnHealth') },
    { key: 'enabled', label: t('integrations.columnEnabled') },
  ];
  if (props.canConfigure) cols.push({ key: 'actions', label: t('table.actions'), sortable: false });
  return cols;
});

function healthVariant(row: DbConnectorRow): 'success' | 'danger' | 'neutral' {
  if (row.last_health_ok === null) return 'neutral';
  return row.last_health_ok ? 'success' : 'danger';
}

function healthLabel(row: DbConnectorRow): string {
  if (row.last_health_ok === null) return t('integrations.healthUnknown');
  return row.last_health_ok ? t('integrations.healthOk') : t('integrations.healthFail');
}

const running = ref<Set<string>>(new Set());

async function test(row: DbConnectorRow): Promise<void> {
  running.value = new Set([...running.value, row.id]);
  try {
    const updated = await testDbConnector(row.id);
    Object.assign(row, updated);
    toast.push({
      variant: updated.last_health_ok ? 'success' : 'danger',
      title: updated.last_health_ok ? t('connectors.testOk') : t('connectors.testFailed'),
      ...(updated.last_health_detail ? { message: updated.last_health_detail } : {}),
    });
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') });
  } finally {
    const next = new Set(running.value);
    next.delete(row.id);
    running.value = next;
  }
}

async function toggle(row: DbConnectorRow, enabled: boolean): Promise<void> {
  try {
    Object.assign(row, await updateDbConnector(row.id, { enabled }));
    toast.push({ variant: 'success', title: t('integrations.updated') });
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') });
  }
}

async function remove(row: DbConnectorRow): Promise<void> {
  if (!window.confirm(t('connectors.deleteConfirm', { name: row.name }))) return;
  try {
    await deleteDbConnector(row.id);
    items.value = items.value.filter((item) => item.id !== row.id);
    toast.push({ variant: 'success', title: t('connectors.deleted') });
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') });
  }
}

// ── Form tambah/ubah ──
const formOpen = ref(false);
const editing = ref<DbConnectorRow | null>(null);
const saving = ref(false);
const formError = ref('');
const form = reactive({
  code: '',
  name: '',
  description: '',
  engine: 'postgres' as DbEngine,
  host: '',
  port: '5432',
  database: '',
  username: '',
  password: '',
  schema: '',
  ssl: false,
  trustServerCertificate: true,
  oracleSid: false,
  allowWrite: false,
  rowLimit: '200',
  timeoutMs: '30000',
});

const engineOptions = computed<CaSelectOption[]>(() =>
  (Object.keys(DB_ENGINE_LABELS) as DbEngine[]).map((engine) => ({ value: engine, label: DB_ENGINE_LABELS[engine] })),
);

watch(
  () => form.engine,
  (engine, previous) => {
    if (!editing.value && (!form.port || Number(form.port) === DB_DEFAULT_PORTS[previous])) {
      form.port = String(DB_DEFAULT_PORTS[engine]);
    }
  },
);

function openCreate(): void {
  editing.value = null;
  Object.assign(form, {
    code: '',
    name: '',
    description: '',
    engine: 'postgres',
    host: '',
    port: '5432',
    database: '',
    username: '',
    password: '',
    schema: '',
    ssl: false,
    trustServerCertificate: true,
    oracleSid: false,
    allowWrite: false,
    rowLimit: '200',
    timeoutMs: '30000',
  });
  formError.value = '';
  formOpen.value = true;
}

function openEdit(row: DbConnectorRow): void {
  editing.value = row;
  Object.assign(form, {
    code: row.code,
    name: row.name,
    description: row.description ?? '',
    engine: row.engine,
    host: row.host,
    port: String(row.port),
    database: row.database_name,
    username: row.username,
    password: '',
    schema: row.options.schema ?? '',
    ssl: row.options.ssl ?? false,
    trustServerCertificate: row.options.trustServerCertificate ?? true,
    oracleSid: row.options.oracleSid ?? false,
    allowWrite: row.allow_write,
    rowLimit: String(row.row_limit),
    timeoutMs: String(row.timeout_ms),
  });
  formError.value = '';
  formOpen.value = true;
}

async function submit(): Promise<void> {
  saving.value = true;
  formError.value = '';
  const payload: DbConnectorInput = {
    name: form.name.trim(),
    description: form.description.trim(),
    host: form.host.trim(),
    port: Number(form.port),
    database: form.database.trim(),
    username: form.username.trim(),
    options: {
      ssl: form.ssl,
      ...(form.schema.trim() ? { schema: form.schema.trim() } : {}),
      ...(form.engine === 'mssql' ? { trustServerCertificate: form.trustServerCertificate } : {}),
      ...(form.engine === 'oracle' ? { oracleSid: form.oracleSid } : {}),
    },
    allowWrite: form.allowWrite,
    rowLimit: Number(form.rowLimit),
    timeoutMs: Number(form.timeoutMs),
    ...(form.password ? { password: form.password } : {}),
  };
  try {
    if (editing.value) {
      const updated = await updateDbConnector(editing.value.id, payload);
      Object.assign(editing.value, updated);
    } else {
      const created = await createDbConnector({ ...payload, code: form.code.trim(), engine: form.engine });
      items.value = [...items.value, created].sort((a, b) => a.name.localeCompare(b.name));
    }
    formOpen.value = false;
    toast.push({ variant: 'success', title: t('connectors.saved') });
  } catch (caught) {
    formError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

// ── Jelajah tabel ──
const tablesOpen = ref(false);
const tablesFor = ref<DbConnectorRow | null>(null);
const tables = ref<DbTableInfo[]>([]);
const tablesLoading = ref(false);
const tablesError = ref('');

async function browse(row: DbConnectorRow): Promise<void> {
  tablesFor.value = row;
  tables.value = [];
  tablesError.value = '';
  tablesOpen.value = true;
  tablesLoading.value = true;
  try {
    tables.value = await listDbTables(row.id);
  } catch (caught) {
    tablesError.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    tablesLoading.value = false;
  }
}

// ── Akses ──
const grantsOpen = ref(false);
const grantsFor = ref<DbConnectorRow | null>(null);

function openGrants(row: DbConnectorRow): void {
  grantsFor.value = row;
  grantsOpen.value = true;
}

defineExpose({ openCreate });
</script>

<template>
  <section>
    <div class="int-section-head">
      <div>
        <h2 class="int-heading">{{ t('connectors.dbHeading') }}</h2>
        <p class="db-intro">{{ t('connectors.dbIntro') }}</p>
      </div>
      <CaButton v-if="canConfigure" variant="primary" @click="openCreate">
        {{ t('connectors.addDb') }}
      </CaButton>
    </div>
    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <CaTable
      table-key="db-connectors"
      :columns="columns"
      :rows="items"
      :row-key="(row) => row.id"
      :loading="loading"
      :empty-title="t('connectors.emptyDb')"
    >
      <template #cell-name="{ row }">
        <div class="int-cell">
          <span class="int-cell__name">{{ row.name }}</span>
          <span class="int-cell__sub">{{ row.code }} · {{ DB_ENGINE_LABELS[(row as DbConnectorRow).engine] }}</span>
        </div>
      </template>
      <template #cell-target="{ row }">
        <span class="admin-mono">{{ row.username }}@{{ row.host }}:{{ row.port }}/{{ row.database_name }}</span>
      </template>
      <template #cell-policy="{ row }">
        <div class="db-policy">
          <CaBadge :variant="(row as DbConnectorRow).allow_write ? 'warning' : 'informative'" size="small">
            {{ (row as DbConnectorRow).allow_write ? t('connectors.policyWrite') : t('connectors.policyRead') }}
          </CaBadge>
          <span class="int-health__time">
            {{ t('connectors.policyLimits', { rows: row.row_limit, seconds: Math.round(row.timeout_ms / 1000) }) }}
          </span>
          <span class="int-health__time">{{ t('connectors.grantCount', { count: row.grant_count }) }}</span>
        </div>
      </template>
      <template #cell-health="{ row }">
        <div class="int-health">
          <CaBadge :variant="healthVariant(row as DbConnectorRow)" size="small">
            {{ healthLabel(row as DbConnectorRow) }}
          </CaBadge>
          <span v-if="(row as DbConnectorRow).last_health_at" class="int-health__time">
            {{ formatDateTime((row as DbConnectorRow).last_health_at!) }}
          </span>
        </div>
      </template>
      <template #cell-enabled="{ row }">
        <CaSwitch
          :model-value="(row as DbConnectorRow).enabled"
          :disabled="!canConfigure"
          @update:model-value="(v: boolean) => toggle(row as DbConnectorRow, v)"
        />
      </template>
      <template #cell-actions="{ row }">
        <div class="int-actions">
          <CaButton size="small" variant="secondary" :loading="running.has(row.id)" @click="test(row as DbConnectorRow)">
            {{ t('connectors.test') }}
          </CaButton>
          <CaButton size="small" variant="secondary" @click="browse(row as DbConnectorRow)">
            {{ t('connectors.browse') }}
          </CaButton>
          <CaButton size="small" variant="primary" @click="openGrants(row as DbConnectorRow)">
            {{ t('connectors.access') }}
          </CaButton>
          <CaButton size="small" variant="secondary" @click="openEdit(row as DbConnectorRow)">
            {{ t('common.edit') }}
          </CaButton>
          <CaButton size="small" variant="danger" @click="remove(row as DbConnectorRow)">
            {{ t('common.delete') }}
          </CaButton>
        </div>
      </template>
    </CaTable>

    <CaDialog
      v-model:open="formOpen"
      size="large"
      :title="editing ? t('connectors.editDbTitle') : t('connectors.addDbTitle')"
      :subtitle="t('connectors.dbDialogSubtitle')"
    >
      <p v-if="formError" class="admin-error" role="alert">{{ formError }}</p>
      <form class="admin-form" @submit.prevent="submit">
        <div class="db-grid">
          <CaField :label="t('integrations.formCode')" :hint="t('knowledge.formSourceCodeHint')" required>
            <template #default="{ id, describedBy }">
              <CaInput :id="id" v-model="form.code" :aria-describedby="describedBy" :disabled="!!editing" />
            </template>
          </CaField>
          <CaField :label="t('integrations.formName')" required>
            <template #default="{ id }">
              <CaInput :id="id" v-model="form.name" />
            </template>
          </CaField>
          <CaField :label="t('connectors.engine')" required>
            <template #default="{ id }">
              <CaSelect :id="id" v-model="form.engine" :options="engineOptions" :disabled="!!editing" />
            </template>
          </CaField>
          <CaField :label="t('connectors.host')" required>
            <template #default="{ id }">
              <CaInput :id="id" v-model="form.host" autocomplete="off" />
            </template>
          </CaField>
          <CaField :label="t('connectors.port')" required>
            <template #default="{ id }">
              <CaInput :id="id" v-model="form.port" inputmode="numeric" />
            </template>
          </CaField>
          <CaField
            :label="form.engine === 'oracle' ? t('connectors.serviceName') : t('connectors.database')"
            required
          >
            <template #default="{ id }">
              <CaInput :id="id" v-model="form.database" autocomplete="off" />
            </template>
          </CaField>
          <CaField :label="t('connectors.username')" required>
            <template #default="{ id }">
              <CaInput :id="id" v-model="form.username" autocomplete="off" />
            </template>
          </CaField>
          <CaField
            :label="t('connectors.password')"
            :hint="editing?.has_password ? t('connectors.passwordKeepHint') : t('connectors.passwordHint')"
          >
            <template #default="{ id, describedBy }">
              <CaInput
                :id="id"
                v-model="form.password"
                type="password"
                autocomplete="new-password"
                :aria-describedby="describedBy"
              />
            </template>
          </CaField>
          <CaField :label="t('connectors.schema')" :hint="t('connectors.schemaHint')">
            <template #default="{ id, describedBy }">
              <CaInput :id="id" v-model="form.schema" :aria-describedby="describedBy" />
            </template>
          </CaField>
          <CaField :label="t('connectors.rowLimit')">
            <template #default="{ id }">
              <CaInput :id="id" v-model="form.rowLimit" inputmode="numeric" />
            </template>
          </CaField>
          <CaField :label="t('connectors.timeoutMs')">
            <template #default="{ id }">
              <CaInput :id="id" v-model="form.timeoutMs" inputmode="numeric" />
            </template>
          </CaField>
        </div>
        <CaField :label="t('integrations.formDescription')">
          <template #default="{ id }">
            <CaTextarea :id="id" v-model="form.description" :rows="2" />
          </template>
        </CaField>
        <div class="db-switches">
          <CaSwitch v-model="form.ssl" :label="t('connectors.ssl')" />
          <CaSwitch
            v-if="form.engine === 'mssql'"
            v-model="form.trustServerCertificate"
            :label="t('connectors.trustCert')"
          />
          <CaSwitch v-if="form.engine === 'oracle'" v-model="form.oracleSid" :label="t('connectors.oracleSid')" />
          <CaSwitch v-model="form.allowWrite" :label="t('connectors.allowWrite')" />
        </div>
        <p class="db-hint" :class="{ 'db-hint--warn': form.allowWrite }">
          {{ form.allowWrite ? t('connectors.allowWriteOnHint') : t('connectors.allowWriteOffHint') }}
        </p>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="formOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="saving" @click="submit">{{ t('common.save') }}</CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="tablesOpen"
      :title="t('connectors.tablesTitle', { name: tablesFor?.name ?? '' })"
      :subtitle="t('connectors.tablesSubtitle')"
    >
      <p v-if="tablesError" class="admin-error" role="alert">{{ tablesError }}</p>
      <div v-if="tablesLoading" class="db-loading"><CaSpinner /></div>
      <p v-else-if="!tablesError && tables.length === 0" class="db-hint">{{ t('connectors.noTables') }}</p>
      <ul v-else class="db-tables">
        <li v-for="table in tables" :key="`${table.schema}.${table.name}`">
          <span class="admin-mono">{{ table.schema }}.{{ table.name }}</span>
          <CaBadge size="small">{{ table.type === 'view' ? 'view' : 'tabel' }}</CaBadge>
        </li>
      </ul>
      <template #footer>
        <CaButton variant="secondary" @click="tablesOpen = false">{{ t('common.close') }}</CaButton>
      </template>
    </CaDialog>

    <ConnectorGrantsDialog
      v-if="grantsFor"
      v-model:open="grantsOpen"
      connector-type="database"
      :connector-id="grantsFor.id"
      :connector-name="grantsFor.name"
      :allow-write="grantsFor.allow_write"
      :can-configure="canConfigure"
      @changed="load"
    />
  </section>
</template>

<style scoped>
.int-heading {
  margin: 0 0 var(--ca-space-2);
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.int-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ca-space-4);
  margin-bottom: var(--ca-space-4);
  flex-wrap: wrap;
}

.db-intro {
  margin: 0;
  max-width: 70ch;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.int-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.int-cell__name {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.int-cell__sub,
.int-health__time {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.int-health,
.db-policy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}

.int-actions {
  display: flex;
  gap: var(--ca-space-3);
  flex-wrap: wrap;
}

.db-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--ca-space-4);
}

.db-switches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-6);
}

.db-hint {
  margin: 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.db-hint--warn {
  color: var(--ca-warning-fg, var(--ca-fg-2));
}

.db-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-6) 0;
}

.db-tables {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.db-tables li {
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-3);
}
</style>
