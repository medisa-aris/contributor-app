<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AI_PROVIDER_CODES } from '@bara/shared';
import {
  addModels,
  checkProvider,
  deleteModel,
  discoverModels,
  disableModel,
  enableModel,
  getDefaultLimits,
  listCatalog,
  listProviders,
  saveDefaultLimits,
  setDefaultModel,
  testModel,
  updateModel,
  type AiModelDto,
  type AiProviderCode,
  type AiProviderStatusDto,
  type DefaultModelLimitsDto,
  type DiscoveredModel,
  type ModelTestResultDto,
} from '@/api/models';
import { ApiError } from '@/api/http';
import {
  adminCancelRun,
  adminRuns,
  getLongRunSettings,
  saveLongRunSettings,
  type LongRunSettings,
  type RunDto,
} from '@/api/runs';
import { useToastStore } from '@/stores/toast.store';
import { formatDateTime } from '@/utils/format';
import {
  CaBadge,
  CaButton,
  CaCheckbox,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaRowMenu,
  CaSegmented,
  CaSelect,
  CaSpinner,
  CaSwitch,
  CaTable,
  CaTextarea,
  type CaMenuItem,
  type CaTableColumn,
} from '@/components/ui';

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(true);
const failed = ref(false);
const providers = ref<AiProviderStatusDto[]>([]);
const models = ref<AiModelDto[]>([]);
const limits = ref<DefaultModelLimitsDto>({ tokenLimit: null, period: 'day', requestsPerMinute: null });
const checking = ref<AiProviderCode | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    const [p, m, l] = await Promise.all([listProviders(), listCatalog(), getDefaultLimits()]);
    providers.value = p;
    models.value = m;
    applyLimits(l);
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

function fail(caught: unknown): void {
  toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') }, 5000);
}

function replaceModel(model: AiModelDto): void {
  const index = models.value.findIndex((m) => m.id === model.id);
  if (index >= 0) models.value.splice(index, 1, model);
  else models.value.push(model);
}

async function check(code: AiProviderCode): Promise<void> {
  checking.value = code;
  try {
    const result = await checkProvider(code);
    const provider = providers.value.find((p) => p.code === code);
    if (provider) provider.lastCheck = result;
  } catch (caught) {
    fail(caught);
  } finally {
    checking.value = null;
  }
}

// ───────── Batas model bawaan ─────────
const tokenUnlimited = ref(true);
const tokenLimitText = ref('');
const rpmUnlimited = ref(true);
const rpmText = ref('');
const savingLimits = ref(false);

function applyLimits(value: DefaultModelLimitsDto): void {
  limits.value = value;
  tokenUnlimited.value = value.tokenLimit === null;
  tokenLimitText.value = value.tokenLimit === null ? '' : String(value.tokenLimit);
  rpmUnlimited.value = value.requestsPerMinute === null;
  rpmText.value = value.requestsPerMinute === null ? '' : String(value.requestsPerMinute);
}

const periodItems = computed(() => [
  { key: 'day' as const, label: t('models.admin.limits.period.day') },
  { key: 'week' as const, label: t('models.admin.limits.period.week') },
]);

async function saveLimits(): Promise<void> {
  const tokenLimit = tokenUnlimited.value ? null : Number.parseInt(tokenLimitText.value, 10);
  const rpm = rpmUnlimited.value ? null : Number.parseInt(rpmText.value, 10);
  if ((tokenLimit !== null && !(tokenLimit > 0)) || (rpm !== null && !(rpm > 0))) {
    toast.push({ variant: 'danger', title: t('errors.requiredFields') }, 4000);
    return;
  }
  savingLimits.value = true;
  try {
    applyLimits(await saveDefaultLimits({ tokenLimit, period: limits.value.period, requestsPerMinute: rpm }));
    toast.push({ variant: 'success', title: t('models.admin.limits.savedNote') });
  } catch (caught) {
    fail(caught);
  } finally {
    savingLimits.value = false;
  }
}

const defaultLimited = computed(() => limits.value.tokenLimit !== null || limits.value.requestsPerMinute !== null);

// ───────── Katalog ─────────
const columns = computed<CaTableColumn[]>(() => [
  { key: 'name', label: t('models.admin.columns.name'), sortValue: (row) => row.displayName },
  { key: 'provider', label: t('models.admin.columns.provider'), sortValue: (row) => row.provider },
  { key: 'status', label: t('models.admin.columns.status') },
  { key: 'capabilities', label: t('models.admin.columns.capabilities'), sortable: false },
  { key: 'costTier', label: t('models.admin.columns.costTier') },
  { key: 'leaderGrantable', label: t('models.admin.columns.leaderGrantable') },
  { key: 'lastTest', label: t('models.admin.columns.lastTest') },
  { key: 'actions', label: t('table.actions'), sortable: false },
]);

const statusVariant = (status: AiModelDto['status']) =>
  status === 'enabled' ? 'success' : status === 'draft' ? 'informative' : 'neutral';

function menuFor(model: AiModelDto): CaMenuItem[] {
  return [
    { key: 'test', label: t('models.admin.actions.test') },
    ...(model.status !== 'enabled' ? [{ key: 'enable', label: t('models.admin.actions.enable') }] : []),
    ...(model.status === 'enabled' && !model.isDefault ? [{ key: 'default', label: t('models.admin.actions.makeDefault') }] : []),
    ...(model.status === 'enabled' && !model.isDefault ? [{ key: 'disable', label: t('models.admin.actions.disable') }] : []),
    { key: 'edit', label: t('models.admin.actions.edit') },
    ...(model.status !== 'enabled' ? [{ key: 'delete', label: t('models.admin.actions.delete'), danger: true }] : []),
  ];
}

async function onMenu(model: AiModelDto, key: string): Promise<void> {
  try {
    if (key === 'test') openTest(model);
    else if (key === 'edit') openEdit(model);
    else if (key === 'enable') {
      if (model.lastTestOk !== true) {
        toast.push({ variant: 'warning', title: t('models.admin.enableNeedsTest') }, 4000);
        openTest(model);
        return;
      }
      replaceModel(await enableModel(model.id));
    } else if (key === 'disable') replaceModel(await disableModel(model.id));
    else if (key === 'default') {
      const message = t('models.admin.defaultConfirm', {
        name: model.displayName,
        limits: defaultLimited.value ? t('models.admin.defaultConfirmLimited') : t('models.admin.defaultConfirmUnlimited'),
        tier: model.costTier ? t(`models.admin.costTier.${model.costTier}`) : '—',
      });
      if (!window.confirm(message)) return;
      await setDefaultModel(model.id);
      models.value = await listCatalog();
    } else if (key === 'delete') {
      if (!window.confirm(t('models.admin.deleteConfirm', { name: model.displayName }))) return;
      await deleteModel(model.id);
      models.value = models.value.filter((m) => m.id !== model.id);
    }
  } catch (caught) {
    fail(caught);
  }
}

// ───────── Dialog tambah ─────────
const addOpen = ref(false);
const addSaving = ref(false);
const addForm = ref({ provider: 'openrouter' as AiProviderCode, modelKey: '', displayName: '', description: '' });
const providerOptions = computed(() =>
  AI_PROVIDER_CODES.map((code) => ({ value: code, label: code })),
);

function openAdd(): void {
  const firstConfigured = providers.value.find((p) => p.configured)?.code ?? 'openrouter';
  addForm.value = { provider: firstConfigured, modelKey: '', displayName: '', description: '' };
  addOpen.value = true;
}

async function submitAdd(): Promise<void> {
  if (!addForm.value.modelKey.trim()) return;
  addSaving.value = true;
  try {
    const [created] = await addModels([
      {
        provider: addForm.value.provider,
        modelKey: addForm.value.modelKey.trim(),
        ...(addForm.value.displayName.trim() ? { displayName: addForm.value.displayName.trim() } : {}),
        ...(addForm.value.description.trim() ? { description: addForm.value.description.trim() } : {}),
      },
    ]);
    if (created) {
      replaceModel(created);
      addOpen.value = false;
      openTest(created);
    }
  } catch (caught) {
    fail(caught);
  } finally {
    addSaving.value = false;
  }
}

// ───────── Dialog ubah ─────────
const editOpen = ref(false);
const editSaving = ref(false);
const editing = ref<AiModelDto | null>(null);
const editForm = ref({
  displayName: '',
  description: '',
  contextWindow: '',
  maxOutputTokens: '',
  costTier: '',
  leaderGrantable: true,
  supportsTools: false,
  supportsVision: false,
  supportsStream: true,
  longRunAllowed: false,
  acceptsSamplingParams: true,
});
const tierOptions = computed(() => [
  { value: '', label: '—' },
  { value: '1', label: t('models.admin.costTier.1') },
  { value: '2', label: t('models.admin.costTier.2') },
  { value: '3', label: t('models.admin.costTier.3') },
]);

function openEdit(model: AiModelDto): void {
  editing.value = model;
  editForm.value = {
    displayName: model.displayName,
    description: model.description ?? '',
    contextWindow: model.contextWindow ? String(model.contextWindow) : '',
    maxOutputTokens: model.maxOutputTokens ? String(model.maxOutputTokens) : '',
    costTier: model.costTier ? String(model.costTier) : '',
    leaderGrantable: model.leaderGrantable,
    supportsTools: model.supportsTools,
    supportsVision: model.supportsVision,
    supportsStream: model.supportsStream,
    longRunAllowed: model.longRunAllowed,
    acceptsSamplingParams: model.acceptsSamplingParams,
  };
  editOpen.value = true;
}

const intOrNull = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

async function submitEdit(): Promise<void> {
  if (!editing.value) return;
  editSaving.value = true;
  try {
    replaceModel(
      await updateModel(editing.value.id, {
        displayName: editForm.value.displayName.trim() || editing.value.displayName,
        description: editForm.value.description.trim() || null,
        contextWindow: intOrNull(editForm.value.contextWindow),
        maxOutputTokens: intOrNull(editForm.value.maxOutputTokens),
        costTier: (intOrNull(editForm.value.costTier) as 1 | 2 | 3 | null) ?? null,
        leaderGrantable: editForm.value.leaderGrantable,
        supportsTools: editForm.value.supportsTools,
        supportsVision: editForm.value.supportsVision,
        supportsStream: editForm.value.supportsStream,
        longRunAllowed: editForm.value.longRunAllowed,
        acceptsSamplingParams: editForm.value.acceptsSamplingParams,
      }),
    );
    editOpen.value = false;
    toast.push({ variant: 'success', title: t('models.admin.saved') });
  } catch (caught) {
    fail(caught);
  } finally {
    editSaving.value = false;
  }
}

// ───────── Dialog uji ─────────
const testOpen = ref(false);
const testing = ref(false);
const testTarget = ref<AiModelDto | null>(null);
const testVision = ref(false);
const testResult = ref<ModelTestResultDto | null>(null);

function openTest(model: AiModelDto): void {
  testTarget.value = model;
  testVision.value = false;
  testResult.value = null;
  testOpen.value = true;
}

async function runTest(): Promise<void> {
  if (!testTarget.value) return;
  testing.value = true;
  try {
    testResult.value = await testModel(testTarget.value.id, testVision.value);
    replaceModel(testResult.value.model);
    testTarget.value = testResult.value.model;
  } catch (caught) {
    fail(caught);
  } finally {
    testing.value = false;
  }
}

async function enableAfterTest(): Promise<void> {
  if (!testTarget.value) return;
  try {
    replaceModel(await enableModel(testTarget.value.id));
    testOpen.value = false;
  } catch (caught) {
    fail(caught);
  }
}

// ───────── Kerja panjang ─────────
const longRun = ref<LongRunSettings | null>(null);
const longRunForm = ref({ maxMinutes: '60', maxIterations: '60', maxConcurrent: '2', autoPromote: true, budget: '' });
const savingLongRun = ref(false);
const runsActive = ref<RunDto[]>([]);

async function loadLongRun(): Promise<void> {
  try {
    const [settings, runs] = await Promise.all([getLongRunSettings(), adminRuns()]);
    longRun.value = settings;
    runsActive.value = runs;
    longRunForm.value = {
      maxMinutes: String(settings.maxMinutes),
      maxIterations: String(settings.maxIterations),
      maxConcurrent: String(settings.maxConcurrentPerUser),
      autoPromote: settings.autoPromote,
      budget: settings.defaultTokenBudget ? String(settings.defaultTokenBudget) : '',
    };
  } catch {
    longRun.value = null;
  }
}

async function saveLongRun(): Promise<void> {
  savingLongRun.value = true;
  try {
    await saveLongRunSettings({
      maxMinutes: intOrNull(longRunForm.value.maxMinutes) ?? 60,
      maxIterations: intOrNull(longRunForm.value.maxIterations) ?? 60,
      maxConcurrentPerUser: intOrNull(longRunForm.value.maxConcurrent) ?? 2,
      autoPromote: longRunForm.value.autoPromote,
      defaultTokenBudget: intOrNull(longRunForm.value.budget),
    });
    toast.push({ variant: 'success', title: t('models.admin.saved') });
    await loadLongRun();
  } catch (caught) {
    fail(caught);
  } finally {
    savingLongRun.value = false;
  }
}

async function stopRun(id: string): Promise<void> {
  try {
    await adminCancelRun(id);
    runsActive.value = runsActive.value.filter((r) => r.id !== id);
  } catch (caught) {
    fail(caught);
  }
}

// ───────── Cari model ─────────
const discoverOpen = ref(false);
const discoverProvider = ref<AiProviderCode>('openrouter');
const discovering = ref(false);
const discovered = ref<DiscoveredModel[] | null>(null);
const discoverFilter = ref('');
const discoverPicked = ref<string[]>([]);
const discoverAdding = ref(false);
const configuredOptions = computed(() =>
  providers.value.filter((p) => p.configured).map((p) => ({ value: p.code, label: p.code })),
);
const discoverVisible = computed(() => {
  const q = discoverFilter.value.trim().toLowerCase();
  const list = discovered.value ?? [];
  return (q ? list.filter((m) => m.modelKey.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q)) : list).slice(0, 200);
});

function openDiscover(): void {
  discoverProvider.value = providers.value.find((p) => p.configured)?.code ?? 'openrouter';
  discovered.value = null;
  discoverFilter.value = '';
  discoverPicked.value = [];
  discoverOpen.value = true;
}

async function runDiscover(): Promise<void> {
  discovering.value = true;
  discoverPicked.value = [];
  try {
    discovered.value = await discoverModels(discoverProvider.value);
  } catch (caught) {
    fail(caught);
  } finally {
    discovering.value = false;
  }
}

function togglePick(key: string, on: boolean): void {
  discoverPicked.value = on ? [...new Set([...discoverPicked.value, key])] : discoverPicked.value.filter((k) => k !== key);
}

async function addPicked(): Promise<void> {
  const items = (discovered.value ?? []).filter((m) => discoverPicked.value.includes(m.modelKey));
  if (items.length === 0) return;
  discoverAdding.value = true;
  try {
    const created = await addModels(
      items.map((m) => ({
        provider: discoverProvider.value,
        modelKey: m.modelKey,
        displayName: m.displayName,
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxOutputTokens ? { maxOutputTokens: m.maxOutputTokens } : {}),
        ...(m.supportsTools !== null ? { supportsTools: m.supportsTools } : {}),
        ...(m.supportsVision !== null ? { supportsVision: m.supportsVision } : {}),
      })),
    );
    created.forEach(replaceModel);
    discoverOpen.value = false;
    toast.push({ variant: 'success', title: t('models.discover.added', { n: created.length }) });
  } catch (caught) {
    fail(caught);
  } finally {
    discoverAdding.value = false;
  }
}

onMounted(() => {
  void load();
  void loadLongRun();
});
</script>

<template>
  <section>
    <CaPageHeader :title="t('models.admin.title')" :description="t('models.admin.description')">
      <template #actions>
        <CaButton v-if="!loading && !failed" :disabled="configuredOptions.length === 0" @click="openDiscover">
          {{ t('models.discover.button') }}
        </CaButton>
        <CaButton v-if="!loading && !failed" variant="primary" @click="openAdd">{{ t('models.admin.addManual') }}</CaButton>
      </template>
    </CaPageHeader>

    <div v-if="loading" class="mdl-loading"><CaSpinner size="large" /></div>
    <p v-else-if="failed" class="admin-error">{{ t('errors.loadFailed') }}</p>

    <template v-else>
      <h2 class="mdl-section">{{ t('models.admin.providersTitle') }}</h2>
      <div class="mdl-providers">
        <article v-for="provider in providers" :key="provider.code" class="ca-panel mdl-provider">
          <header class="mdl-provider__head">
            <strong class="mdl-provider__name">{{ provider.code }}</strong>
            <CaBadge :variant="provider.configured ? 'success' : 'neutral'" size="small">
              {{ provider.configured ? t('models.admin.providerConfigured') : t('models.admin.providerNotConfigured') }}
            </CaBadge>
          </header>
          <p class="mdl-mono">{{ provider.baseUrl }}</p>
          <p class="mdl-muted">
            {{ t('models.admin.providerModels', { enabled: provider.enabledModelCount, total: provider.modelCount }) }}
          </p>
          <p v-if="!provider.configured" class="mdl-muted">{{ t('models.admin.providerHint', { env: provider.envVar }) }}</p>
          <p v-if="provider.lastCheck" class="mdl-check" :class="{ 'mdl-check--bad': !provider.lastCheck.ok }">
            {{
              provider.lastCheck.ok
                ? t('models.admin.checkOk', { ms: provider.lastCheck.latencyMs ?? '—' })
                : t('models.admin.checkFailed', { error: provider.lastCheck.error ?? '—' })
            }}
          </p>
          <CaButton size="small" :loading="checking === provider.code" :disabled="!provider.configured" @click="check(provider.code)">
            {{ t('models.admin.checkConnection') }}
          </CaButton>
        </article>
      </div>

      <section class="ca-panel mdl-limits" aria-labelledby="mdl-limits-title">
        <h2 id="mdl-limits-title" class="ca-panel__title">{{ t('models.admin.limits.title') }}</h2>
        <p class="mdl-muted">{{ t('models.admin.limits.hint') }}</p>
        <div class="mdl-limits__grid">
          <CaField :label="t('models.admin.limits.tokenLimit')">
            <template #default="{ id }">
              <div class="mdl-limit">
                <CaSwitch v-model="tokenUnlimited" :label="t('models.admin.limits.unlimited')" />
                <template v-if="!tokenUnlimited">
                  <CaInput :id="id" v-model="tokenLimitText" inputmode="numeric" />
                  <CaSegmented v-model="limits.period" :items="periodItems" :label="t('models.admin.limits.tokenLimit')" />
                </template>
              </div>
            </template>
          </CaField>
          <CaField :label="t('models.admin.limits.requestsPerMinute')">
            <template #default="{ id }">
              <div class="mdl-limit">
                <CaSwitch v-model="rpmUnlimited" :label="t('models.admin.limits.unlimited')" />
                <CaInput v-if="!rpmUnlimited" :id="id" v-model="rpmText" inputmode="numeric" />
              </div>
            </template>
          </CaField>
        </div>
        <CaButton variant="primary" :loading="savingLimits" @click="saveLimits">{{ t('models.admin.limits.save') }}</CaButton>
      </section>

      <section v-if="longRun" class="ca-panel mdl-limits" aria-labelledby="mdl-longrun-title">
        <h2 id="mdl-longrun-title" class="ca-panel__title">{{ t('runs.admin.title') }}</h2>
        <div class="mdl-limits__grid">
          <CaField :label="t('runs.admin.maxMinutes')">
            <template #default="{ id }"><CaInput :id="id" v-model="longRunForm.maxMinutes" inputmode="numeric" /></template>
          </CaField>
          <CaField :label="t('runs.admin.maxIterations')">
            <template #default="{ id }"><CaInput :id="id" v-model="longRunForm.maxIterations" inputmode="numeric" /></template>
          </CaField>
          <CaField :label="t('runs.admin.maxConcurrent')">
            <template #default="{ id }"><CaInput :id="id" v-model="longRunForm.maxConcurrent" inputmode="numeric" /></template>
          </CaField>
          <CaField :label="t('runs.admin.tokenBudget')" :hint="t('models.admin.limits.unlimited')">
            <template #default="{ id }"><CaInput :id="id" v-model="longRunForm.budget" inputmode="numeric" /></template>
          </CaField>
        </div>
        <CaSwitch v-model="longRunForm.autoPromote" :label="t('runs.admin.autoPromote')" />
        <CaButton variant="primary" :loading="savingLongRun" @click="saveLongRun">{{ t('runs.admin.save') }}</CaButton>
        <h3 class="mdl-subtitle">{{ t('runs.admin.activeTitle') }}</h3>
        <p v-if="runsActive.length === 0" class="mdl-muted">{{ t('runs.admin.activeEmpty') }}</p>
        <ul v-else class="mdl-runs">
          <li v-for="run in runsActive" :key="run.id">
            <strong>{{ run.conversationTitle ?? run.prompt?.slice(0, 60) ?? run.id }}</strong>
            <CaBadge size="small">{{ t(`runs.status.${run.status}`) }}</CaBadge>
            <span class="mdl-muted">{{ t('runs.steps', { n: run.iterations, max: run.maxIterations }) }}</span>
            <span class="mdl-muted">{{ t('runs.admin.attempt') }} {{ run.attempt }}</span>
            <span v-if="run.leaseOwner" class="mdl-mono">{{ t('runs.admin.worker') }}: {{ run.leaseOwner }}</span>
            <CaButton size="small" variant="secondary" @click="stopRun(run.id)">{{ t('runs.cancel') }}</CaButton>
          </li>
        </ul>
      </section>

      <h2 class="mdl-section">{{ t('models.admin.catalogTitle') }}</h2>
      <CaTable
        table-key="admin-models"
        :columns="columns"
        :rows="models"
        :row-key="(row) => row.id"
        :empty-title="t('models.admin.empty')"
      >
        <template #cell-name="{ row }">
          <div class="mdl-name">
            <strong>{{ row.displayName }}</strong>
            <span class="mdl-mono">{{ row.modelKey }}</span>
            <CaBadge v-if="row.isDefault" variant="brand" size="small">
              {{ defaultLimited ? t('models.admin.defaultBadgeLimited') : t('models.admin.defaultBadgeUnlimited') }}
            </CaBadge>
          </div>
        </template>
        <template #cell-provider="{ row }">
          <span>{{ row.provider }}</span>
          <span v-if="!row.providerConfigured" class="mdl-muted"> · {{ t('models.admin.providerNotConfigured') }}</span>
        </template>
        <template #cell-status="{ row }">
          <CaBadge :variant="statusVariant(row.status)" size="small">{{ t(`models.admin.status.${row.status}`) }}</CaBadge>
        </template>
        <template #cell-capabilities="{ row }">
          <span class="mdl-chips">
            <CaBadge v-if="row.supportsTools" size="small">{{ t('models.admin.capability.tools') }}</CaBadge>
            <CaBadge v-if="row.supportsVision" size="small">{{ t('models.admin.capability.vision') }}</CaBadge>
            <CaBadge v-if="row.supportsStream" size="small">{{ t('models.admin.capability.stream') }}</CaBadge>
          </span>
        </template>
        <template #cell-costTier="{ row }">{{ row.costTier ? t(`models.admin.costTier.${row.costTier}`) : '—' }}</template>
        <template #cell-leaderGrantable="{ row }">{{ row.leaderGrantable ? '✓' : '—' }}</template>
        <template #cell-lastTest="{ row }">
          <span v-if="!row.lastTestAt" class="mdl-muted">{{ t('models.admin.notTested') }}</span>
          <span v-else :class="{ 'mdl-check--bad': !row.lastTestOk }" :title="row.lastTestError ?? ''">
            {{ row.lastTestOk ? '✓' : '✗' }} {{ row.lastTestLatencyMs ?? '—' }} ms · {{ formatDateTime(row.lastTestAt) }}
          </span>
        </template>
        <template #cell-actions="{ row }">
          <CaRowMenu :items="menuFor(row as AiModelDto)" :label="row.displayName" @select="onMenu(row as AiModelDto, $event)" />
        </template>
      </CaTable>
    </template>

    <CaDialog v-model:open="addOpen" :title="t('models.admin.addDialog.title')">
      <form class="mdl-form" @submit.prevent="submitAdd">
        <CaField :label="t('models.admin.addDialog.provider')" required>
          <template #default="{ id }"><CaSelect :id="id" v-model="addForm.provider" :options="providerOptions" /></template>
        </CaField>
        <CaField :label="t('models.admin.addDialog.modelKey')" :hint="t('models.admin.addDialog.modelKeyHint')" required>
          <template #default="{ id }"><CaInput :id="id" v-model="addForm.modelKey" /></template>
        </CaField>
        <CaField :label="t('models.admin.addDialog.displayName')">
          <template #default="{ id }"><CaInput :id="id" v-model="addForm.displayName" /></template>
        </CaField>
        <CaField :label="t('models.admin.addDialog.description')">
          <template #default="{ id }"><CaTextarea :id="id" v-model="addForm.description" :rows="2" /></template>
        </CaField>
        <div class="mdl-form__actions">
          <CaButton type="submit" variant="primary" :loading="addSaving" :disabled="!addForm.modelKey.trim()">
            {{ t('models.admin.addDialog.submit') }}
          </CaButton>
        </div>
      </form>
    </CaDialog>

    <CaDialog v-model:open="discoverOpen" :title="t('models.discover.title')" size="large">
      <div class="mdl-form">
        <div class="mdl-discover__bar">
          <CaSelect v-model="discoverProvider" :options="configuredOptions" />
          <CaButton :loading="discovering" @click="runDiscover">{{ t('models.discover.load') }}</CaButton>
          <CaInput v-if="discovered" v-model="discoverFilter" type="search" :placeholder="t('models.discover.search')" />
        </div>
        <p v-if="discovered && discovered.length === 0" class="mdl-muted">{{ t('models.discover.empty') }}</p>
        <ul v-if="discovered && discovered.length > 0" class="mdl-discover__list">
          <li v-for="item in discoverVisible" :key="item.modelKey">
            <CaCheckbox
              :model-value="discoverPicked.includes(item.modelKey)"
              :disabled="item.alreadyInCatalog"
              :label="item.displayName"
              @update:model-value="togglePick(item.modelKey, $event)"
            />
            <span class="mdl-mono">{{ item.modelKey }}</span>
            <span v-if="item.contextWindow" class="mdl-muted">{{ t('models.discover.context', { n: item.contextWindow.toLocaleString('id-ID') }) }}</span>
            <CaBadge v-if="item.supportsTools" size="small">{{ t('models.admin.capability.tools') }}</CaBadge>
            <CaBadge v-if="item.supportsVision" size="small">{{ t('models.admin.capability.vision') }}</CaBadge>
            <CaBadge v-if="item.alreadyInCatalog" variant="success" size="small">{{ t('models.discover.already') }}</CaBadge>
          </li>
        </ul>
        <div class="mdl-form__actions">
          <CaButton variant="primary" :loading="discoverAdding" :disabled="discoverPicked.length === 0" @click="addPicked">
            {{ t('models.discover.add', { n: discoverPicked.length }) }}
          </CaButton>
        </div>
      </div>
    </CaDialog>

    <CaDialog v-model:open="editOpen" :title="t('models.admin.editDialog.title')">
      <form class="mdl-form" @submit.prevent="submitEdit">
        <CaField :label="t('models.admin.addDialog.displayName')">
          <template #default="{ id }"><CaInput :id="id" v-model="editForm.displayName" /></template>
        </CaField>
        <CaField :label="t('models.admin.addDialog.description')">
          <template #default="{ id }"><CaTextarea :id="id" v-model="editForm.description" :rows="2" /></template>
        </CaField>
        <div class="mdl-form__row">
          <CaField :label="t('models.admin.editDialog.contextWindow')">
            <template #default="{ id }"><CaInput :id="id" v-model="editForm.contextWindow" inputmode="numeric" /></template>
          </CaField>
          <CaField :label="t('models.admin.editDialog.maxOutput')">
            <template #default="{ id }"><CaInput :id="id" v-model="editForm.maxOutputTokens" inputmode="numeric" /></template>
          </CaField>
          <CaField :label="t('models.admin.editDialog.costTier')">
            <template #default="{ id }"><CaSelect :id="id" v-model="editForm.costTier" :options="tierOptions" /></template>
          </CaField>
        </div>
        <CaCheckbox v-model="editForm.leaderGrantable" :label="t('models.admin.editDialog.leaderGrantable')" />
        <CaCheckbox v-model="editForm.supportsTools" :label="t('models.admin.editDialog.supportsTools')" />
        <CaCheckbox v-model="editForm.supportsVision" :label="t('models.admin.editDialog.supportsVision')" />
        <CaCheckbox v-model="editForm.supportsStream" :label="t('models.admin.editDialog.supportsStream')" />
        <CaCheckbox v-model="editForm.longRunAllowed" :label="t('runs.admin.longRunAllowed')" />
        <CaCheckbox v-model="editForm.acceptsSamplingParams" :label="t('runs.admin.acceptsSampling')" />
        <div class="mdl-form__actions">
          <CaButton type="submit" variant="primary" :loading="editSaving">{{ t('models.admin.editDialog.save') }}</CaButton>
        </div>
      </form>
    </CaDialog>

    <CaDialog v-model:open="testOpen" :title="t('models.admin.testDialog.title', { name: testTarget?.displayName ?? '' })">
      <div class="mdl-form">
        <CaCheckbox v-model="testVision" :label="t('models.admin.testDialog.vision')" />
        <ul v-if="testResult" class="mdl-probes">
          <li v-for="probe in testResult.probes" :key="probe.probe" :class="{ 'mdl-check--bad': !probe.ok }">
            <strong>{{ probe.ok ? '✓' : '✗' }} {{ t(`models.admin.testDialog.probe.${probe.probe}`) }}</strong>
            <span v-if="probe.latencyMs !== null" class="mdl-muted"> · {{ probe.latencyMs }} ms</span>
            <p v-if="probe.detail" class="mdl-muted mdl-probes__detail">{{ probe.detail }}</p>
          </li>
        </ul>
        <div class="mdl-form__actions">
          <CaButton :loading="testing" @click="runTest">
            {{ testing ? t('models.admin.testDialog.running') : t('models.admin.testDialog.run') }}
          </CaButton>
          <CaButton
            v-if="testResult?.model.lastTestOk && testTarget?.status !== 'enabled'"
            variant="primary"
            @click="enableAfterTest"
          >
            {{ t('models.admin.testDialog.enableNow') }}
          </CaButton>
        </div>
      </div>
    </CaDialog>
  </section>
</template>

<style scoped>
.mdl-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-8);
}
.mdl-section {
  margin: var(--ca-space-6) 0 var(--ca-space-3);
  font-size: var(--ca-text-400);
}
.mdl-providers {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--ca-space-4);
}
.mdl-provider {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
  align-items: flex-start;
}
.mdl-provider__head {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  gap: var(--ca-space-2);
}
.mdl-provider__name {
  text-transform: capitalize;
}
.mdl-provider p {
  margin: 0;
}
.mdl-mono {
  font-family: var(--ca-font-family-mono);
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
  word-break: break-all;
}
.mdl-muted {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}
.mdl-check {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-success, var(--ca-fg-2));
}
.mdl-check--bad {
  color: var(--ca-fg-danger, #b3261e);
}
.mdl-limits {
  margin-top: var(--ca-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  align-items: flex-start;
}
.mdl-limits__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--ca-space-4);
  width: 100%;
}
.mdl-limit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-3);
}
.mdl-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.mdl-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--ca-space-1);
}
.mdl-form {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}
.mdl-form__row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--ca-space-3);
}
.mdl-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ca-space-2);
}
.mdl-subtitle {
  margin: var(--ca-space-3) 0 0;
  font-size: var(--ca-text-300);
}
.mdl-runs {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}
.mdl-runs li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-2);
}
.mdl-discover__bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
  align-items: center;
}
.mdl-discover__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 50vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}
.mdl-discover__list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-2);
}
.mdl-probes {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}
.mdl-probes__detail {
  margin: 2px 0 0;
}
@media (max-width: 700px) {
  .mdl-form__row {
    grid-template-columns: 1fr;
  }
}
</style>
