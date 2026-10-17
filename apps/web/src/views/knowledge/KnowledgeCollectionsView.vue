<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  createCollection,
  collectionDetail,
  deleteCollection,
  listCollections,
  listSources,
  setCollectionSources,
  updateCollection,
  type KnowledgeCollectionRow,
  type KnowledgeSourceRow,
} from '@/api/knowledge';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaCard,
  CaCheckbox,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaTextarea,
} from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canManage = computed(() => auth.can('knowledge.collections.manage'));

const collections = ref<KnowledgeCollectionRow[]>([]);
const sources = ref<KnowledgeSourceRow[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [colResult, srcResult] = await Promise.all([
      listCollections({ page: 1, pageSize: 100 }),
      listSources({ page: 1, pageSize: 100 }),
    ]);
    collections.value = colResult.items;
    sources.value = srcResult.items;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

// --- Dialog buat koleksi ---
const createOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const form = ref({ code: '', name: '', description: '' });

function openCreate(): void {
  form.value = { code: '', name: '', description: '' };
  formError.value = '';
  createOpen.value = true;
}

async function submitCreate(): Promise<void> {
  formError.value = '';
  if (form.value.code.trim().length < 3 || form.value.name.trim().length < 3) {
    formError.value = t('errors.requiredFields');
    return;
  }
  saving.value = true;
  try {
    await createCollection({
      code: form.value.code.trim(),
      name: form.value.name.trim(),
      description: form.value.description.trim() || undefined,
    });
    toast.push({ variant: 'success', title: t('knowledge.collectionCreated') });
    createOpen.value = false;
    await load();
  } catch (caught) {
    formError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

// --- Dialog ubah koleksi ---
const editOpen = ref(false);
const editSaving = ref(false);
const editError = ref('');
const editTarget = ref<KnowledgeCollectionRow | null>(null);
const editForm = ref({ name: '', description: '' });

function openEdit(row: KnowledgeCollectionRow): void {
  editTarget.value = row;
  editForm.value = { name: row.name, description: row.description ?? '' };
  editError.value = '';
  editOpen.value = true;
}

async function submitEdit(): Promise<void> {
  if (!editTarget.value) return;
  editError.value = '';
  if (editForm.value.name.trim().length < 3) {
    editError.value = t('errors.requiredFields');
    return;
  }
  editSaving.value = true;
  try {
    await updateCollection(editTarget.value.id, {
      name: editForm.value.name.trim(),
      description: editForm.value.description.trim() || undefined,
    });
    toast.push({ variant: 'success', title: t('knowledge.collectionUpdated') });
    editOpen.value = false;
    await load();
  } catch (caught) {
    editError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    editSaving.value = false;
  }
}

// --- Dialog atur sumber koleksi ---
const sourcesOpen = ref(false);
const sourcesSaving = ref(false);
const sourcesTarget = ref<KnowledgeCollectionRow | null>(null);
const selectedSourceIds = ref<Set<string>>(new Set());

function toggleSource(id: string, checked: boolean): void {
  const next = new Set(selectedSourceIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  selectedSourceIds.value = next;
}

async function openSources(row: KnowledgeCollectionRow): Promise<void> {
  sourcesTarget.value = row;
  try {
    const detail = await collectionDetail(row.id);
    selectedSourceIds.value = new Set(detail.source_ids);
    sourcesOpen.value = true;
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.loadFailed'),
    });
  }
}

async function submitSources(): Promise<void> {
  if (!sourcesTarget.value) return;
  sourcesSaving.value = true;
  try {
    await setCollectionSources(sourcesTarget.value.id, [...selectedSourceIds.value]);
    toast.push({ variant: 'success', title: t('knowledge.collectionSourcesUpdated') });
    sourcesOpen.value = false;
    await load();
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  } finally {
    sourcesSaving.value = false;
  }
}

async function removeCollection(row: KnowledgeCollectionRow): Promise<void> {
  try {
    await deleteCollection(row.id);
    toast.push({ variant: 'success', title: t('knowledge.collectionDeleted') });
    await load();
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}
</script>

<template>
  <div>
    <CaPageHeader
      :title="t('knowledge.collectionsTitle')"
      :description="t('knowledge.collectionsDescription')"
    >
      <template #actions>
        <CaButton v-if="canManage" variant="primary" @click="openCreate">
          {{ t('knowledge.addCollection') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <p v-if="!loading && collections.length === 0 && !error" class="kcol-empty">
      {{ t('knowledge.collectionsEmpty') }}
    </p>

    <div class="kcol-grid">
      <CaCard v-for="col in collections" :key="col.id">
        <div class="kcol-card">
          <div class="kcol-card__head">
            <h2 class="kcol-card__name">{{ col.name }}</h2>
            <CaBadge variant="brand" size="small">{{ col.code }}</CaBadge>
          </div>
          <p v-if="col.description" class="kcol-card__desc">{{ col.description }}</p>
          <p class="kcol-card__meta">
            {{ t('knowledge.sourceCount', { count: col.source_count ?? 0 }) }}
          </p>
          <div v-if="canManage" class="kcol-card__actions">
            <CaButton size="small" variant="secondary" @click="openSources(col)">
              {{ t('knowledge.manageSourcesAction') }}
            </CaButton>
            <CaButton size="small" variant="secondary" @click="openEdit(col)">
              {{ t('common.edit') }}
            </CaButton>
            <CaButton size="small" variant="danger" @click="removeCollection(col)">
              {{ t('common.delete') }}
            </CaButton>
          </div>
        </div>
      </CaCard>
    </div>

    <CaDialog
      v-model:open="createOpen"
      :title="t('knowledge.createCollectionTitle')"
      :subtitle="t('knowledge.createCollectionSubtitle')"
    >
      <p v-if="formError" class="admin-error" role="alert">{{ formError }}</p>
      <form class="admin-form" @submit.prevent="submitCreate">
        <CaField :label="t('knowledge.formCollectionCode')" :hint="t('knowledge.formSourceCodeHint')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="form.code" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('knowledge.formCollectionName')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="form.name" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('knowledge.formSourceDescription')">
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="form.description" :aria-describedby="describedBy" :rows="3" />
          </template>
        </CaField>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="createOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="saving" @click="submitCreate">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="editOpen"
      :title="t('knowledge.editCollectionTitle')"
      :subtitle="editTarget?.name ?? ''"
    >
      <p v-if="editError" class="admin-error" role="alert">{{ editError }}</p>
      <form class="admin-form" @submit.prevent="submitEdit">
        <CaField :label="t('knowledge.formCollectionName')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="editForm.name" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('knowledge.formSourceDescription')">
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="editForm.description" :aria-describedby="describedBy" :rows="3" />
          </template>
        </CaField>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="editOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="editSaving" @click="submitEdit">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="sourcesOpen"
      :title="t('knowledge.collectionSourcesTitle')"
      :subtitle="sourcesTarget?.name ?? ''"
    >
      <p class="kcol-sources-hint">{{ t('knowledge.collectionSourcesHint') }}</p>
      <div v-if="sources.length === 0" class="kcol-sources-empty">
        {{ t('knowledge.noSources') }}
      </div>
      <ul v-else class="kcol-sources-list">
        <li v-for="src in sources" :key="src.id">
          <CaCheckbox
            :model-value="selectedSourceIds.has(src.id)"
            @update:model-value="(v: boolean) => toggleSource(src.id, v)"
          >
            {{ src.name }}
            <span class="kcol-sources-code">{{ src.code }}</span>
          </CaCheckbox>
        </li>
      </ul>
      <template #footer>
        <CaButton variant="secondary" @click="sourcesOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="sourcesSaving" @click="submitSources">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>
  </div>
</template>

<style scoped>
.kcol-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--ca-space-6);
}

.kcol-card {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.kcol-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
}

.kcol-card__name {
  margin: 0;
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.kcol-card__desc {
  margin: 0;
  font-size: var(--ca-text-300);
  color: var(--ca-fg-2);
}

.kcol-card__meta {
  margin: 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.kcol-card__actions {
  display: flex;
  gap: var(--ca-space-3);
  flex-wrap: wrap;
}

.kcol-empty {
  margin: 0 0 var(--ca-space-6);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-300);
}

.kcol-sources-hint {
  margin: 0 0 var(--ca-space-4);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.kcol-sources-empty {
  color: var(--ca-fg-3);
  font-size: var(--ca-text-300);
}

.kcol-sources-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  max-height: 320px;
  overflow-y: auto;
}

.kcol-sources-code {
  margin-left: var(--ca-space-2);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  font-family: var(--ca-font-family-monospace, monospace);
}
</style>
