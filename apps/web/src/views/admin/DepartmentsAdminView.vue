<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { OrgChart } from 'd3-org-chart';
import type { HierarchyNode } from 'd3-hierarchy';
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

type OrgDatum = {
  id: string;
  parentId: string | null;
  name: string;
  code: string;
  user_count: number;
  sub_count: number;
  _expanded?: boolean;
};

function flatten(nodes: AdminDepartmentNode[], out: OrgDatum[] = []): OrgDatum[] {
  for (const node of nodes) {
    out.push({
      id: node.id,
      parentId: node.parent_id,
      name: node.name,
      code: node.code,
      user_count: node.user_count,
      sub_count: node.children.length,
    });
    flatten(node.children, out);
  }
  return out;
}

function findById(nodes: AdminDepartmentNode[], id: string): AdminDepartmentNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findById(node.children, id);
    if (hit) return hit;
  }
  return null;
}

function findParentName(nodes: AdminDepartmentNode[], id: string): string | null {
  for (const node of nodes) {
    for (const child of node.children) {
      if (child.id === id) return node.name;
    }
    const hit = findParentName(node.children, id);
    if (hit) return hit;
  }
  return null;
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (ch) => map[ch] ?? ch);
}

const chartHost = ref<HTMLElement | null>(null);
let chart: OrgChart<OrgDatum> | null = null;
let resizeObserver: ResizeObserver | null = null;

const selected = ref<AdminDepartmentNode | null>(null);

function nodeHtml(node: HierarchyNode<OrgDatum>): string {
  const d = node.data;
  return `
    <div class="dep-org-node">
      <div class="dep-org-node__name">${escapeHtml(d.name)}</div>
      <div class="dep-org-node__meta">
        <span class="dep-org-node__code">${escapeHtml(d.code)}</span>
        <span class="dep-org-node__count">${t('admin.departments.userCount', { count: d.user_count })}</span>
      </div>
    </div>`;
}

function buttonHtml(node: HierarchyNode<OrgDatum>): string {
  const collapsed = (node as HierarchyNode<OrgDatum> & { _children?: unknown[] })._children;
  return `<div class="dep-org-btn">${collapsed ? '+' : '−'}</div>`;
}

function renderChart(): void {
  if (!chartHost.value) return;
  const data = flatten(tree.value);
  if (!chart) {
    chart = new OrgChart<OrgDatum>()
      .container(chartHost.value)
      .data(data)
      .nodeWidth(() => 236)
      .nodeHeight(() => 88)
      .childrenMargin(() => 40)
      .initialExpandLevel(Number.MAX_SAFE_INTEGER)
      .compact(false)
      .layout('top')
      .nodeContent((node) => nodeHtml(node))
      .buttonContent(({ node }) => buttonHtml(node))
      .onNodeClick((node) => {
        selected.value = findById(tree.value, node.data.id);
      })
      .render();
    chart.fit();
  } else {
    const previous = new Map<string, boolean>();
    for (const item of chart.data() ?? []) previous.set(item.id, item._expanded === true);
    for (const item of data) {
      const expanded = previous.get(item.id);
      if (expanded !== undefined) item._expanded = expanded;
    }
    chart.data(data).render().fit();
  }
}

function zoomIn(): void {
  chart?.zoomIn();
}

function zoomOut(): void {
  chart?.zoomOut();
}

function fitView(): void {
  chart?.fit();
}

function expandAll(): void {
  chart?.expandAll().fit();
}

function collapseAll(): void {
  chart?.collapseAll().fit();
}

async function load(): Promise<void> {
  error.value = '';
  try {
    tree.value = await listDepartments();
    selected.value =
      selected.value && findById(tree.value, selected.value.id)
        ? findById(tree.value, selected.value.id)
        : null;
  } catch {
    error.value = t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
  await nextTick();
  try {
    renderChart();
  } catch (err) {
    console.error('[dep-org] render failed', err);
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

function openCreate(parent?: AdminDepartmentNode): void {
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

function openEdit(node: AdminDepartmentNode): void {
  editing.value = node;
  form.value = { name: node.name, code: node.code, parentId: node.parent_id ?? '' };
  formError.value = '';
  showForm.value = true;
}

function openDelete(node: AdminDepartmentNode): void {
  deleting.value = node;
  showDelete.value = true;
}

async function submit(): Promise<void> {
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

async function confirmDelete(): Promise<void> {
  if (!deleting.value) return;
  saving.value = true;
  try {
    await deleteDepartment(deleting.value.id);
    toast.push({ variant: 'success', title: t('admin.departments.deleted') });
    showDelete.value = false;
    if (selected.value?.id === deleting.value.id) selected.value = null;
    await load();
  } catch (err) {
    toast.push({
      variant: 'danger',
      title:
        err instanceof ApiError && err.status === 409 ? err.message : t('errors.saveFailed'),
    });
  } finally {
    saving.value = false;
  }
}

const selectedParentName = computed(() =>
  selected.value ? findParentName(tree.value, selected.value.id) : null,
);

onMounted(() => {
  load();
  if (chartHost.value) {
    resizeObserver = new ResizeObserver(() => chart?.fit());
    resizeObserver.observe(chartHost.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.clear();
  chart = null;
});
</script>

<template>
  <section class="dep-org">
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
    <div v-if="loading" class="dep-org__loading"><CaSpinner size="large" /></div>

    <div v-else-if="tree.length === 0" class="dep-org__empty">
      <p>{{ t('admin.departments.empty') }}</p>
    </div>

    <div v-else class="dep-org__layout">
      <div class="dep-org__canvas-wrap">
        <div class="dep-org__toolbar">
          <div class="dep-org__hint">{{ t('admin.departments.chartHint') }}</div>
          <div class="dep-org__tools">
            <CaButton size="small" variant="subtle" @click="zoomOut">
              {{ t('admin.departments.zoomOut') }}
            </CaButton>
            <CaButton size="small" variant="subtle" @click="fitView">
              {{ t('admin.departments.fitView') }}
            </CaButton>
            <CaButton size="small" variant="subtle" @click="zoomIn">
              {{ t('admin.departments.zoomIn') }}
            </CaButton>
            <span class="dep-org__tools-divider" aria-hidden="true" />
            <CaButton size="small" variant="subtle" @click="expandAll">
              {{ t('admin.departments.expandAll') }}
            </CaButton>
            <CaButton size="small" variant="subtle" @click="collapseAll">
              {{ t('admin.departments.collapseAll') }}
            </CaButton>
          </div>
        </div>
        <div ref="chartHost" class="dep-org__canvas" />
      </div>

      <aside v-if="selected" class="dep-org__panel">
        <div class="dep-org__panel-head">
          <div class="dep-org__panel-id">
            <h3 class="dep-org__panel-title">{{ selected.name }}</h3>
            <span class="admin-mono dep-org__panel-code">{{ selected.code }}</span>
          </div>
          <CaButton size="small" variant="subtle" @click="selected = null">
            {{ t('admin.departments.closeDetail') }}
          </CaButton>
        </div>
        <dl class="dep-org__panel-facts">
          <div class="dep-org__panel-fact">
            <dt>{{ t('admin.departments.formParent') }}</dt>
            <dd>{{ selectedParentName ?? t('admin.departments.detailNoParent') }}</dd>
          </div>
          <div class="dep-org__panel-fact">
            <dt>{{ t('admin.departments.columnUsers') }}</dt>
            <dd>{{ selected.user_count }}</dd>
          </div>
          <div class="dep-org__panel-fact">
            <dt>{{ t('admin.departments.columnSub') }}</dt>
            <dd>{{ selected.children.length }}</dd>
          </div>
        </dl>
        <div v-if="canManage" class="dep-org__panel-actions">
          <CaButton size="small" variant="primary" @click="openCreate(selected)">
            {{ t('admin.departments.addChild') }}
          </CaButton>
          <CaButton size="small" variant="subtle" @click="openEdit(selected)">
            {{ t('admin.departments.editAction') }}
          </CaButton>
          <CaButton size="small" variant="subtle" @click="openDelete(selected)">
            {{ t('admin.departments.deleteAction') }}
          </CaButton>
        </div>
      </aside>
    </div>

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
      <p class="dep-org__delete-text">
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
.dep-org__loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-24) 0;
}

.dep-org__empty {
  padding: var(--ca-space-12);
  text-align: center;
  color: var(--ca-fg-3);
}

.dep-org__layout {
  display: flex;
  gap: var(--ca-space-8);
  align-items: stretch;
}

.dep-org__canvas-wrap {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-bg-surface);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dep-org__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-8);
  flex-wrap: wrap;
  padding: var(--ca-space-4) var(--ca-space-6);
  border-bottom: 1px solid var(--ca-stroke-3);
}

.dep-org__hint {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.dep-org__tools {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
}

.dep-org__tools-divider {
  width: 1px;
  height: 16px;
  background: var(--ca-stroke-3);
  margin: 0 var(--ca-space-2);
}

.dep-org__canvas {
  flex: 1;
  min-height: 480px;
  height: calc(100vh - 320px);
}

.dep-org__panel {
  width: 300px;
  flex-shrink: 0;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  background: var(--ca-bg-surface);
  padding: var(--ca-space-8);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-8);
  align-self: flex-start;
}

.dep-org__panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ca-space-4);
}

.dep-org__panel-id {
  min-width: 0;
}

.dep-org__panel-title {
  margin: 0;
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.dep-org__panel-code {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
}

.dep-org__panel-facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
}

.dep-org__panel-fact {
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-4);
  font-size: var(--ca-text-200);
}

.dep-org__panel-fact dt {
  color: var(--ca-fg-3);
}

.dep-org__panel-fact dd {
  margin: 0;
  color: var(--ca-fg-1);
  font-weight: var(--ca-font-weight-medium);
  text-align: right;
}

.dep-org__panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
}

.dep-org__delete-text {
  margin: 0;
  color: var(--ca-fg-1);
}

@media (max-width: 900px) {
  .dep-org__layout {
    flex-direction: column;
  }

  .dep-org__panel {
    width: auto;
  }
}
</style>

<style>
.dep-org__canvas .link {
  stroke: var(--ca-stroke-2);
  fill: none;
}

.dep-org-node {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-left: 3px solid var(--ca-color-brand);
  border-radius: var(--ca-radius-lg);
  padding: var(--ca-space-5) var(--ca-space-6);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--ca-space-3);
  overflow: hidden;
  cursor: pointer;
  font-family: inherit;
  box-shadow: var(--ca-shadow-2);
}

.dep-org-node:hover {
  background: var(--ca-bg-surface-hover);
  border-color: var(--ca-color-brand-soft);
}

.dep-org-node__name {
  font-size: var(--ca-text-200);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dep-org-node__meta {
  display: flex;
  align-items: center;
  gap: var(--ca-space-3);
  min-width: 0;
}

.dep-org-node__code {
  font-size: var(--ca-text-100);
  font-family: var(--ca-font-family-monospace, monospace);
  color: var(--ca-color-brand);
  background: var(--ca-brand-10);
  border-radius: var(--ca-radius-sm);
  padding: 0 var(--ca-space-3);
  white-space: nowrap;
}

.dep-org-node__count {
  font-size: var(--ca-text-100);
  color: var(--ca-fg-3);
  white-space: nowrap;
}

.dep-org-btn {
  width: 20px;
  height: 20px;
  border-radius: var(--ca-radius-circular);
  background: var(--ca-color-brand);
  color: var(--ca-color-neutral-inverted, #ffffff);
  font-size: 14px;
  line-height: 20px;
  text-align: center;
  cursor: pointer;
  user-select: none;
}
</style>
