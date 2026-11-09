<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { PERMISSION_CATALOG } from '@bara/shared';
import {
  createNavApplication,
  createNavFeature,
  createNavMenuItem,
  createNavModule,
  deleteNavApplication,
  deleteNavFeature,
  deleteNavMenuItem,
  deleteNavModule,
  getAdminNavTree,
  updateNavApplication,
  updateNavFeature,
  updateNavMenuItem,
  updateNavModule,
  type AdminNavApplication,
  type AdminNavFeature,
  type AdminNavMenuItem,
  type AdminNavModule,
  type AdminNavTree,
} from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaCard,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaSelect,
  CaSpinner,
  CaSwitch,
  type CaSelectOption,
} from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canManage = computed(() => auth.can('nav.manage'));

const tree = ref<AdminNavTree | null>(null);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    tree.value = await getAdminNavTree();
  } catch {
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

function modulesOf(app: AdminNavApplication): AdminNavModule[] {
  return (tree.value?.modules ?? []).filter((m) => m.application_id === app.id);
}

function featuresOf(module: AdminNavModule): AdminNavFeature[] {
  return (tree.value?.features ?? []).filter((f) => f.module_id === module.id);
}

function moduleItemsOf(module: AdminNavModule): AdminNavMenuItem[] {
  return (tree.value?.menuItems ?? []).filter(
    (i) => i.module_id === module.id && i.parent_id === null,
  );
}

function featureItemsOf(module: AdminNavModule, feature: AdminNavFeature): AdminNavMenuItem[] {
  return (tree.value?.menuItems ?? []).filter(
    (i) => i.module_id === module.id && i.feature_id === feature.id && i.parent_id === null,
  );
}

function appItemsOf(app: AdminNavApplication): AdminNavMenuItem[] {
  return (tree.value?.menuItems ?? []).filter(
    (i) => i.application_id === app.id && i.module_id === null && i.parent_id === null,
  );
}

type DialogKind = 'application' | 'module' | 'feature' | 'menu';

const showForm = ref(false);
const dialogKind = ref<DialogKind>('application');
const editId = ref<string | null>(null);
const saving = ref(false);
const formError = ref('');

const context = ref<{ applicationId: string; moduleId: string | null; featureId: string | null }>({
  applicationId: '',
  moduleId: null,
  featureId: null,
});

const form = ref({
  identifier: '',
  name: '',
  description: '',
  icon: '',
  sortOrder: '0',
  isActive: true,
  key: '',
  labelDefault: '',
  i18nKey: '',
  routePath: '',
  requiredPermission: '',
  isFuture: false,
});

const permissionOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('admin.nav.formNone') },
  ...PERMISSION_CATALOG.map((p) => ({ value: p.id, label: `${p.name} — ${p.id}` })),
]);

function emptyForm() {
  return {
    identifier: '',
    name: '',
    description: '',
    icon: '',
    sortOrder: '0',
    isActive: true,
    key: '',
    labelDefault: '',
    i18nKey: '',
    routePath: '',
    requiredPermission: '',
    isFuture: false,
  };
}

function formTitle(): string {
  const map: Record<DialogKind, [string, string]> = {
    application: ['admin.nav.createApplication', 'admin.nav.editApplication'],
    module: ['admin.nav.createModule', 'admin.nav.editModule'],
    feature: ['admin.nav.createFeature', 'admin.nav.editFeature'],
    menu: ['admin.nav.createMenuItem', 'admin.nav.editMenuItem'],
  };
  const [createKey, editKey] = map[dialogKind.value];
  return editId.value ? t(editKey) : t(createKey);
}

function openCreate(kind: DialogKind, ctx: Partial<typeof context.value>) {
  dialogKind.value = kind;
  editId.value = null;
  context.value = { applicationId: '', moduleId: null, featureId: null, ...ctx };
  form.value = emptyForm();
  formError.value = '';
  showForm.value = true;
}

function openEditApplication(app: AdminNavApplication) {
  dialogKind.value = 'application';
  editId.value = app.id;
  context.value = { applicationId: app.id, moduleId: null, featureId: null };
  form.value = { ...emptyForm(), identifier: app.identifier, name: app.name, description: app.description ?? '', icon: app.icon ?? '', sortOrder: String(app.sort_order), isActive: app.is_active };
  formError.value = '';
  showForm.value = true;
}

function openEditModule(app: AdminNavApplication, mod: AdminNavModule) {
  dialogKind.value = 'module';
  editId.value = mod.id;
  context.value = { applicationId: app.id, moduleId: mod.id, featureId: null };
  form.value = { ...emptyForm(), identifier: mod.identifier, name: mod.name, description: mod.description ?? '', sortOrder: String(mod.sort_order), isActive: mod.is_active };
  formError.value = '';
  showForm.value = true;
}

function openEditFeature(mod: AdminNavModule, feature: AdminNavFeature) {
  dialogKind.value = 'feature';
  editId.value = feature.id;
  context.value = { applicationId: mod.application_id, moduleId: mod.id, featureId: feature.id };
  form.value = { ...emptyForm(), identifier: feature.identifier, name: feature.name, description: feature.description ?? '', sortOrder: String(feature.sort_order), isActive: feature.is_active };
  formError.value = '';
  showForm.value = true;
}

function openEditMenuItem(item: AdminNavMenuItem) {
  dialogKind.value = 'menu';
  editId.value = item.id;
  context.value = {
    applicationId: item.application_id,
    moduleId: item.module_id,
    featureId: item.feature_id,
  };
  form.value = {
    ...emptyForm(),
    key: item.key,
    labelDefault: item.label_default,
    i18nKey: item.i18n_key ?? '',
    icon: item.icon ?? '',
    routePath: item.route_path ?? '',
    requiredPermission: item.required_permission ?? '',
    sortOrder: String(item.sort_order),
    isActive: item.is_active,
    isFuture: item.is_future,
  };
  formError.value = '';
  showForm.value = true;
}

type DeleteTarget = { kind: DialogKind; id: string; label: string };

const deleting = ref<DeleteTarget | null>(null);
const showDelete = ref(false);

function openDelete(kind: DialogKind, id: string, label: string) {
  deleting.value = { kind, id, label };
  showDelete.value = true;
}

async function confirmDelete() {
  if (!deleting.value) return;
  saving.value = true;
  const { kind, id } = deleting.value;
  try {
    if (kind === 'application') await deleteNavApplication(id);
    else if (kind === 'module') await deleteNavModule(id);
    else if (kind === 'feature') await deleteNavFeature(id);
    else await deleteNavMenuItem(id);
    toast.push({ variant: 'success', title: t('admin.nav.deleted') });
    showDelete.value = false;
    await load();
  } catch {
    toast.push({ variant: 'danger', title: t('errors.saveFailed') });
  } finally {
    saving.value = false;
  }
}

async function submit() {
  formError.value = '';
  const f = form.value;
  saving.value = true;
  try {
    if (dialogKind.value === 'menu') {
      if (!f.key.trim() || !f.labelDefault.trim()) {
        formError.value = t('errors.requiredFields');
        saving.value = false;
        return;
      }
      const payload = {
        key: f.key.trim(),
        applicationId: context.value.applicationId,
        moduleId: context.value.moduleId,
        featureId: context.value.featureId,
        labelDefault: f.labelDefault.trim(),
        i18nKey: f.i18nKey.trim() || undefined,
        icon: f.icon.trim() || undefined,
        routePath: f.routePath.trim() || undefined,
        requiredPermission: f.requiredPermission || null,
        sortOrder: Number(f.sortOrder) || 0,
        isActive: f.isActive,
        isFuture: f.isFuture,
      };
      if (editId.value) await updateNavMenuItem(editId.value, payload);
      else await createNavMenuItem(payload);
    } else {
      if (!f.identifier.trim() || !f.name.trim()) {
        formError.value = t('errors.requiredFields');
        saving.value = false;
        return;
      }
      const base = {
        identifier: f.identifier.trim(),
        name: f.name.trim(),
        description: f.description.trim() || undefined,
        sortOrder: Number(f.sortOrder) || 0,
        isActive: f.isActive,
      };
      if (dialogKind.value === 'application') {
        const payload = { ...base, icon: f.icon.trim() || undefined };
        if (editId.value) await updateNavApplication(editId.value, payload);
        else await createNavApplication(payload);
      } else if (dialogKind.value === 'module') {
        const payload = { ...base, applicationId: context.value.applicationId };
        if (editId.value) await updateNavModule(editId.value, payload);
        else await createNavModule(payload);
      } else {
        const payload = { ...base, moduleId: context.value.moduleId ?? '' };
        if (editId.value) await updateNavFeature(editId.value, payload);
        else await createNavFeature(payload);
      }
    }
    toast.push({ variant: 'success', title: editId.value ? t('admin.nav.updated') : t('admin.nav.created') });
    showForm.value = false;
    await load();
  } catch {
    formError.value = t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

const contextLabel = computed(() => {
  const parts: string[] = [];
  const app = tree.value?.applications.find((a) => a.id === context.value.applicationId);
  if (app) parts.push(app.name);
  if (context.value.moduleId) {
    const mod = tree.value?.modules.find((m) => m.id === context.value.moduleId);
    if (mod) parts.push(mod.name);
  }
  if (context.value.featureId) {
    const feature = tree.value?.features.find((f) => f.id === context.value.featureId);
    if (feature) parts.push(feature.name);
  }
  return parts.join(' / ');
});

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.nav.title')"
      :description="t('admin.nav.description')"
    >
      <template #actions>
        <CaButton v-if="canManage" variant="primary" @click="openCreate('application', {})">
          {{ t('admin.nav.addApplication') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <p v-if="error" class="admin-error">{{ error }}</p>
    <div v-if="loading" class="nav-loading"><CaSpinner size="large" /></div>
    <p v-else-if="tree && tree.applications.length === 0" class="nav-empty">
      {{ t('admin.nav.empty') }}
    </p>

    <template v-else-if="tree">
      <CaCard v-for="app in tree.applications" :key="app.id" class="nav-app">
        <div class="nav-head">
          <div class="nav-head__title">
            <h2 class="nav-head__name">{{ app.name }}</h2>
            <span class="admin-mono nav-head__id">{{ app.identifier }}</span>
            <CaBadge v-if="!app.is_active" variant="neutral">
              {{ t('admin.nav.inactiveBadge') }}
            </CaBadge>
          </div>
          <div v-if="canManage" class="nav-actions">
            <CaButton size="small" variant="subtle" @click="openCreate('module', { applicationId: app.id })">
              {{ t('admin.nav.addModule') }}
            </CaButton>
            <CaButton size="small" variant="subtle" @click="openCreate('menu', { applicationId: app.id })">
              {{ t('admin.nav.addMenuItem') }}
            </CaButton>
            <CaButton size="small" variant="subtle" @click="openEditApplication(app)">
              {{ t('admin.nav.editAction') }}
            </CaButton>
            <CaButton size="small" variant="subtle" @click="openDelete('application', app.id, app.name)">
              {{ t('admin.nav.deleteAction') }}
            </CaButton>
          </div>
        </div>

        <ul v-if="appItemsOf(app).length > 0" class="nav-items">
          <li v-for="item in appItemsOf(app)" :key="item.id" class="nav-item">
            <div class="nav-item__main">
              <span class="nav-item__label">{{ item.label_default }}</span>
              <span class="admin-mono nav-item__route">{{ item.route_path ?? '—' }}</span>
            </div>
            <CaBadge v-if="item.is_future" variant="informative">
              {{ t('admin.nav.futureBadge') }}
            </CaBadge>
            <CaBadge v-if="!item.is_active" variant="neutral">
              {{ t('admin.nav.inactiveBadge') }}
            </CaBadge>
            <span v-if="item.required_permission" class="admin-mono nav-item__perm">
              {{ item.required_permission }}
            </span>
            <div v-if="canManage" class="nav-actions">
              <CaButton size="small" variant="subtle" @click="openEditMenuItem(item)">
                {{ t('admin.nav.editAction') }}
              </CaButton>
              <CaButton size="small" variant="subtle" @click="openDelete('menu', item.id, item.label_default)">
                {{ t('admin.nav.deleteAction') }}
              </CaButton>
            </div>
          </li>
        </ul>

        <div v-for="mod in modulesOf(app)" :key="mod.id" class="nav-module">
          <div class="nav-head nav-head--module">
            <div class="nav-head__title">
              <h3 class="nav-head__name">{{ mod.name }}</h3>
              <span class="admin-mono nav-head__id">{{ mod.identifier }}</span>
              <CaBadge v-if="!mod.is_active" variant="neutral">
                {{ t('admin.nav.inactiveBadge') }}
              </CaBadge>
            </div>
            <div v-if="canManage" class="nav-actions">
              <CaButton size="small" variant="subtle" @click="openCreate('feature', { applicationId: app.id, moduleId: mod.id })">
                {{ t('admin.nav.addFeature') }}
              </CaButton>
              <CaButton size="small" variant="subtle" @click="openCreate('menu', { applicationId: app.id, moduleId: mod.id })">
                {{ t('admin.nav.addMenuItem') }}
              </CaButton>
              <CaButton size="small" variant="subtle" @click="openEditModule(app, mod)">
                {{ t('admin.nav.editAction') }}
              </CaButton>
              <CaButton size="small" variant="subtle" @click="openDelete('module', mod.id, mod.name)">
                {{ t('admin.nav.deleteAction') }}
              </CaButton>
            </div>
          </div>

          <div v-for="feature in featuresOf(mod)" :key="feature.id" class="nav-feature">
            <div class="nav-head nav-head--feature">
              <div class="nav-head__title">
                <span class="nav-feature__name">{{ feature.name }}</span>
                <span class="admin-mono nav-head__id">{{ feature.identifier }}</span>
                <CaBadge v-if="!feature.is_active" variant="neutral">
                  {{ t('admin.nav.inactiveBadge') }}
                </CaBadge>
              </div>
              <div v-if="canManage" class="nav-actions">
                <CaButton size="small" variant="subtle" @click="openCreate('menu', { applicationId: app.id, moduleId: mod.id, featureId: feature.id })">
                  {{ t('admin.nav.addMenuItem') }}
                </CaButton>
                <CaButton size="small" variant="subtle" @click="openEditFeature(mod, feature)">
                  {{ t('admin.nav.editAction') }}
                </CaButton>
                <CaButton size="small" variant="subtle" @click="openDelete('feature', feature.id, feature.name)">
                  {{ t('admin.nav.deleteAction') }}
                </CaButton>
              </div>
            </div>
            <ul v-if="featureItemsOf(mod, feature).length > 0" class="nav-items">
              <li v-for="item in featureItemsOf(mod, feature)" :key="item.id" class="nav-item">
                <div class="nav-item__main">
                  <span class="nav-item__label">{{ item.label_default }}</span>
                  <span class="admin-mono nav-item__route">{{ item.route_path ?? '—' }}</span>
                </div>
                <CaBadge v-if="item.is_future" variant="informative">
                  {{ t('admin.nav.futureBadge') }}
                </CaBadge>
                <CaBadge v-if="!item.is_active" variant="neutral">
                  {{ t('admin.nav.inactiveBadge') }}
                </CaBadge>
                <span v-if="item.required_permission" class="admin-mono nav-item__perm">
                  {{ item.required_permission }}
                </span>
                <div v-if="canManage" class="nav-actions">
                  <CaButton size="small" variant="subtle" @click="openEditMenuItem(item)">
                    {{ t('admin.nav.editAction') }}
                  </CaButton>
                  <CaButton size="small" variant="subtle" @click="openDelete('menu', item.id, item.label_default)">
                    {{ t('admin.nav.deleteAction') }}
                  </CaButton>
                </div>
              </li>
            </ul>
          </div>

          <ul v-if="moduleItemsOf(mod).length > 0" class="nav-items">
            <li v-for="item in moduleItemsOf(mod)" :key="item.id" class="nav-item">
              <div class="nav-item__main">
                <span class="nav-item__label">{{ item.label_default }}</span>
                <span class="admin-mono nav-item__route">{{ item.route_path ?? '—' }}</span>
              </div>
              <CaBadge v-if="item.is_future" variant="informative">
                {{ t('admin.nav.futureBadge') }}
              </CaBadge>
              <CaBadge v-if="!item.is_active" variant="neutral">
                {{ t('admin.nav.inactiveBadge') }}
              </CaBadge>
              <span v-if="item.required_permission" class="admin-mono nav-item__perm">
                {{ item.required_permission }}
              </span>
              <div v-if="canManage" class="nav-actions">
                <CaButton size="small" variant="subtle" @click="openEditMenuItem(item)">
                  {{ t('admin.nav.editAction') }}
                </CaButton>
                <CaButton size="small" variant="subtle" @click="openDelete('menu', item.id, item.label_default)">
                  {{ t('admin.nav.deleteAction') }}
                </CaButton>
              </div>
            </li>
          </ul>
        </div>
      </CaCard>
    </template>

    <CaDialog v-model:open="showForm" :title="formTitle()" :subtitle="dialogKind !== 'application' ? contextLabel : undefined" size="medium">
      <div v-if="dialogKind === 'menu'" class="admin-form">
        <div class="admin-form__row">
          <CaField :label="t('admin.nav.formKey')" :hint="t('admin.nav.formKeyHint')">
            <CaInput v-model="form.key" />
          </CaField>
          <CaField :label="t('admin.nav.formLabel')">
            <CaInput v-model="form.labelDefault" />
          </CaField>
        </div>
        <div class="admin-form__row">
          <CaField :label="t('admin.nav.formRoute')" :hint="t('admin.nav.formRouteHint')">
            <CaInput v-model="form.routePath" />
          </CaField>
          <CaField :label="t('admin.nav.formI18nKey')">
            <CaInput v-model="form.i18nKey" />
          </CaField>
        </div>
        <CaField :label="t('admin.nav.formPermission')">
          <CaSelect
            v-model="form.requiredPermission"
            :options="permissionOptions"
            :placeholder="t('admin.nav.formPermissionPlaceholder')"
          />
        </CaField>
        <div class="admin-form__row">
          <CaField :label="t('admin.nav.formSortOrder')">
            <CaInput v-model="form.sortOrder" />
          </CaField>
          <div class="nav-switches">
            <CaSwitch v-model="form.isActive" :label="t('admin.nav.formActive')" />
            <CaSwitch v-model="form.isFuture" :label="t('admin.nav.formFuture')" />
          </div>
        </div>
        <p v-if="formError" class="admin-error">{{ formError }}</p>
      </div>

      <div v-else class="admin-form">
        <div class="admin-form__row">
          <CaField :label="t('admin.nav.formIdentifier')" :hint="editId ? undefined : t('admin.nav.formIdentifierHint')">
            <CaInput v-model="form.identifier" :disabled="editId !== null" />
          </CaField>
          <CaField :label="t('admin.nav.formName')">
            <CaInput v-model="form.name" />
          </CaField>
        </div>
        <CaField :label="t('admin.nav.formDescription')">
          <CaInput v-model="form.description" />
        </CaField>
        <div class="admin-form__row">
          <CaField v-if="dialogKind === 'application'" :label="t('admin.nav.formIcon')">
            <CaInput v-model="form.icon" />
          </CaField>
          <CaField :label="t('admin.nav.formSortOrder')">
            <CaInput v-model="form.sortOrder" />
          </CaField>
          <div class="nav-switches">
            <CaSwitch v-model="form.isActive" :label="t('admin.nav.formActive')" />
          </div>
        </div>
        <p v-if="formError" class="admin-error">{{ formError }}</p>
      </div>

      <template #footer>
        <CaButton variant="subtle" @click="showForm = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="primary" :disabled="saving" @click="submit">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog v-model:open="showDelete" :title="t('admin.nav.deleteTitle')" size="small">
      <p class="nav-delete-text">
        {{ t('admin.nav.deleteConfirm', { name: deleting?.label ?? '' }) }}
      </p>
      <template #footer>
        <CaButton variant="subtle" @click="showDelete = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="danger" :disabled="saving" @click="confirmDelete">
          {{ t('admin.nav.deleteAction') }}
        </CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.nav-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-24) 0;
}

.nav-empty {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.nav-app {
  margin-bottom: var(--ca-space-12);
}

.nav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-8);
  flex-wrap: wrap;
}

.nav-head__title {
  display: flex;
  align-items: baseline;
  gap: var(--ca-space-6);
  flex-wrap: wrap;
}

.nav-head__name {
  margin: 0;
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.nav-head__id {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.nav-actions {
  display: flex;
  gap: var(--ca-space-2);
  flex-wrap: wrap;
}

.nav-module {
  margin-top: var(--ca-space-8);
  padding-left: var(--ca-space-8);
  border-left: 2px solid var(--ca-stroke-2);
}

.nav-head--module .nav-head__name {
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-medium);
}

.nav-feature {
  margin-top: var(--ca-space-6);
  padding-left: var(--ca-space-8);
}

.nav-head--feature {
  padding: var(--ca-space-4) 0;
}

.nav-feature__name {
  font-size: var(--ca-text-200);
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.nav-items {
  list-style: none;
  margin: var(--ca-space-4) 0 0;
  padding: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--ca-space-6);
  padding: var(--ca-space-4) var(--ca-space-6);
  border-radius: var(--ca-radius-md);
}

.nav-item:hover {
  background: var(--ca-bg-surface-hover);
}

.nav-item__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.nav-item__label {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-1);
}

.nav-item__route {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.nav-item__perm {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
  white-space: nowrap;
}

.nav-switches {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  padding-top: var(--ca-space-6);
}

.nav-delete-text {
  margin: 0;
  color: var(--ca-fg-2);
}
</style>
