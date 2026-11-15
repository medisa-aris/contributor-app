<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  createGrant,
  deleteGrant,
  effectiveModels,
  formatTokens,
  grantableModels,
  grantReach,
  listGrants,
  myModels,
  updateGrant,
  type AiModelDto,
  type GrantTarget,
  type ModelGrantDto,
  type QuotaPeriod,
  type ReachDto,
  type UserModelDto,
} from '@/api/models';
import { ApiError } from '@/api/http';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaCheckbox,
  CaDialog,
  CaEmptyState,
  CaField,
  CaIcon,
  CaInput,
  CaPageHeader,
  CaRowMenu,
  CaSegmented,
  CaSelect,
  CaSpinner,
  CaSwitch,
  CaTable,
  CaTabs,
  type CaMenuItem,
  type CaTableColumn,
} from '@/components/ui';

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(true);
const failed = ref(false);
const grants = ref<ModelGrantDto[]>([]);
const reach = ref<ReachDto | null>(null);
const models = ref<AiModelDto[]>([]);
const defaultModel = ref<UserModelDto | null>(null);
const tab = ref('grants');
const tabs = computed(() => [
  { key: 'grants', label: t('models.grants.tabs.grants') },
  { key: 'team', label: t('models.grants.tabs.team') },
]);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    const [g, r, m, mine] = await Promise.all([listGrants(), grantReach(), grantableModels(), myModels()]);
    grants.value = g;
    reach.value = r;
    models.value = m;
    defaultModel.value = mine.models.find((x) => x.isDefault) ?? null;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

function fail(caught: unknown): void {
  toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') }, 5000);
}

const noReach = computed(
  () => reach.value && !reach.value.global && reach.value.users.length === 0 && reach.value.departments.length === 0,
);

const defaultBanner = computed(() => {
  const model = defaultModel.value;
  if (!model) return '';
  const quota = model.quotas[0];
  const limits = quota
    ? t('models.grants.defaultLimited', { tokens: formatTokens(quota.limit), period: t(`models.grants.period.${quota.period}`) })
    : t('models.grants.defaultUnlimited');
  return t('models.grants.defaultBanner', { name: model.displayName, limits });
});

function limitText(grant: { tokenLimit: number | null; period: QuotaPeriod }): string {
  return grant.tokenLimit === null
    ? t('models.grants.unlimited')
    : t('models.grants.perPeriod', { tokens: formatTokens(grant.tokenLimit), period: t(`models.grants.period.${grant.period}`) });
}

const columns = computed<CaTableColumn[]>(() => [
  { key: 'target', label: t('models.grants.columns.target'), sortValue: (row) => row.targetName },
  { key: 'model', label: t('models.grants.columns.model'), sortValue: (row) => row.modelName },
  { key: 'limit', label: t('models.grants.columns.limit'), sortable: false },
  { key: 'grantedBy', label: t('models.grants.columns.grantedBy'), sortable: false },
  { key: 'note', label: t('models.grants.columns.note'), sortable: false },
  { key: 'actions', label: t('table.actions'), sortable: false },
]);

const targetIcon: Record<GrantTarget, string> = { user: 'people', department: 'people', agent: 'bot', everyone: 'people' };

function menuFor(grant: ModelGrantDto): CaMenuItem[] {
  const items: CaMenuItem[] = [];
  if (grant.targetType === 'user' && grant.targetId) items.push({ key: 'effective', label: t('models.grants.effective') });
  if (grant.editable) {
    items.push({ key: 'edit', label: t('models.admin.actions.edit') });
    items.push({ key: 'delete', label: t('models.admin.actions.delete'), danger: true });
  }
  return items;
}

async function onMenu(grant: ModelGrantDto, key: string): Promise<void> {
  if (key === 'effective' && grant.targetId) return openEffective(grant.targetId, grant.targetName);
  if (key === 'edit') return openEdit(grant);
  if (key === 'delete') {
    if (!window.confirm(t('models.grants.deleteConfirm', { model: grant.modelName, target: grant.targetName }))) return;
    try {
      await deleteGrant(grant.id);
      grants.value = grants.value.filter((g) => g.id !== grant.id);
      toast.push({ variant: 'success', title: t('models.grants.deleted') });
    } catch (caught) {
      fail(caught);
    }
  }
}

// ───────── Dialog izin ─────────
const dialogOpen = ref(false);
const saving = ref(false);
const editingGrant = ref<ModelGrantDto | null>(null);
const form = ref({
  targetType: 'user' as GrantTarget,
  targetId: '',
  includeSubDepartments: true,
  modelIds: [] as string[],
  unlimited: false,
  limit: '50000',
  period: 'day' as QuotaPeriod,
  note: '',
});

const targetItems = computed(() => {
  const items: { key: GrantTarget; label: string }[] = [
    { key: 'user', label: t('models.grants.targetType.user') },
    { key: 'department', label: t('models.grants.targetType.department') },
    { key: 'agent', label: t('models.grants.targetType.agent') },
  ];
  if (reach.value?.global) items.push({ key: 'everyone', label: t('models.grants.targetType.everyone') });
  return items;
});
const periodItems = computed(() => [
  { key: 'day' as const, label: t('models.grants.dialog.periodDay') },
  { key: 'week' as const, label: t('models.grants.dialog.periodWeek') },
]);
const targetOptions = computed(() => {
  const r = reach.value;
  if (!r) return [];
  if (form.value.targetType === 'user') {
    return r.users.map((u) => ({ value: u.id, label: `${u.name}${u.departmentName ? ` · ${u.departmentName}` : ''}` }));
  }
  if (form.value.targetType === 'department') return r.departments.map((d) => ({ value: d.id, label: d.name }));
  if (form.value.targetType === 'agent') return r.agents.map((a) => ({ value: a.id, label: `${a.name} · ${a.ownerName}` }));
  return [];
});

function openCreate(): void {
  editingGrant.value = null;
  form.value = {
    targetType: 'user',
    targetId: '',
    includeSubDepartments: true,
    modelIds: [],
    unlimited: false,
    limit: '50000',
    period: 'day',
    note: '',
  };
  dialogOpen.value = true;
}

function openEdit(grant: ModelGrantDto): void {
  editingGrant.value = grant;
  form.value = {
    targetType: grant.targetType,
    targetId: grant.targetId ?? '',
    includeSubDepartments: grant.includeSubDepartments,
    modelIds: [grant.modelId],
    unlimited: grant.tokenLimit === null,
    limit: grant.tokenLimit === null ? '50000' : String(grant.tokenLimit),
    period: grant.period,
    note: grant.note ?? '',
  };
  dialogOpen.value = true;
}

function toggleModel(id: string, on: boolean): void {
  form.value.modelIds = on ? [...new Set([...form.value.modelIds, id])] : form.value.modelIds.filter((m) => m !== id);
}

async function submit(): Promise<void> {
  const tokenLimit = form.value.unlimited ? null : Number.parseInt(form.value.limit, 10);
  if (tokenLimit !== null && !(tokenLimit > 0)) return;
  saving.value = true;
  try {
    if (editingGrant.value) {
      const updated = await updateGrant(editingGrant.value.id, {
        tokenLimit,
        period: form.value.period,
        includeSubDepartments: form.value.includeSubDepartments,
        note: form.value.note.trim() || null,
      });
      grants.value = grants.value.map((g) => (g.id === updated.id ? updated : g));
    } else {
      if (form.value.targetType !== 'everyone' && !form.value.targetId) return;
      for (const modelId of form.value.modelIds) {
        const created = await createGrant({
          targetType: form.value.targetType,
          targetId: form.value.targetType === 'everyone' ? null : form.value.targetId,
          includeSubDepartments: form.value.includeSubDepartments,
          modelId,
          tokenLimit,
          period: form.value.period,
          note: form.value.note.trim() || null,
        });
        grants.value = [created, ...grants.value];
      }
    }
    dialogOpen.value = false;
    toast.push({ variant: 'success', title: t('models.grants.created') });
  } catch (caught) {
    fail(caught);
  } finally {
    saving.value = false;
  }
}

const canSubmit = computed(
  () =>
    (editingGrant.value !== null || form.value.modelIds.length > 0) &&
    (form.value.targetType === 'everyone' || Boolean(form.value.targetId)),
);

// ───────── Efektif ─────────
const effectiveOpen = ref(false);
const effectiveName = ref('');
const effectiveRows = ref<UserModelDto[] | null>(null);

async function openEffective(userId: string, name: string): Promise<void> {
  effectiveName.value = name;
  effectiveRows.value = null;
  effectiveOpen.value = true;
  try {
    effectiveRows.value = await effectiveModels(userId);
  } catch (caught) {
    fail(caught);
    effectiveOpen.value = false;
  }
}

// ───────── Struktur tim ─────────
const team = computed(() => {
  const r = reach.value;
  if (!r) return [];
  return r.departments.map((department) => ({
    department,
    people: r.users.filter((u) => u.departmentId === department.id),
  }));
});
const grantsFor = (type: GrantTarget, id: string) => grants.value.filter((g) => g.targetType === type && g.targetId === id);
const agentsOf = (userId: string) => reach.value?.agents.filter((a) => a.ownerUserId === userId) ?? [];

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader :title="t('models.grants.title')" :description="t('models.grants.description')">
      <template #actions>
        <CaButton v-if="!loading && !failed && !noReach" variant="primary" @click="openCreate">
          {{ t('models.grants.add') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <div v-if="loading" class="grt-loading"><CaSpinner size="large" /></div>
    <p v-else-if="failed" class="admin-error">{{ t('errors.loadFailed') }}</p>
    <template v-else>
      <p v-if="defaultBanner" class="grt-banner"><CaIcon name="sparkle" :size="14" /> {{ defaultBanner }}</p>
      <CaEmptyState v-if="noReach" :title="t('models.grants.noReach')" />
      <template v-else>
        <CaTabs v-model="tab" :items="tabs" class="grt-tabs" />

        <CaTable
          v-if="tab === 'grants'"
          table-key="model-grants"
          :columns="columns"
          :rows="grants"
          :row-key="(row) => row.id"
          :empty-title="t('models.grants.empty')"
        >
          <template #cell-target="{ row }">
            <span class="grt-target">
              <CaIcon :name="targetIcon[(row as ModelGrantDto).targetType]" :size="14" />
              <span>{{ row.targetName }}</span>
              <span v-if="row.targetType === 'department' && row.includeSubDepartments" class="grt-muted">
                · {{ t('models.grants.subDepartments') }}
              </span>
              <CaBadge v-if="row.outOfReach" variant="warning" size="small">{{ t('models.grants.outOfReach') }}</CaBadge>
            </span>
          </template>
          <template #cell-model="{ row }">
            <span>{{ row.modelName }}</span>
            <CaBadge v-if="row.notApplicable" size="small">{{ t('models.grants.notApplicable') }}</CaBadge>
          </template>
          <template #cell-limit="{ row }">{{ limitText(row as ModelGrantDto) }}</template>
          <template #cell-grantedBy="{ row }">
            <span class="grt-target">
              <span v-if="!row.editable" :title="t('models.grants.lockedHint')"><CaIcon name="shield" :size="13" /></span>
              {{ row.createdByName }}
              <CaBadge size="small" :variant="row.grantedScope === 'admin' ? 'brand' : 'neutral'">
                {{ t(`models.grants.scope.${row.grantedScope}`) }}
              </CaBadge>
            </span>
          </template>
          <template #cell-note="{ row }"><span class="grt-muted">{{ row.note ?? '' }}</span></template>
          <template #cell-actions="{ row }">
            <CaRowMenu
              v-if="menuFor(row as ModelGrantDto).length > 0"
              :items="menuFor(row as ModelGrantDto)"
              :label="row.targetName"
              @select="onMenu(row as ModelGrantDto, $event)"
            />
          </template>
        </CaTable>

        <div v-else class="grt-team">
          <p class="grt-muted">{{ t('models.grants.teamSource') }}</p>
          <section v-for="node in team" :key="node.department.id" class="ca-panel grt-dept">
            <header class="grt-dept__head">
              <strong>{{ node.department.name }}</strong>
              <span class="grt-chips">
                <CaBadge v-for="g in grantsFor('department', node.department.id)" :key="g.id" size="small">
                  {{ g.modelName }} · {{ limitText(g) }}
                </CaBadge>
              </span>
            </header>
            <ul class="grt-people">
              <li v-for="person in node.people" :key="person.id">
                <button type="button" class="grt-person" @click="openEffective(person.id, person.name)">
                  <CaIcon name="people" :size="13" /> {{ person.name }}
                  <span v-if="person.jobTitle" class="grt-muted">· {{ person.jobTitle }}</span>
                </button>
                <span class="grt-chips">
                  <CaBadge v-for="g in grantsFor('user', person.id)" :key="g.id" size="small">
                    {{ g.modelName }} · {{ limitText(g) }}
                  </CaBadge>
                </span>
                <ul v-if="agentsOf(person.id).length > 0" class="grt-agents">
                  <li v-for="agent in agentsOf(person.id)" :key="agent.id">
                    <CaIcon name="bot" :size="12" /> {{ agent.name }}
                    <CaBadge v-for="g in grantsFor('agent', agent.id)" :key="g.id" size="small">
                      {{ g.modelName }} · {{ limitText(g) }}
                    </CaBadge>
                  </li>
                </ul>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </template>

    <CaDialog
      v-model:open="dialogOpen"
      :title="editingGrant ? t('models.grants.dialog.editTitle') : t('models.grants.dialog.title')"
      size="large"
    >
      <form class="grt-form" @submit.prevent="submit">
        <template v-if="!editingGrant">
          <CaField :label="t('models.grants.dialog.target')">
            <template #default>
              <CaSegmented
                v-model="form.targetType"
                :items="targetItems"
                :label="t('models.grants.dialog.target')"
                @update:model-value="form.targetId = ''"
              />
            </template>
          </CaField>
          <CaField
            v-if="form.targetType !== 'everyone'"
            :label="
              form.targetType === 'user'
                ? t('models.grants.dialog.person')
                : form.targetType === 'department'
                  ? t('models.grants.dialog.department')
                  : t('models.grants.dialog.agent')
            "
            required
          >
            <template #default="{ id }">
              <CaSelect :id="id" v-model="form.targetId" :options="targetOptions" placeholder="—" />
            </template>
          </CaField>
          <CaField :label="t('models.grants.dialog.models')" :hint="t('models.grants.dialog.defaultInfo')" required>
            <template #default>
              <p v-if="models.length === 0" class="grt-muted">{{ t('models.grants.dialog.noModels') }}</p>
              <div class="grt-models">
                <CaCheckbox
                  v-for="model in models"
                  :key="model.id"
                  :model-value="form.modelIds.includes(model.id)"
                  :label="`${model.displayName} (${model.provider})`"
                  @update:model-value="toggleModel(model.id, $event)"
                />
              </div>
            </template>
          </CaField>
        </template>
        <CaCheckbox
          v-if="form.targetType === 'department'"
          v-model="form.includeSubDepartments"
          :label="t('models.grants.subDepartments')"
        />
        <CaField :label="t('models.grants.dialog.limit')">
          <template #default="{ id }">
            <div class="grt-limit">
              <CaSwitch v-model="form.unlimited" :label="t('models.grants.dialog.unlimited')" />
              <CaInput v-if="!form.unlimited" :id="id" v-model="form.limit" inputmode="numeric" />
              <CaSegmented v-model="form.period" :items="periodItems" :label="t('models.grants.dialog.period')" />
            </div>
          </template>
        </CaField>
        <CaField :label="t('models.grants.dialog.note')">
          <template #default="{ id }"><CaInput :id="id" v-model="form.note" /></template>
        </CaField>
        <div class="grt-form__actions">
          <CaButton type="submit" variant="primary" :loading="saving" :disabled="!canSubmit">
            {{ t('models.grants.dialog.submit') }}
          </CaButton>
        </div>
      </form>
    </CaDialog>

    <CaDialog v-model:open="effectiveOpen" :title="t('models.grants.effectiveTitle', { name: effectiveName })">
      <CaSpinner v-if="!effectiveRows" />
      <ul v-else class="grt-effective">
        <li v-for="model in effectiveRows" :key="model.id">
          <strong>{{ model.displayName }}</strong>
          <CaBadge v-if="model.isDefault" variant="brand" size="small">{{ t('models.picker.defaultLimited') }}</CaBadge>
          <p v-if="model.quotas.length === 0" class="grt-muted">{{ t('models.grants.effectiveNoLimit') }}</p>
          <p v-for="quota in model.quotas" :key="quota.period" class="grt-muted">
            {{
              t('models.grants.effectiveUsage', {
                used: formatTokens(quota.used),
                limit: formatTokens(quota.limit),
                period: t(`models.grants.period.${quota.period}`),
              })
            }}
            · {{ quota.sourceLabel }}
          </p>
        </li>
      </ul>
    </CaDialog>
  </section>
</template>

<style scoped>
.grt-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-8);
}
.grt-banner {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  margin: 0 0 var(--ca-space-4);
  padding: var(--ca-space-3) var(--ca-space-4);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-color-brand-subtle);
  color: var(--ca-fg-1);
}
.grt-tabs {
  margin-bottom: var(--ca-space-4);
}
.grt-target {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ca-space-1);
}
.grt-muted {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
  margin: 0;
}
.grt-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--ca-space-1);
}
.grt-team {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}
.grt-dept__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
  align-items: center;
  margin-bottom: var(--ca-space-2);
}
.grt-people,
.grt-agents,
.grt-effective {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}
.grt-agents {
  padding-left: var(--ca-space-5);
  margin-top: var(--ca-space-1);
  font-size: var(--ca-text-200);
}
.grt-person {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--ca-fg-1);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-1);
}
.grt-person:hover {
  text-decoration: underline;
}
.grt-form {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}
.grt-form__actions {
  display: flex;
  justify-content: flex-end;
}
.grt-models {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--ca-space-2);
}
.grt-limit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-3);
}
</style>
