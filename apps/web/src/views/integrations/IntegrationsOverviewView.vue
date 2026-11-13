<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  createMcpServer,
  createRestConnector,
  deleteMcpServer,
  disconnectMcpOauth,
  deleteRestConnector,
  getProviderStatus,
  listMcpServers,
  listRestConnectors,
  mcpHealthCheck,
  startMcpOauth,
  restHealthCheck,
  updateMcpServer,
  updateRestConnector,
  type AiProviderStatus,
  type McpServerRow,
  type RestConnectorRow,
} from '@/api/integrations';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { usePagedList } from '@/composables/usePagedList';
import { formatDateTime } from '@/utils/format';
import { listDbConnectors, testDbConnector, type DbConnectorRow } from '@/api/connectors';
import ConnectorGrantsDialog from '@/components/integrations/ConnectorGrantsDialog.vue';
import DbConnectorsSection from '@/components/integrations/DbConnectorsSection.vue';
import McpToolsDialog from '@/components/integrations/McpToolsDialog.vue';
import {
  CaBadge,
  CaButton,
  CaCard,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaSelect,
  CaIcon,
  CaSpinner,
  CaStatCard,
  CaSwitch,
  CaTable,
  CaTextarea,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canView = computed(() => auth.can('integrations.view'));
const canConfigure = computed(() => auth.can('integrations.configure'));

// --- Status provider AI ---
const provider = ref<AiProviderStatus | null>(null);
const providerLoading = ref(true);
const providerError = ref('');

async function loadProvider(): Promise<void> {
  if (!canView.value) return;
  providerLoading.value = true;
  providerError.value = '';
  try {
    provider.value = await getProviderStatus();
  } catch (caught) {
    providerError.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    providerLoading.value = false;
  }
}

const credentialBadges = computed(() => {
  if (!provider.value) return [] as { key: string; configured: boolean }[];
  return [
    { key: 'openrouter', configured: provider.value.credentials.openrouter },
    { key: 'openai', configured: provider.value.credentials.openai },
    { key: 'anthropic', configured: provider.value.credentials.anthropic },
  ];
});

// --- Server MCP ---
const {
  items: mcpItems,
  loading: mcpLoading,
  error: mcpError,
  load: loadMcp,
} = usePagedList<McpServerRow>(listMcpServers, { pageSize: 25 });

const mcpColumns = computed<CaTableColumn[]>(() => {
  const cols: CaTableColumn[] = [
    { key: 'name', label: t('integrations.columnName'), sortValue: (row) => row.name },
    { key: 'base', label: t('integrations.columnBaseUrl') },
    { key: 'health', label: t('integrations.columnHealth') },
    { key: 'enabled', label: t('integrations.columnEnabled') },
  ];
  if (canConfigure.value) cols.push({ key: 'actions', label: t('table.actions'), sortable: false });
  return cols;
});

async function toggleMcp(row: McpServerRow, enabled: boolean): Promise<void> {
  try {
    await updateMcpServer(row.id, { enabled });
    row.enabled = enabled;
    toast.push({ variant: 'success', title: t('integrations.updated') });
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

const healthRunning = ref<Set<string>>(new Set());

// --- Akses (grant) server MCP ---
const mcpGrantsOpen = ref(false);
const mcpGrantsFor = ref<McpServerRow | null>(null);

function openMcpGrants(row: McpServerRow): void {
  mcpGrantsFor.value = row;
  mcpGrantsOpen.value = true;
}

const mcpToolsOpen = ref(false);
const mcpToolsFor = ref<McpServerRow | null>(null);

function openMcpTools(row: McpServerRow): void {
  mcpToolsFor.value = row;
  mcpToolsOpen.value = true;
}

async function checkMcp(row: McpServerRow): Promise<void> {
  const next = new Set(healthRunning.value);
  next.add(row.id);
  healthRunning.value = next;
  try {
    const updated = await mcpHealthCheck(row.id);
    Object.assign(row, updated);
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  } finally {
    const done = new Set(healthRunning.value);
    done.delete(row.id);
    healthRunning.value = done;
  }
}

async function connectMcp(row: McpServerRow): Promise<void> {
  try {
    const { authorizationUrl } = await startMcpOauth(row.id);
    window.location.assign(authorizationUrl);
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

async function disconnectMcp(row: McpServerRow): Promise<void> {
  try {
    Object.assign(row, await disconnectMcpOauth(row.id));
    toast.push({ variant: 'success', title: t('integrations.oauthDisconnected') });
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

const clientOpen = ref(false);
const clientSaving = ref(false);
const clientFormError = ref('');
const clientTarget = ref<McpServerRow | null>(null);
const clientForm = ref({ clientId: '', clientSecret: '' });

function openClientDialog(row: McpServerRow): void {
  clientTarget.value = row;
  clientForm.value = { clientId: row.oauth_client_manual ? (row.oauth_client_id ?? '') : '', clientSecret: '' };
  clientFormError.value = '';
  clientOpen.value = true;
}

async function submitClient(): Promise<void> {
  const row = clientTarget.value;
  if (!row) return;
  clientSaving.value = true;
  clientFormError.value = '';
  try {
    Object.assign(
      row,
      await updateMcpServer(row.id, {
        oauthClientId: clientForm.value.clientId.trim(),
        oauthClientSecret: clientForm.value.clientSecret.trim() || undefined,
      }),
    );
    clientOpen.value = false;
    toast.push({ variant: 'success', title: t('integrations.oauthClientSaved') });
  } catch (caught) {
    clientFormError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    clientSaving.value = false;
  }
}

async function removeMcp(row: McpServerRow): Promise<void> {
  try {
    await deleteMcpServer(row.id);
    toast.push({ variant: 'success', title: t('integrations.deleted') });
    await loadMcp();
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

// --- Konektor REST ---
const {
  items: restItems,
  loading: restLoading,
  error: restError,
  load: loadRest,
} = usePagedList<RestConnectorRow>(listRestConnectors, { pageSize: 25 });

const restColumns = computed<CaTableColumn[]>(() => {
  const cols: CaTableColumn[] = [
    { key: 'name', label: t('integrations.columnName'), sortValue: (row) => row.name },
    { key: 'base', label: t('integrations.columnBaseUrl') },
    { key: 'health', label: t('integrations.columnHealth') },
    { key: 'enabled', label: t('integrations.columnEnabled') },
  ];
  if (canConfigure.value) cols.push({ key: 'actions', label: t('table.actions'), sortable: false });
  return cols;
});

async function toggleRest(row: RestConnectorRow, enabled: boolean): Promise<void> {
  try {
    await updateRestConnector(row.id, { enabled });
    row.enabled = enabled;
    toast.push({ variant: 'success', title: t('integrations.updated') });
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

async function checkRest(row: RestConnectorRow): Promise<void> {
  const next = new Set(healthRunning.value);
  next.add(row.id);
  healthRunning.value = next;
  try {
    const updated = await restHealthCheck(row.id);
    Object.assign(row, updated);
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  } finally {
    const done = new Set(healthRunning.value);
    done.delete(row.id);
    healthRunning.value = done;
  }
}

async function removeRest(row: RestConnectorRow): Promise<void> {
  try {
    await deleteRestConnector(row.id);
    toast.push({ variant: 'success', title: t('integrations.deleted') });
    await loadRest();
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

function healthVariant(row: McpServerRow | RestConnectorRow): 'success' | 'danger' | 'neutral' {
  if (row.last_health_ok === null) return 'neutral';
  return row.last_health_ok ? 'success' : 'danger';
}

function healthLabel(row: McpServerRow | RestConnectorRow): string {
  if (row.last_health_ok === null) return t('integrations.healthUnknown');
  return row.last_health_ok ? t('integrations.healthOk') : t('integrations.healthFail');
}

// --- Ringkasan kesehatan & peta koneksi ---
type Health = 'ok' | 'bad' | 'unknown';

const dbItems = ref<DbConnectorRow[]>([]);
const dbSectionKey = ref(0);
const checkingAll = ref(false);

async function loadDb(): Promise<void> {
  if (!canView.value) return;
  try {
    dbItems.value = await listDbConnectors();
  } catch {
    dbItems.value = [];
  }
}

function healthOf(row: { last_health_ok: boolean | null }): Health {
  if (row.last_health_ok === null) return 'unknown';
  return row.last_health_ok ? 'ok' : 'bad';
}

const providerHealth = computed<Health>(() => {
  const p = provider.value;
  if (!p) return 'unknown';
  const key = p.provider as keyof typeof p.credentials;
  return key in p.credentials && !p.credentials[key] ? 'bad' : 'ok';
});

interface MapNode {
  id: string;
  name: string;
  kind: 'provider' | 'mcp' | 'db' | 'rest';
  health: Health;
  anchor: string;
}

const mapNodes = computed<MapNode[]>(() => {
  const nodes: MapNode[] = [];
  if (provider.value) {
    nodes.push({ id: 'provider', name: provider.value.provider, kind: 'provider', health: providerHealth.value, anchor: 'int-provider' });
  }
  for (const row of mcpItems.value) nodes.push({ id: `mcp-${row.id}`, name: row.name, kind: 'mcp', health: healthOf(row), anchor: 'int-mcp' });
  for (const row of dbItems.value) nodes.push({ id: `db-${row.id}`, name: row.name, kind: 'db', health: healthOf(row), anchor: 'int-db' });
  for (const row of restItems.value) nodes.push({ id: `rest-${row.id}`, name: row.name, kind: 'rest', health: healthOf(row), anchor: 'int-rest' });
  return nodes;
});

const healthTotals = computed(() => {
  const totals = { ok: 0, bad: 0, unknown: 0, total: mapNodes.value.length };
  for (const node of mapNodes.value) totals[node.health] += 1;
  return totals;
});

function problemsHint(rows: { last_health_ok: boolean | null }[]): string {
  if (rows.length === 0) return t('integrations.kpiNone');
  const bad = rows.filter((r) => r.last_health_ok === false).length;
  return bad > 0 ? t('integrations.kpiProblems', { n: bad }) : t('integrations.kpiAllHealthy');
}

function nodeY(index: number): string {
  return `${((index + 0.5) / Math.max(1, mapNodes.value.length)) * 100}%`;
}

function healthWord(health: Health): string {
  if (health === 'ok') return t('integrations.healthOk');
  if (health === 'bad') return t('integrations.healthFail');
  return t('integrations.healthUnknown');
}

function jumpTo(anchor: string): void {
  document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function checkAll(): Promise<void> {
  checkingAll.value = true;
  try {
    for (const row of mcpItems.value) await checkMcp(row);
    for (const row of restItems.value) await checkRest(row);
    for (const row of dbItems.value) {
      try {
        await testDbConnector(row.id);
      } catch {
        // hasil gagal tetap tercatat di baris konektor
      }
    }
    await loadDb();
    dbSectionKey.value += 1;
    toast.push({ variant: 'success', title: t('integrations.checkAllDone') });
  } finally {
    checkingAll.value = false;
  }
}

// --- Dialog tambah MCP ---
const mcpOpen = ref(false);
const mcpSaving = ref(false);
const mcpFormError = ref('');
const mcpForm = ref({ code: '', name: '', description: '', baseUrl: '', authType: 'none' as 'none' | 'api_key' | 'oauth', apiKeyEnv: '', oauthClientId: '', oauthClientSecret: '' });

const mcpAuthTypeOptions = computed<CaSelectOption[]>(() => [
  ...authTypeOptions.value,
  { value: 'oauth', label: t('integrations.authOauth') },
]);

const authTypeOptions = computed<CaSelectOption[]>(() => [
  { value: 'none', label: t('integrations.authNone') },
  { value: 'api_key', label: t('integrations.authApiKey') },
]);

function openMcpDialog(): void {
  mcpForm.value = { code: '', name: '', description: '', baseUrl: '', authType: 'none', apiKeyEnv: '', oauthClientId: '', oauthClientSecret: '' };
  mcpFormError.value = '';
  mcpOpen.value = true;
}

async function submitMcp(): Promise<void> {
  mcpFormError.value = '';
  if (mcpForm.value.code.trim().length < 3 || mcpForm.value.name.trim().length < 3 || !mcpForm.value.baseUrl.trim()) {
    mcpFormError.value = t('errors.requiredFields');
    return;
  }
  mcpSaving.value = true;
  try {
    await createMcpServer({
      code: mcpForm.value.code.trim(),
      name: mcpForm.value.name.trim(),
      description: mcpForm.value.description.trim() || undefined,
      baseUrl: mcpForm.value.baseUrl.trim(),
      authType: mcpForm.value.authType,
      apiKeyEnv: mcpForm.value.authType === 'api_key' ? mcpForm.value.apiKeyEnv.trim() || undefined : undefined,
      oauthClientId: mcpForm.value.authType === 'oauth' ? mcpForm.value.oauthClientId.trim() || undefined : undefined,
      oauthClientSecret:
        mcpForm.value.authType === 'oauth' ? mcpForm.value.oauthClientSecret.trim() || undefined : undefined,
    });
    toast.push({ variant: 'success', title: t('integrations.created') });
    mcpOpen.value = false;
    await loadMcp();
  } catch (caught) {
    mcpFormError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    mcpSaving.value = false;
  }
}

// --- Dialog tambah REST ---
const restOpen = ref(false);
const restSaving = ref(false);
const restFormError = ref('');
const restForm = ref({
  code: '',
  name: '',
  description: '',
  baseUrl: '',
  endpoints: '',
  authType: 'none' as 'none' | 'api_key',
  apiKeyEnv: '',
});

function openRestDialog(): void {
  restForm.value = {
    code: '',
    name: '',
    description: '',
    baseUrl: '',
    endpoints: '',
    authType: 'none',
    apiKeyEnv: '',
  };
  restFormError.value = '';
  restOpen.value = true;
}

async function submitRest(): Promise<void> {
  restFormError.value = '';
  const toolEndpoints = restForm.value.endpoints
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [method = 'GET', ...rest] = line.split(/\s+/);
      const path = rest.join(' ');
      const upper = method.toUpperCase();
      if ((upper !== 'GET' && upper !== 'POST') || !path.startsWith('/')) return null;
      return { name: `${upper} ${path}`, method: upper as 'GET' | 'POST', path };
    });
  if (
    restForm.value.code.trim().length < 3 ||
    restForm.value.name.trim().length < 3 ||
    !restForm.value.baseUrl.trim() ||
    toolEndpoints.length === 0 ||
    toolEndpoints.some((e) => e === null)
  ) {
    restFormError.value = t('integrations.endpointsInvalid');
    return;
  }
  restSaving.value = true;
  try {
    await createRestConnector({
      code: restForm.value.code.trim(),
      name: restForm.value.name.trim(),
      description: restForm.value.description.trim() || undefined,
      baseUrl: restForm.value.baseUrl.trim(),
      toolEndpoints: toolEndpoints as { name: string; method: 'GET' | 'POST'; path: string }[],
      authType: restForm.value.authType,
      apiKeyEnv: restForm.value.authType === 'api_key' ? restForm.value.apiKeyEnv.trim() || undefined : undefined,
    });
    toast.push({ variant: 'success', title: t('integrations.created') });
    restOpen.value = false;
    await loadRest();
  } catch (caught) {
    restFormError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    restSaving.value = false;
  }
}

onMounted(() => {
  void loadProvider();
  void loadMcp();
  void loadRest();
  void loadDb();
});
</script>

<template>
  <div>
    <CaPageHeader :title="t('integrations.title')" :description="t('integrations.description')">
      <template #actions>
        <CaButton v-if="canConfigure" :loading="checkingAll" @click="checkAll">
          <template #icon-start><CaIcon name="refresh" :size="16" /></template>
          {{ t('integrations.checkAll') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <section v-if="canView" class="ca-kpis" :aria-label="t('integrations.kpiLabel')">
      <CaStatCard
        hero
        :label="t('integrations.kpiHealthy')"
        :value="t('integrations.kpiHealthyValue', { ok: healthTotals.ok, total: healthTotals.total })"
        :hint="t('integrations.kpiHealthyHint', { bad: healthTotals.bad, unknown: healthTotals.unknown })"
      />
      <CaStatCard
        :label="t('integrations.kpiProvider')"
        :value="provider?.provider ?? '—'"
        :tone="providerHealth === 'bad' ? 'danger' : 'neutral'"
        :hint="provider?.model ?? ''"
      />
      <CaStatCard
        :label="t('integrations.kpiMcp')"
        :value="mcpItems.length"
        :tone="mcpItems.some((r) => r.last_health_ok === false) ? 'danger' : 'success'"
        :hint="problemsHint(mcpItems)"
      />
      <CaStatCard
        :label="t('integrations.kpiDb')"
        :value="dbItems.length"
        :tone="dbItems.some((r) => r.last_health_ok === false) ? 'danger' : 'success'"
        :hint="problemsHint(dbItems)"
      />
    </section>

    <section v-if="canView && mapNodes.length > 0" class="ca-panel int-map" aria-labelledby="int-map-title">
      <div class="int-map__head">
        <h2 id="int-map-title" class="ca-panel__title">{{ t('integrations.mapTitle') }}</h2>
        <span class="int-muted">{{ t('integrations.mapHint') }}</span>
      </div>
      <div class="int-map__canvas" :style="{ height: `${Math.max(240, mapNodes.length * 64)}px` }">
        <svg class="int-map__lines" width="100%" height="100%" aria-hidden="true">
          <line
            v-for="(node, index) in mapNodes"
            :key="node.id"
            x1="30%"
            y1="50%"
            x2="58%"
            :y2="nodeY(index)"
            :class="`int-map__line int-map__line--${node.health}`"
          />
        </svg>
        <div class="int-map__hub">
          <span class="int-map__hub-name">{{ t('integrations.mapHub') }}</span>
          <span class="int-map__hub-sub">{{ t('integrations.mapHubSub') }}</span>
        </div>
        <button
          v-for="(node, index) in mapNodes"
          :key="node.id"
          type="button"
          class="int-map__node"
          :style="{ top: nodeY(index) }"
          @click="jumpTo(node.anchor)"
        >
          <span class="int-map__node-text">
            <span class="int-map__node-name">{{ node.name }}</span>
            <span class="int-muted">{{ t(`integrations.nodeKinds.${node.kind}`) }}</span>
          </span>
          <span class="int-map__status" :class="`int-map__status--${node.health}`">
            <CaIcon :name="node.health === 'ok' ? 'check-circle' : node.health === 'bad' ? 'error-circle' : 'clock'" :size="14" />
            {{ healthWord(node.health) }}
          </span>
        </button>
      </div>
    </section>

    <section v-if="canView" id="int-provider" class="int-provider">
      <h2 class="int-heading">{{ t('integrations.providerHeading') }}</h2>
      <div v-if="providerLoading" class="int-loading"><CaSpinner /></div>
      <p v-else-if="providerError" class="admin-error" role="alert">{{ providerError }}</p>
      <CaCard v-else-if="provider">
        <div class="int-provider__body">
          <div class="int-provider__row">
            <span class="int-provider__label">{{ t('integrations.providerLabel') }}</span>
            <span class="admin-mono">{{ provider.provider }}</span>
          </div>
          <div class="int-provider__row">
            <span class="int-provider__label">{{ t('integrations.modelLabel') }}</span>
            <span class="admin-mono">{{ provider.model }}</span>
          </div>
          <div class="int-provider__row">
            <span class="int-provider__label">{{ t('integrations.baseUrlLabel') }}</span>
            <span class="admin-mono">{{ provider.baseUrl || '—' }}</span>
          </div>
          <div class="int-provider__row">
            <span class="int-provider__label">{{ t('integrations.timeoutLabel') }}</span>
            <span class="admin-mono">{{ provider.timeoutMs }} ms</span>
          </div>
          <div class="int-provider__row">
            <span class="int-provider__label">{{ t('integrations.credentialsLabel') }}</span>
            <span class="int-provider__creds">
              <CaBadge
                v-for="cred in credentialBadges"
                :key="cred.key"
                :variant="cred.configured ? 'success' : 'neutral'"
                size="small"
              >
                {{ cred.key }}: {{ cred.configured ? t('integrations.configuredBadge') : t('integrations.missingBadge') }}
              </CaBadge>
            </span>
          </div>
          <p class="int-provider__hint">{{ t('integrations.providerHint') }}</p>
        </div>
      </CaCard>
    </section>

    <section id="int-mcp">
      <div class="int-section-head">
        <h2 class="int-heading">{{ t('integrations.mcpHeading') }}</h2>
        <CaButton v-if="canConfigure" variant="primary" @click="openMcpDialog">
          {{ t('integrations.addMcp') }}
        </CaButton>
      </div>
      <p v-if="mcpError" class="admin-error" role="alert">{{ mcpError }}</p>
      <CaTable
        table-key="mcp-servers"
        :columns="mcpColumns"
        :rows="mcpItems"
        :row-key="(row) => row.id"
        :loading="mcpLoading"
        :empty-title="t('table.empty')"
      >
        <template #cell-name="{ row }">
          <div class="int-cell">
            <span class="int-cell__name">{{ row.name }}</span>
            <span class="int-cell__sub">{{ row.code }}</span>
          </div>
        </template>
        <template #cell-base="{ row }">
          <span class="admin-mono">{{ row.base_url }}</span>
        </template>
        <template #cell-health="{ row }">
          <div class="int-health">
            <CaBadge :variant="healthVariant(row as McpServerRow)" size="small">
              {{ healthLabel(row as McpServerRow) }}
            </CaBadge>
            <span v-if="(row as McpServerRow).last_health_at" class="int-health__time">
              {{ formatDateTime((row as McpServerRow).last_health_at!) }}
            </span>
          </div>
        </template>
        <template #cell-enabled="{ row }">
          <CaSwitch
            :model-value="(row as McpServerRow).enabled"
            :disabled="!canConfigure"
            @update:model-value="(v: boolean) => toggleMcp(row as McpServerRow, v)"
          />
        </template>
        <template #cell-actions="{ row }">
          <div class="int-actions">
            <CaButton
              size="small"
              variant="secondary"
              :loading="healthRunning.has((row as McpServerRow).id)"
              @click="checkMcp(row as McpServerRow)"
            >
              {{ t('integrations.healthCheck') }}
            </CaButton>
            <template v-if="(row as McpServerRow).auth_type === 'oauth'">
              <CaButton size="small" variant="secondary" @click="openClientDialog(row as McpServerRow)">
                {{ t('integrations.oauthClient') }}
              </CaButton>
              <CaButton
                v-if="(row as McpServerRow).oauth_connected"
                size="small"
                variant="secondary"
                @click="disconnectMcp(row as McpServerRow)"
              >
                {{ t('integrations.oauthDisconnect') }}
              </CaButton>
              <CaButton v-else size="small" variant="primary" @click="connectMcp(row as McpServerRow)">
                {{ t('integrations.oauthConnect') }}
              </CaButton>
            </template>
            <CaButton size="small" variant="secondary" @click="openMcpTools(row as McpServerRow)">
              {{ t('connectors.mcpTools') }}
            </CaButton>
            <CaButton size="small" variant="primary" @click="openMcpGrants(row as McpServerRow)">
              {{ t('connectors.access') }}
            </CaButton>
            <CaButton size="small" variant="danger" @click="removeMcp(row as McpServerRow)">
              {{ t('common.delete') }}
            </CaButton>
          </div>
        </template>
      </CaTable>
      <ConnectorGrantsDialog
        v-if="mcpGrantsFor"
        v-model:open="mcpGrantsOpen"
        connector-type="mcp"
        :connector-id="mcpGrantsFor.id"
        :connector-name="mcpGrantsFor.name"
        :can-configure="canConfigure"
      />
      <McpToolsDialog
        v-if="mcpToolsFor"
        v-model:open="mcpToolsOpen"
        :server-id="mcpToolsFor.id"
        :server-name="mcpToolsFor.name"
        :can-configure="canConfigure"
      />
    </section>

    <div id="int-db">
      <DbConnectorsSection v-if="canView" :key="dbSectionKey" :can-configure="canConfigure" />
    </div>

    <section id="int-rest">
      <div class="int-section-head">
        <h2 class="int-heading">{{ t('integrations.restHeading') }}</h2>
        <CaButton v-if="canConfigure" variant="primary" @click="openRestDialog">
          {{ t('integrations.addRest') }}
        </CaButton>
      </div>
      <p v-if="restError" class="admin-error" role="alert">{{ restError }}</p>
      <CaTable
        table-key="rest-connectors"
        :columns="restColumns"
        :rows="restItems"
        :row-key="(row) => row.id"
        :loading="restLoading"
        :empty-title="t('table.empty')"
      >
        <template #cell-name="{ row }">
          <div class="int-cell">
            <span class="int-cell__name">{{ row.name }}</span>
            <span class="int-cell__sub">{{ row.code }} · {{ row.tool_endpoints.length }} endpoint</span>
          </div>
        </template>
        <template #cell-base="{ row }">
          <span class="admin-mono">{{ row.base_url }}</span>
        </template>
        <template #cell-health="{ row }">
          <div class="int-health">
            <CaBadge :variant="healthVariant(row as RestConnectorRow)" size="small">
              {{ healthLabel(row as RestConnectorRow) }}
            </CaBadge>
            <span v-if="(row as RestConnectorRow).last_health_at" class="int-health__time">
              {{ formatDateTime((row as RestConnectorRow).last_health_at!) }}
            </span>
          </div>
        </template>
        <template #cell-enabled="{ row }">
          <CaSwitch
            :model-value="(row as RestConnectorRow).enabled"
            :disabled="!canConfigure"
            @update:model-value="(v: boolean) => toggleRest(row as RestConnectorRow, v)"
          />
        </template>
        <template #cell-actions="{ row }">
          <div class="int-actions">
            <CaButton
              size="small"
              variant="secondary"
              :loading="healthRunning.has((row as RestConnectorRow).id)"
              @click="checkRest(row as RestConnectorRow)"
            >
              {{ t('integrations.healthCheck') }}
            </CaButton>
            <CaButton size="small" variant="danger" @click="removeRest(row as RestConnectorRow)">
              {{ t('common.delete') }}
            </CaButton>
          </div>
        </template>
      </CaTable>
    </section>

    <CaDialog
      v-model:open="mcpOpen"
      :title="t('integrations.mcpDialogTitle')"
      :subtitle="t('integrations.mcpDialogSubtitle')"
    >
      <p v-if="mcpFormError" class="admin-error" role="alert">{{ mcpFormError }}</p>
      <form class="admin-form" @submit.prevent="submitMcp">
        <CaField :label="t('integrations.formCode')" :hint="t('knowledge.formSourceCodeHint')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="mcpForm.code" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('integrations.formName')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="mcpForm.name" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('integrations.formBaseUrl')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="mcpForm.baseUrl" :aria-describedby="describedBy" type="url" />
          </template>
        </CaField>
        <CaField :label="t('integrations.formDescription')">
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="mcpForm.description" :aria-describedby="describedBy" :rows="2" />
          </template>
        </CaField>
        <CaField :label="t('integrations.formAuthType')">
          <template #default="{ id, describedBy }">
            <CaSelect :id="id" v-model="mcpForm.authType" :aria-describedby="describedBy" :options="mcpAuthTypeOptions" />
          </template>
        </CaField>
        <CaField v-if="mcpForm.authType === 'api_key'" :label="t('integrations.formApiKeyEnv')" :hint="t('integrations.formApiKeyEnvHint')">
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="mcpForm.apiKeyEnv" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <template v-if="mcpForm.authType === 'oauth'">
          <CaField :label="t('integrations.oauthClientId')">
            <template #default="{ id, describedBy }">
              <CaInput :id="id" v-model="mcpForm.oauthClientId" :aria-describedby="describedBy" autocomplete="off" />
            </template>
          </CaField>
          <CaField :label="t('integrations.oauthClientSecret')" :hint="t('integrations.oauthClientSecretHint')">
            <template #default="{ id, describedBy }">
              <CaInput :id="id" v-model="mcpForm.oauthClientSecret" :aria-describedby="describedBy" type="password" autocomplete="off" />
            </template>
          </CaField>
        </template>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="mcpOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="mcpSaving" @click="submitMcp">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="clientOpen"
      :title="t('integrations.oauthClientDialogTitle')"
      :subtitle="t('integrations.oauthClientDialogSubtitle')"
    >
      <p v-if="clientFormError" class="admin-error" role="alert">{{ clientFormError }}</p>
      <form class="admin-form" @submit.prevent="submitClient">
        <CaField :label="t('integrations.oauthClientId')">
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="clientForm.clientId" :aria-describedby="describedBy" autocomplete="off" />
          </template>
        </CaField>
        <CaField :label="t('integrations.oauthClientSecret')" :hint="t('integrations.oauthClientSecretHint')">
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="clientForm.clientSecret" :aria-describedby="describedBy" type="password" autocomplete="off" />
          </template>
        </CaField>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="clientOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="clientSaving" @click="submitClient">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="restOpen"
      :title="t('integrations.restDialogTitle')"
      :subtitle="t('integrations.restDialogSubtitle')"
    >
      <p v-if="restFormError" class="admin-error" role="alert">{{ restFormError }}</p>
      <form class="admin-form" @submit.prevent="submitRest">
        <CaField :label="t('integrations.formCode')" :hint="t('knowledge.formSourceCodeHint')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="restForm.code" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('integrations.formName')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="restForm.name" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('integrations.formBaseUrl')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="restForm.baseUrl" :aria-describedby="describedBy" type="url" />
          </template>
        </CaField>
        <CaField :label="t('integrations.formEndpoints')" :hint="t('integrations.formEndpointsHint')" required>
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="restForm.endpoints" :aria-describedby="describedBy" :rows="4" />
          </template>
        </CaField>
        <CaField :label="t('integrations.formAuthType')">
          <template #default="{ id, describedBy }">
            <CaSelect :id="id" v-model="restForm.authType" :aria-describedby="describedBy" :options="authTypeOptions" />
          </template>
        </CaField>
        <CaField v-if="restForm.authType === 'api_key'" :label="t('integrations.formApiKeyEnv')" :hint="t('integrations.formApiKeyEnvHint')">
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="restForm.apiKeyEnv" :aria-describedby="describedBy" />
          </template>
        </CaField>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="restOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="restSaving" @click="submitRest">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>
  </div>
</template>

<style scoped>
.int-muted {
  color: var(--ca-fg-3);
}

.int-map {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-8);
  margin-bottom: var(--ca-space-16);
}

.int-map__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--ca-space-4);
}

.int-map__canvas {
  position: relative;
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-canvas);
}

.int-map__lines {
  position: absolute;
  inset: 0;
}

.int-map__line {
  stroke-width: 1.5;
}

.int-map__line--ok {
  stroke: var(--ca-chart-1);
}

.int-map__line--bad {
  stroke: var(--ca-danger-stroke);
  stroke-dasharray: 6 4;
}

.int-map__line--unknown {
  stroke: var(--ca-chart-4);
  stroke-dasharray: 2 4;
  stroke-linecap: round;
}

.int-map__hub {
  position: absolute;
  left: 4%;
  width: 26%;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
  padding: var(--ca-space-8);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-color-brand-strong);
  color: var(--ca-fg-on-brand-strong);
  box-shadow: var(--ca-shadow-8);
}

.int-map__hub-name {
  font-weight: var(--ca-font-weight-semibold);
}

.int-map__hub-sub {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}

.int-map__node {
  position: absolute;
  left: 58%;
  width: 38%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-6);
  padding: var(--ca-space-4) var(--ca-space-6);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface);
  box-shadow: var(--ca-shadow-4);
  color: var(--ca-fg-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.int-map__node:hover {
  box-shadow: var(--ca-shadow-8);
}

.int-map__node-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.int-map__node-name {
  font-weight: var(--ca-font-weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.int-map__node-text .int-muted {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}

.int-map__status {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-2);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
}

.int-map__status--ok {
  color: var(--ca-success-fg);
}

.int-map__status--bad {
  color: var(--ca-danger-fg);
}

.int-map__status--unknown {
  color: var(--ca-fg-3);
}

@media (max-width: 900px) {
  .int-map__canvas {
    height: auto !important;
    display: flex;
    flex-direction: column;
    gap: var(--ca-space-4);
    padding: var(--ca-space-6);
  }

  .int-map__lines {
    display: none;
  }

  .int-map__hub,
  .int-map__node {
    position: static;
    width: auto;
    transform: none;
  }
}

.int-heading {
  margin: 0 0 var(--ca-space-4);
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.int-provider {
  margin-bottom: var(--ca-space-10);
}

.int-provider__body {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.int-provider__row {
  display: flex;
  gap: var(--ca-space-6);
  font-size: var(--ca-text-300);
}

.int-provider__label {
  width: 200px;
  flex-shrink: 0;
  color: var(--ca-fg-3);
}

.int-provider__creds {
  display: flex;
  gap: var(--ca-space-3);
  flex-wrap: wrap;
}

.int-provider__hint {
  margin: var(--ca-space-2) 0 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.int-loading {
  padding: var(--ca-space-6) 0;
}

.int-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
  margin-bottom: var(--ca-space-4);
  flex-wrap: wrap;
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

.int-cell__sub {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  font-family: var(--ca-font-family-monospace, monospace);
}

.int-health {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.int-health__time {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.int-actions {
  display: flex;
  gap: var(--ca-space-3);
  flex-wrap: wrap;
}

section + section {
  margin-top: var(--ca-space-10);
}
</style>
