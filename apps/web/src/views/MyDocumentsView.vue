<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  deleteUserDocument,
  downloadUserDocument,
  formatBytes,
  formatLabel,
  listUserDocuments,
  type UserDocument,
} from '@/api/documents';
import { ApiError } from '@/api/http';
import DocumentViewerPanel from '@/components/ai/DocumentViewerPanel.vue';
import {
  CaBadge,
  CaButton,
  CaInput,
  CaPageHeader,
  CaPagination,
  CaRowMenu,
  CaTable,
  type CaTableColumn,
} from '@/components/ui';
import { usePagedList } from '@/composables/usePagedList';
import { useToastStore } from '@/stores/toast.store';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();
const toast = useToastStore();

const { items, total, page, pageSize, loading, error, load, setFilter, goPage } =
  usePagedList<UserDocument>(listUserDocuments, { pageSize: 25 });

const search = ref('');
const selected = ref<UserDocument | null>(null);

const columns = computed<CaTableColumn[]>(() => [
  { key: 'title', label: t('workspace.documents.columns.title'), sortValue: (row) => row.title },
  { key: 'format', label: t('workspace.documents.columns.format') },
  { key: 'size', label: t('workspace.documents.columns.size'), sortValue: (row) => row.size_bytes },
  {
    key: 'created',
    label: t('workspace.documents.columns.created'),
    sortValue: (row) => row.created_at,
  },
  { key: 'actions', label: t('table.actions'), sortable: false },
]);

function onDocumentUpdated(doc: UserDocument): void {
  selected.value = doc;
  const index = items.value.findIndex((d) => d.id === doc.id);
  if (index >= 0) items.value.splice(index, 1, doc);
}

function applyFilters(): void {
  setFilter({ search: search.value.trim() || undefined });
}

async function download(doc: UserDocument): Promise<void> {
  try {
    await downloadUserDocument(doc);
  } catch {
    toast.push({ variant: 'danger', title: t('workspace.documents.viewer.downloadFailed') }, 5000);
  }
}

async function remove(doc: UserDocument): Promise<void> {
  if (!window.confirm(t('workspace.documents.confirmDelete', { name: doc.title }))) return;
  try {
    await deleteUserDocument(doc.id);
    if (selected.value?.id === doc.id) selected.value = null;
    toast.push({ variant: 'success', title: t('workspace.documents.deleted') }, 3000);
    await load();
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
      },
      5000,
    );
  }
}

onMounted(() => void load());
</script>

<template>
  <div>
    <CaPageHeader
      :title="t('workspace.documents.title')"
      :description="t('workspace.documents.description')"
    />

    <div class="mydocs" :class="{ 'mydocs--viewer': selected }">
      <section class="mydocs__list">
        <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

        <section class="ca-panel">
          <CaTable
            table-key="my-documents"
            :columns="columns"
            :rows="items"
            :row-key="(row) => row.id"
            :loading="loading"
            :empty-title="t('workspace.documents.empty')"
          >
            <template #toolbar>
              <div class="ca-toolbar">
                <CaInput
                  v-model="search"
                  class="ca-toolbar__search"
                  :placeholder="t('workspace.documents.search')"
                  :aria-label="t('workspace.documents.search')"
                  @keyup.enter="applyFilters"
                />
                <CaButton variant="secondary" @click="applyFilters">{{
                  t('common.search')
                }}</CaButton>
              </div>
            </template>
            <template #cell-title="{ row }">
              <button type="button" class="mydocs__open" @click="selected = row as UserDocument">
                {{ row.title }}
              </button>
            </template>
            <template #cell-format="{ row }">
              <CaBadge size="small">{{ formatLabel(String(row.format)) }}</CaBadge>
            </template>
            <template #cell-size="{ row }">{{ formatBytes(Number(row.size_bytes)) }}</template>
            <template #cell-created="{ row }">{{
              formatDateTime(String(row.created_at))
            }}</template>
            <template #cell-actions="{ row }">
              <CaRowMenu
                :label="t('table.rowActions')"
                :items="[
                  { key: 'download', label: t('workspace.documents.download') },
                  {
                    key: 'delete',
                    label: t('workspace.documents.delete'),
                    danger: true,
                    divider: true,
                  },
                ]"
                @select="
                  (key: string) =>
                    key === 'download' ? download(row as UserDocument) : remove(row as UserDocument)
                "
              />
            </template>
          </CaTable>

          <CaPagination :page="page" :limit="pageSize" :total="total" @change="goPage" />
        </section>
      </section>

      <DocumentViewerPanel
        v-if="selected"
        :key="selected.id"
        class="mydocs__viewer"
        :doc="selected"
        @close="selected = null"
        @updated="onDocumentUpdated"
      />
    </div>
  </div>
</template>

<style scoped>
.mydocs {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--ca-space-5);
}

.mydocs--viewer {
  grid-template-columns: minmax(0, 1fr) minmax(380px, 45%);
}

.mydocs__list {
  min-width: 0;
}

.mydocs__viewer {
  position: sticky;
  top: var(--ca-space-4);
  height: calc(100vh - 200px);
}

.mydocs__open {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--ca-fg-1);
  text-align: left;
  cursor: pointer;
}

.mydocs__open:hover {
  text-decoration: underline;
}

.mydocs__actions {
  display: flex;
  gap: var(--ca-space-2);
}

@media (max-width: 1000px) {
  .mydocs--viewer {
    grid-template-columns: minmax(0, 1fr);
  }

  .mydocs__viewer {
    position: static;
    height: 70vh;
  }
}
</style>
