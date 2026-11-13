<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ToolTraceStep } from '@/api/ai';
import { CaBadge, CaButton, CaIcon } from '@/components/ui';

/**
 * Jejak pemanggilan tool konektor pada satu jawaban asisten: query yang dijalankan,
 * ringkasan hasil, pratinjau tabel, dan kartu persetujuan untuk operasi tulis.
 */
const props = defineProps<{
  steps: ToolTraceStep[];
  /** Persetujuan sedang diproses (id approval). */
  busyApprovalId?: string | null;
  /** Sembunyikan tombol persetujuan (mis. riwayat read-only). */
  readonly?: boolean;
}>();

const emit = defineEmits<{
  decide: [payload: { approvalId: string; decision: 'approved' | 'rejected' }];
}>();

const { t } = useI18n();
const open = ref<Set<string>>(new Set());
const expanded = ref(false);

const pendingSteps = computed(() => props.steps.filter((step) => step.status === 'pending_approval'));
const doneSteps = computed(() => props.steps.filter((step) => step.status !== 'pending_approval'));

function toggle(id: string): void {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  open.value = next;
}

function statusVariant(step: ToolTraceStep): 'success' | 'danger' | 'warning' | 'informative' | 'neutral' {
  switch (step.status) {
    case 'ok':
    case 'approved':
      return 'success';
    case 'error':
    case 'rejected':
      return 'danger';
    case 'pending_approval':
      return 'warning';
    default:
      return 'informative';
  }
}

/** Statement yang ditampilkan: SQL bila ada, selain itu argumen JSON. */
function statement(step: ToolTraceStep): string {
  const sql = step.input?.sql;
  if (typeof sql === 'string') return sql;
  const table = step.input?.table;
  if (typeof table === 'string') return table;
  return Object.keys(step.input ?? {}).length > 0 ? JSON.stringify(step.input, null, 2) : '';
}

function purpose(step: ToolTraceStep): string {
  return typeof step.input?.purpose === 'string' ? step.input.purpose : '';
}

interface TablePreview {
  columns: string[];
  rows: Record<string, unknown>[];
}

function tablePreview(step: ToolTraceStep): TablePreview | null {
  const preview = step.preview as { columns?: unknown; rows?: unknown } | undefined;
  if (!preview || !Array.isArray(preview.columns) || !Array.isArray(preview.rows)) return null;
  if (preview.rows.length === 0) return null;
  return { columns: preview.columns as string[], rows: (preview.rows as Record<string, unknown>[]).slice(0, 10) };
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
</script>

<template>
  <div class="trace">
    <div v-for="step in pendingSteps" :key="step.id" class="trace__approval" role="group" :aria-label="t('workspace.tools.approvalTitle')">
      <div class="trace__approval-head">
        <CaIcon name="shield" :size="15" />
        <strong>{{ t('workspace.tools.approvalTitle') }}</strong>
        <span v-if="step.source" class="trace__source">{{ step.source }}</span>
      </div>
      <p v-if="purpose(step)" class="trace__purpose">{{ purpose(step) }}</p>
      <pre class="trace__code">{{ statement(step) }}</pre>
      <p class="trace__approval-hint">{{ t('workspace.tools.approvalHint') }}</p>
      <div v-if="!readonly && step.approvalId" class="trace__approval-actions">
        <CaButton
          size="small"
          variant="primary"
          :loading="busyApprovalId === step.approvalId"
          :disabled="Boolean(busyApprovalId)"
          @click="emit('decide', { approvalId: step.approvalId!, decision: 'approved' })"
        >
          {{ t('workspace.tools.approve') }}
        </CaButton>
        <CaButton
          size="small"
          variant="secondary"
          :disabled="Boolean(busyApprovalId)"
          @click="emit('decide', { approvalId: step.approvalId!, decision: 'rejected' })"
        >
          {{ t('workspace.tools.reject') }}
        </CaButton>
      </div>
    </div>

    <div v-if="doneSteps.length" class="trace__steps">
      <button type="button" class="trace__summary" :aria-expanded="expanded" @click="expanded = !expanded">
        <CaIcon name="plug" :size="13" />
        <span>{{ t('workspace.tools.summary', { count: doneSteps.length }) }}</span>
        <CaIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="12" />
      </button>
      <ol v-if="expanded" class="trace__list">
        <li v-for="step in doneSteps" :key="step.id" class="trace__item">
          <button type="button" class="trace__item-head" :aria-expanded="open.has(step.id)" @click="toggle(step.id)">
            <CaBadge :variant="statusVariant(step)" size="small">{{ t(`workspace.tools.status.${step.status}`) }}</CaBadge>
            <span class="trace__label">{{ step.label }}</span>
            <span v-if="step.source" class="trace__source">{{ step.source }}</span>
            <span class="trace__result">{{ step.summary }}</span>
          </button>
          <div v-if="open.has(step.id)" class="trace__detail">
            <p v-if="purpose(step)" class="trace__purpose">{{ purpose(step) }}</p>
            <pre v-if="statement(step)" class="trace__code">{{ statement(step) }}</pre>
            <div v-if="tablePreview(step)" class="trace__table-wrap">
              <table class="trace__table">
                <thead>
                  <tr>
                    <th v-for="column in tablePreview(step)!.columns" :key="column">{{ column }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in tablePreview(step)!.rows" :key="index">
                    <td v-for="column in tablePreview(step)!.columns" :key="column">{{ cell(row[column]) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.trace {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  margin-bottom: var(--ca-space-3);
}

.trace__approval {
  border: 1px solid var(--ca-warning-stroke);
  background: var(--ca-warning-bg, rgba(224, 178, 82, 0.1));
  border-radius: var(--ca-radius-xl, 10px);
  padding: var(--ca-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.trace__approval-head {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  color: var(--ca-fg-1);
  flex-wrap: wrap;
}

.trace__approval-hint,
.trace__purpose {
  margin: 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-2);
}

.trace__approval-actions {
  display: flex;
  gap: var(--ca-space-2);
}

.trace__code {
  margin: 0;
  padding: var(--ca-space-3);
  background: var(--ca-bg-canvas, rgba(0, 0, 0, 0.04));
  border-radius: var(--ca-radius-xl, 6px);
  font-family: var(--ca-font-family-mono, monospace);
  font-size: var(--ca-text-200);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
}

.trace__summary {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-2);
  border: 1px solid var(--ca-stroke-2, var(--ca-stroke-2));
  background: transparent;
  color: var(--ca-fg-2);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: var(--ca-text-200);
  cursor: pointer;
}

.trace__summary:hover {
  color: var(--ca-fg-1);
}

.trace__list {
  list-style: none;
  margin: var(--ca-space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.trace__item {
  border: 1px solid var(--ca-stroke-2, var(--ca-stroke-2));
  border-radius: var(--ca-radius-xl, 8px);
}

.trace__item-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  padding: var(--ca-space-2) var(--ca-space-3);
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
  flex-wrap: wrap;
  color: var(--ca-fg-1);
}

.trace__label {
  font-size: var(--ca-text-200);
  font-weight: var(--ca-font-weight-medium);
}

.trace__source,
.trace__result {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.trace__result {
  margin-left: auto;
}

.trace__detail {
  padding: 0 var(--ca-space-3) var(--ca-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.trace__table-wrap {
  overflow-x: auto;
  max-height: 260px;
}

.trace__table {
  border-collapse: collapse;
  font-size: var(--ca-text-200);
  min-width: 100%;
}

.trace__table th,
.trace__table td {
  border-bottom: 1px solid var(--ca-stroke-2, var(--ca-stroke-2));
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trace__table th {
  color: var(--ca-fg-3);
  font-weight: var(--ca-font-weight-medium);
  position: sticky;
  top: 0;
  background: var(--ca-bg-surface, var(--ca-bg-canvas));
}
</style>
