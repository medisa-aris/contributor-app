<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  updateDepartment,
  type AdminDepartmentNode,
} from '@/api/admin';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import {
  CaButton,
  CaDialog,
  CaField,
  CaInput,
  CaPageHeader,
  CaSelect,
  CaSpinner,
  type CaSelectOption,
} from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const canManage = computed(() => auth.can('rbac.departments.manage'));

const tree = ref<AdminDepartmentNode[]>([]);
const loading = ref(true);
const error = ref('');

type FlatNode = AdminDepartmentNode & { depth: number };

const flat = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  function walk(nodes: AdminDepartmentNode[], depth: number) {
    for (const node of nodes) {
      out.push({ ...node, depth });
      walk(node.children, depth + 1);
    }
  }
  walk(tree.value, 0);
  return out;
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    tree.value = await listDepartments();
  } catch {
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

const showForm = ref(false);
const showDelete = ref(false);
const saving = ref(false);
const formError = ref('');
const editing = ref<AdminDepartmentNode | null>(null);
const deleting = ref<AdminDepartmentNode | null>(null);

const form = ref({ name: '', code: '', parentId: '' });
const codePattern = /^[A-Z][A-Z0-9_]{1,49}$/;

const parentOptions = computed<CaSelectOption[]>(() => {
  const options: CaSelectOption[] = [{ value: '', label: t('admin.departments.noParent') }];
  function walk(nodes: AdminDepartmentNode[], depth: number, excludeId: string | null) {
    for (const node of nodes) {
      if (node.id !== excludeId) {
        options.push({ value: node.id, label: `${'— '.repeat(depth)}${node.name}` });
        walk(node.children, depth + 1, excludeId);
      }
    }
  }
  walk(tree.value, 0, editing.value?.id ?? null);
  return options;
});

function openCreate(parent?: AdminDepartmentNode) {
  editing.value = null;
  form.value = { name: '', code: '', parentId: parent?.id ?? '' };
  formError.value = '';
  showForm.value = true;
}

const formTitle = computed(() => {
  if (editing.value) return t('admin.departments.editTitle');
  const parentLabel = parentOptions.value.find((o) => o.value === form.value.parentId)?.label;
  if (parentLabel) {
    return t('admin.departments.createChildTitle', { name: parentLabel.replace(/^(— )+/, '') });
  }
  return t('admin.departments.createTitle');
});

function openEdit(node: AdminDepartmentNode) {
  editing.value = node;
  form.value = { name: node.name, code: node.code, parentId: node.parent_id ?? '' };
  formError.value = '';
  showForm.value = true;
}

function openDelete(node: AdminDepartmentNode) {
  deleting.value = node;
  showDelete.value = true;
}

async function submit() {
  formError.value = '';
  const { name, code, parentId } = form.value;
  if (!name.trim() || !code.trim()) {
    formError.value = t('errors.requiredFields');
    return;
  }
  if (!codePattern.test(code.trim())) {
    formError.value = t('admin.departments.formCodeHint');
    return;
  }
  saving.value = true;
  try {
    if (editing.value) {
      await updateDepartment(editing.value.id, {
        name: name.trim(),
        code: code.trim(),
        parentId: parentId || null,
      });
      toast.push({ variant: 'success', title: t('admin.departments.updated') });
    } else {
      await createDepartment({
        name: name.trim(),
        code: code.trim(),
        parentId: parentId || null,
      });
      toast.push({ variant: 'success', title: t('admin.departments.created') });
    }
    showForm.value = false;
    await load();
  } catch (err) {
    formError.value =
      err instanceof ApiError && err.status === 409
        ? t('admin.departments.codeTaken')
        : err instanceof ApiError && err.status === 400
          ? t('errors.requiredFields')
          : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!deleting.value) return;
  saving.value = true;
  try {
    await deleteDepartment(deleting.value.id);
    toast.push({ variant: 'success', title: t('admin.departments.deleted') });
    showDelete.value = false;
    await load();
  } catch (err) {
    toast.push({
      variant: 'danger',
      title:
        err instanceof ApiError && err.status === 409
          ? err.message
          : t('errors.saveFailed'),
    });
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.departments.title')"
      :description="t('admin.departments.description')"
    >
      <template #actions>
        <CaButton v-if="canManage" variant="primary" @click="openCreate()">
          {{ t('admin.departments.addButton') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <p v-if="error" class="admin-error">{{ error }}</p>
    <div v-if="loading" class="dep-loading"><CaSpinner size="large" /></div>

    <div v-else-if="flat.length === 0" class="dep-empty">
      <p>{{ t('admin.departments.empty') }}</p>
    </div>

    <ul v-else class="dep-list">
      <li
        v-for="node in flat"
        :key="node.id"
        class="dep-row"
        :style="{ paddingLeft: `${node.depth * 24 + 16}px` }"
      >
        <span class="dep-row__line" aria-hidden="true" />
        <div class="dep-row__main">
          <span class="dep-row__name">{{ node.name }}</span>
          <span class="admin-mono dep-row__code">{{ node.code }}</span>
        </div>
        <div class="dep-row__meta">
          <span class="dep-row__badge">{{ t('admin.departments.userCount', { count: node.user_count }) }}</span>
          <span v-if="node.children.length > 0" class="dep-row__badge">
            {{ t('admin.departments.subCount', { count: node.children.length }) }}
          </span>
        </div>
        <div v-if="canManage" class="dep-row__actions">
          <CaButton size="small" variant="subtle" @click="openCreate(node)">
            {{ t('admin.departments.addChild') }}
          </CaButton>
          <CaButton size="small" variant="subtle" @click="openEdit(node)">
            {{ t('admin.departments.editAction') }}
          </CaButton>
          <CaButton size="small" variant="subtle" @click="openDelete(node)">
            {{ t('admin.departments.deleteAction') }}
          </CaButton>
        </div>
      </li>
    </ul>

    <CaDialog v-model:open="showForm" :title="formTitle" size="small">
      <div class="admin-form">
        <CaField :label="t('admin.departments.formName')">
          <CaInput v-model="form.name" />
        </CaField>
        <CaField :label="t('admin.departments.formCode')" :hint="t('admin.departments.formCodeHint')">
          <CaInput v-model="form.code" placeholder="OPS_JKT" />
        </CaField>
        <CaField :label="t('admin.departments.formParent')">
          <CaSelect v-model="form.parentId" :options="parentOptions" />
        </CaField>
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

    <CaDialog
      v-model:open="showDelete"
      :title="t('admin.departments.deleteTitle')"
      size="small"
    >
      <p class="dep-delete-text">
        {{ t('admin.departments.deleteConfirm', { name: deleting?.name ?? '' }) }}
      </p>
      <template #footer>
        <CaButton variant="subtle" @click="showDelete = false">
          {{ t('common.cancel') }}
        </CaButton>
        <CaButton variant="danger" :disabled="saving" @click="confirmDelete">
          {{ t('admin.departments.deleteAction') }}
        </CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.dep-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-24) 0;
}

.dep-empty {
  padding: var(--ca-space-12);
  text-align: center;
  color: var(--ca-fg-3);
}

.dep-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  overflow: hidden;
  background: var(--ca-bg-surface);
}

.dep-row {
  display: flex;
  align-items: center;
  gap: var(--ca-space-8);
  padding: var(--ca-space-6) var(--ca-space-8);
  border-bottom: 1px solid var(--ca-stroke-3);
}

.dep-row:last-child {
  border-bottom: none;
}

.dep-row__main {
  display: flex;
  align-items: baseline;
  gap: var(--ca-space-6);
  min-width: 0;
}

.dep-row__name {
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.dep-row__code {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.dep-row__meta {
  display: flex;
  gap: var(--ca-space-4);
  margin-left: auto;
}

.dep-row__badge {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
  background: var(--ca-bg-surface-3);
  border-radius: var(--ca-radius-circular);
  padding: 2px var(--ca-space-6);
  white-space: nowrap;
}

.dep-row__actions {
  display: flex;
  gap: var(--ca-space-2);
  opacity: 0;
}

.dep-row:hover .dep-row__actions {
  opacity: 1;
}
</style>
