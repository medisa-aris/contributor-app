<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  createDocument,
  createSource,
  deleteDocument,
  listDocuments,
  listSources,
  type KnowledgeDocumentRow,
  type KnowledgeSourceRow,
} from '@/api/knowledge';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { usePagedList } from '@/composables/usePagedList';
import { formatDateTime } from '@/utils/format';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaPagination,
  CaSelect,
  CaTable,
  CaTextarea,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canManage = computed(() => auth.can('knowledge.collections.manage'));
const canSearch = computed(() => auth.can('knowledge.search.use'));

const { items, total, page, pageSize, loading, error, load, setFilter, goPage } =
  usePagedList<KnowledgeDocumentRow>(listDocuments, { pageSize: 25 });

const search = ref('');
const sourceFilter = ref('');
const statusFilter = ref('');

const statusOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('common.all') },
  { value: 'indexed', label: t('knowledge.statusIndexed') },
  { value: 'pending', label: t('knowledge.statusPending') },
  { value: 'failed', label: t('knowledge.statusFailed') },
]);

const sources = ref<KnowledgeSourceRow[]>([]);
const sourceOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('common.all') },
  ...sources.value.map((s) => ({ value: s.id, label: s.name })),
]);

const columns = computed<CaTableColumn[]>(() => {
  const cols: CaTableColumn[] = [
    { key: 'title', label: t('knowledge.columnTitle'), sortValue: (row) => row.title },
    { key: 'source', label: t('knowledge.columnSource') },
    { key: 'status', label: t('knowledge.columnStatus') },
    { key: 'updated', label: t('knowledge.columnUpdated'), sortValue: (row) => row.updated_at },
  ];
  if (canManage.value) cols.push({ key: 'actions', label: t('table.actions'), sortable: false });
  return cols;
});

const stats = computed(() => {
  let indexed = 0;
  let pending = 0;
  let failed = 0;
  for (const doc of items.value) {
    if (doc.status === 'indexed') indexed += 1;
    else if (doc.status === 'pending') pending += 1;
    else if (doc.status === 'failed') failed += 1;
  }
  return { indexed, pending, failed };
});

function applyFilters(): void {
  setFilter({
    search: search.value.trim() || undefined,
    sourceId: sourceFilter.value || undefined,
    status: statusFilter.value || undefined,
  });
}

async function loadSources(): Promise<void> {
  try {
    const result = await listSources({ page: 1, pageSize: 100 });
    sources.value = result.items;
  } catch {
    sources.value = [];
  }
}

onMounted(() => {
  void load();
  void loadSources();
});

// --- Dialog unggah dokumen ---
const uploadOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const form = ref({ title: '', content: '', sourceId: '' });

const uploadSourceOptions = computed<CaSelectOption[]>(
  () => sources.value.map((s) => ({ value: s.id, label: s.name })),
);

function openUpload(): void {
  form.value = { title: '', content: '', sourceId: sources.value[0]?.id ?? '' };
  formError.value = '';
  uploadOpen.value = true;
}

async function submitUpload(): Promise<void> {
  formError.value = '';
  if (form.value.title.trim().length < 3 || form.value.content.trim().length < 10) {
    formError.value = t('errors.requiredFields');
    return;
  }
  if (!form.value.sourceId) {
    formError.value = t('knowledge.sourceRequired');
    return;
  }
  saving.value = true;
  try {
    await createDocument({
      sourceId: form.value.sourceId,
      title: form.value.title.trim(),
      content: form.value.content,
    });
    toast.push({ variant: 'success', title: t('knowledge.documentCreated') });
    uploadOpen.value = false;
    await load();
  } catch (caught) {
    formError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function removeDocument(row: KnowledgeDocumentRow): Promise<void> {
  try {
    await deleteDocument(row.id);
    toast.push({ variant: 'success', title: t('knowledge.documentDeleted') });
    await load();
  } catch (caught) {
    toast.push({
      variant: 'danger',
      title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
    });
  }
}

// --- Dialog kelola sumber ---
const sourceOpen = ref(false);
const sourceSaving = ref(false);
const sourceFormError = ref('');
const sourceForm = ref({ code: '', name: '', description: '' });

function openSourceDialog(): void {
  sourceForm.value = { code: '', name: '', description: '' };
  sourceFormError.value = '';
  sourceOpen.value = true;
}

async function submitSource(): Promise<void> {
  sourceFormError.value = '';
  if (sourceForm.value.code.trim().length < 3 || sourceForm.value.name.trim().length < 3) {
    sourceFormError.value = t('errors.requiredFields');
    return;
  }
  sourceSaving.value = true;
  try {
    await createSource({
      code: sourceForm.value.code.trim(),
      name: sourceForm.value.name.trim(),
      description: sourceForm.value.description.trim() || undefined,
      origin: 'manual',
    });
    toast.push({ variant: 'success', title: t('knowledge.sourceCreated') });
    sourceOpen.value = false;
    await loadSources();
  } catch (caught) {
    sourceFormError.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    sourceSaving.value = false;
  }
}

function statusVariant(row: KnowledgeDocumentRow): 'success' | 'warning' | 'danger' {
  if (row.status === 'indexed') return 'success';
  if (row.status === 'pending') return 'warning';
  return 'danger';
}

function statusLabel(row: KnowledgeDocumentRow): string {
  if (row.status === 'indexed') return t('knowledge.statusIndexed');
  if (row.status === 'pending') return t('knowledge.statusPending');
  return t('knowledge.statusFailed');
}
</script>

<template>
  <div>
    <CaPageHeader
      :title="t('knowledge.documentsTitle')"
      :description="t('knowledge.documentsDescription')"
    >
      <template #actions>
        <CaButton v-if="canSearch" variant="secondary" to="/knowledge/search">
          {{ t('knowledge.goSearch') }}
        </CaButton>
        <CaButton v-if="canManage" variant="secondary" @click="openSourceDialog">
          {{ t('knowledge.manageSources') }}
        </CaButton>
        <CaButton v-if="canManage" variant="primary" @click="openUpload">
          {{ t('knowledge.uploadButton') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <div class="kdoc-stats">
      <div class="kdoc-stat">
        <span class="kdoc-stat__value">{{ stats.indexed }}</span>
        <span class="kdoc-stat__label">{{ t('knowledge.statusIndexed') }}</span>
      </div>
      <div class="kdoc-stat">
        <span class="kdoc-stat__value">{{ stats.pending }}</span>
        <span class="kdoc-stat__label">{{ t('knowledge.statusPending') }}</span>
      </div>
      <div class="kdoc-stat">
        <span class="kdoc-stat__value">{{ stats.failed }}</span>
        <span class="kdoc-stat__label">{{ t('knowledge.statusFailed') }}</span>
      </div>
      <div class="kdoc-stat">
        <span class="kdoc-stat__value">{{ total }}</span>
        <span class="kdoc-stat__label">{{ t('knowledge.totalDocuments') }}</span>
      </div>
    </div>

    <div class="admin-filters">
      <CaInput
        v-model="search"
        class="admin-filters__wide"
        :placeholder="t('knowledge.searchPlaceholder')"
        :aria-label="t('common.search')"
        @keyup.enter="applyFilters"
      />
      <CaSelect
        v-model="sourceFilter"
        class="admin-filters__field"
        :options="sourceOptions"
        :aria-label="t('knowledge.filterSource')"
        @update:model-value="applyFilters"
      />
      <CaSelect
        v-model="statusFilter"
        class="admin-filters__field"
        :options="statusOptions"
        :aria-label="t('knowledge.filterStatus')"
        @update:model-value="applyFilters"
      />
      <CaButton variant="secondary" @click="applyFilters">{{ t('common.search') }}</CaButton>
    </div>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

    <CaTable
      table-key="knowledge-documents"
      :columns="columns"
      :rows="items"
      :row-key="(row) => row.id"
      :loading="loading"
      :empty-title="t('table.empty')"
    >
      <template #cell-title="{ row }">
        <div class="kdoc-title">{{ row.title }}</div>
      </template>
      <template #cell-source="{ row }">
        {{ row.source_name ?? '—' }}
      </template>
      <template #cell-status="{ row }">
        <CaBadge :variant="statusVariant(row)" size="small">{{ statusLabel(row) }}</CaBadge>
      </template>
      <template #cell-updated="{ row }">
        {{ formatDateTime(row.updated_at) }}
      </template>
      <template #cell-actions="{ row }">
        <CaButton
          size="small"
          variant="danger"
          @click="removeDocument(row as KnowledgeDocumentRow)"
        >
          {{ t('common.delete') }}
        </CaButton>
      </template>
    </CaTable>

    <CaPagination :page="page" :limit="pageSize" :total="total" @change="goPage" />

    <CaDialog
      v-model:open="uploadOpen"
      :title="t('knowledge.uploadTitle')"
      :subtitle="t('knowledge.uploadSubtitle')"
    >
      <p v-if="formError" class="admin-error" role="alert">{{ formError }}</p>
      <form class="admin-form" @submit.prevent="submitUpload">
        <CaField :label="t('knowledge.formSource')" required>
          <template #default="{ id, describedBy }">
            <CaSelect :id="id" v-model="form.sourceId" :aria-describedby="describedBy" :options="uploadSourceOptions" />
          </template>
        </CaField>
        <CaField :label="t('knowledge.formTitle')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="form.title" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('knowledge.formContent')" :hint="t('knowledge.formContentHint')" required>
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="form.content" :aria-describedby="describedBy" :rows="10" />
          </template>
        </CaField>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="uploadOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="saving" @click="submitUpload">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>

    <CaDialog
      v-model:open="sourceOpen"
      :title="t('knowledge.sourceTitle')"
      :subtitle="t('knowledge.sourceSubtitle')"
    >
      <p v-if="sourceFormError" class="admin-error" role="alert">{{ sourceFormError }}</p>
      <form class="admin-form" @submit.prevent="submitSource">
        <CaField :label="t('knowledge.formSourceCode')" :hint="t('knowledge.formSourceCodeHint')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="sourceForm.code" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('knowledge.formSourceName')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="sourceForm.name" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('knowledge.formSourceDescription')">
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="sourceForm.description" :aria-describedby="describedBy" :rows="3" />
          </template>
        </CaField>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="sourceOpen = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="sourceSaving" @click="submitSource">
          {{ t('common.save') }}
        </CaButton>
      </template>
    </CaDialog>
  </div>
</template>

<style scoped>
.kdoc-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--ca-space-6);
  margin-bottom: var(--ca-space-8);
}

.kdoc-stat {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
  padding: var(--ca-space-5) var(--ca-space-6);
  border: 1px solid var(--ca-border-1);
  border-radius: var(--ca-radius-3);
  background: var(--ca-bg-2);
}

.kdoc-stat__value {
  font-size: var(--ca-text-700);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
  line-height: 1.1;
}

.kdoc-stat__label {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.kdoc-title {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

@media (max-width: 900px) {
  .kdoc-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
