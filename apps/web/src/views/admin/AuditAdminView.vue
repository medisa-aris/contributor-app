<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { listAuditEvents, type AdminAuditRow } from '@/api/admin';
import { usePagedList } from '@/composables/usePagedList';
import {
  CaBadge,
  CaButton,
  CaDialog,
  CaInput,
  CaPageHeader,
  CaPagination,
  CaSelect,
  CaTable,
  type CaSelectOption,
  type CaTableColumn,
} from '@/components/ui';
import { formatDateTime } from '@/utils/format';

const { t } = useI18n();

const { items, total, page, pageSize, loading, error, load, setFilter, goPage } =
  usePagedList<AdminAuditRow>(listAuditEvents, { pageSize: 25 });

const severity = ref('');
const eventKey = ref('');
const search = ref('');

const severityOptions = computed<CaSelectOption[]>(() => [
  { value: '', label: t('common.all') },
  { value: 'info', label: t('admin.audit.severityInfo') },
  { value: 'warn', label: t('admin.audit.severityWarn') },
  { value: 'critical', label: t('admin.audit.severityCritical') },
]);

watch(severity, (value) => {
  setFilter({ severity: value || undefined });
});

let keyTimer: ReturnType<typeof setTimeout> | undefined;
watch(eventKey, (value) => {
  clearTimeout(keyTimer);
  keyTimer = setTimeout(() => {
    setFilter({ eventKey: value.trim() || undefined });
  }, 300);
});

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    setFilter({ search: value.trim() || undefined });
  }, 300);
});

const columns = computed<CaTableColumn[]>(() => [
  { key: 'occurred_at', label: t('admin.audit.columnTime'), width: '170px' },
  { key: 'severity', label: t('admin.audit.columnSeverity'), width: '110px' },
  { key: 'event', label: t('admin.audit.columnEvent') },
  { key: 'actor', label: t('admin.audit.columnActor'), width: '180px' },
  { key: 'entity', label: t('admin.audit.columnEntity'), width: '180px' },
]);

function severityVariant(value: string): 'informative' | 'warning' | 'danger' | 'neutral' {
  if (value === 'critical') return 'danger';
  if (value === 'warn') return 'warning';
  if (value === 'info') return 'informative';
  return 'neutral';
}

function severityLabel(value: string): string {
  if (value === 'critical') return t('admin.audit.severityCritical');
  if (value === 'warn') return t('admin.audit.severityWarn');
  return t('admin.audit.severityInfo');
}

const detailOpen = ref(false);
const detail = ref<AdminAuditRow | null>(null);

function openDetail(row: AdminAuditRow) {
  detail.value = row;
  detailOpen.value = true;
}

function payloadJson(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('admin.audit.title')"
      :description="t('admin.audit.description')"
    />

    <div class="admin-filters">
      <div class="admin-filters__field">
        <CaSelect v-model="severity" :options="severityOptions" />
      </div>
      <div class="admin-filters__field">
        <CaInput
          v-model="eventKey"
          type="search"
          :placeholder="t('admin.audit.eventKeyPlaceholder')"
        />
      </div>
      <div class="admin-filters__field admin-filters__wide">
        <CaInput
          v-model="search"
          type="search"
          :placeholder="t('admin.audit.searchPlaceholder')"
        />
      </div>
      <div class="admin-filters__spacer" />
      <CaButton variant="secondary" :loading="loading" @click="load">
        {{ t('common.refresh') }}
      </CaButton>
    </div>

    <p v-if="error" class="admin-error">{{ error }}</p>

    <CaTable
      :columns="columns"
      :rows="items"
      :row-key="(row) => row.id"
      :loading="loading"
    >
      <template #cell-occurred_at="{ row }">
        {{ formatDateTime(row.occurred_at) }}
      </template>
      <template #cell-severity="{ row }">
        <CaBadge :variant="severityVariant(row.severity)">
          {{ severityLabel(row.severity) }}
        </CaBadge>
      </template>
      <template #cell-event="{ row }">
        <button type="button" class="aud-event" @click="openDetail(row)">
          <span class="admin-mono">{{ row.event_key }}</span>
          <span class="aud-event__summary">{{ row.summary }}</span>
        </button>
      </template>
      <template #cell-actor="{ row }">
        {{ row.actor_label ?? '—' }}
      </template>
      <template #cell-entity="{ row }">
        <span v-if="row.entity_type" class="admin-mono">
          {{ row.entity_type }}
        </span>
        <span v-else>—</span>
      </template>
    </CaTable>

    <CaPagination :page="page" :limit="pageSize" :total="total" @change="goPage" />

    <CaDialog
      v-model:open="detailOpen"
      :title="t('admin.audit.detailTitle')"
      :subtitle="detail?.event_key"
      size="medium"
    >
      <div v-if="detail" class="aud-detail">
        <dl class="aud-detail__grid">
          <div class="aud-detail__row">
            <dt>{{ t('admin.audit.columnTime') }}</dt>
            <dd>{{ formatDateTime(detail.occurred_at) }}</dd>
          </div>
          <div class="aud-detail__row">
            <dt>{{ t('admin.audit.columnSeverity') }}</dt>
            <dd>
              <CaBadge :variant="severityVariant(detail.severity)">
                {{ severityLabel(detail.severity) }}
              </CaBadge>
            </dd>
          </div>
          <div class="aud-detail__row">
            <dt>{{ t('admin.audit.columnActor') }}</dt>
            <dd>{{ detail.actor_label ?? '—' }}</dd>
          </div>
          <div class="aud-detail__row">
            <dt>{{ t('admin.audit.fieldActorIp') }}</dt>
            <dd class="admin-mono">{{ detail.actor_ip ?? '—' }}</dd>
          </div>
          <div class="aud-detail__row">
            <dt>{{ t('admin.audit.fieldEntity') }}</dt>
            <dd class="admin-mono">
              {{ detail.entity_type ?? '—' }}{{ detail.entity_id ? ` · ${detail.entity_id}` : '' }}
            </dd>
          </div>
          <div class="aud-detail__row">
            <dt>{{ t('admin.audit.fieldRequestId') }}</dt>
            <dd class="admin-mono">{{ detail.request_id ?? '—' }}</dd>
          </div>
        </dl>
        <p class="aud-detail__summary">{{ detail.summary }}</p>
        <h3 class="aud-detail__title">{{ t('admin.audit.fieldPayload') }}</h3>
        <pre class="aud-detail__payload">{{ payloadJson(detail.payload) }}</pre>
      </div>
      <template #footer>
        <CaButton variant="subtle" @click="detailOpen = false">
          {{ t('common.close') }}
        </CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.aud-event {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.aud-event:hover .aud-event__summary {
  text-decoration: underline;
}

.aud-event__summary {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-2);
}

.aud-detail__grid {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
}

.aud-detail__row {
  display: flex;
  gap: var(--ca-space-8);
}

.aud-detail__row dt {
  width: 140px;
  flex-shrink: 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.aud-detail__row dd {
  margin: 0;
  color: var(--ca-fg-1);
  font-size: var(--ca-text-200);
}

.aud-detail__summary {
  margin: var(--ca-space-8) 0 0;
  color: var(--ca-fg-1);
  font-size: var(--ca-text-300);
}

.aud-detail__title {
  margin: var(--ca-space-8) 0 var(--ca-space-4);
  font-size: var(--ca-text-300);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.aud-detail__payload {
  margin: 0;
  padding: var(--ca-space-6);
  background: var(--ca-bg-surface-3);
  border-radius: var(--ca-radius-md);
  font-family: var(--ca-font-family-mono);
  font-size: var(--ca-text-100);
  color: var(--ca-fg-1);
  overflow-x: auto;
  max-height: 320px;
}
</style>
