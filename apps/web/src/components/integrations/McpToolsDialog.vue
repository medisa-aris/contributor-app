<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  getMcpTools,
  setMcpToolPolicies,
  syncMcpTools,
  type McpToolInfo,
  type McpToolPolicy,
  type McpToolsState,
} from '@/api/connectors';
import { useToastStore } from '@/stores/toast.store';
import { formatDateTime } from '@/utils/format';
import { CaBadge, CaButton, CaDialog, CaSpinner, CaSwitch } from '@/components/ui';

/** Daftar tool server MCP dan kebijakan per tool: aktif dan wajib persetujuan. */
const props = defineProps<{ serverId: string; serverName: string; canConfigure: boolean }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const toast = useToastStore();

const state = ref<McpToolsState | null>(null);
const policies = ref<Record<string, McpToolPolicy>>({});
const loading = ref(false);
const syncing = ref(false);
const saving = ref(false);
const error = ref('');

/** Bawaan: aktif; butuh persetujuan kecuali server menandai tool read-only. */
function defaultPolicy(tool: McpToolInfo): McpToolPolicy {
  return { enabled: true, approval: tool.annotations?.readOnlyHint !== true };
}

function apply(next: McpToolsState): void {
  state.value = next;
  policies.value = Object.fromEntries(
    next.tools.map((tool) => [tool.name, next.policies[tool.name] ?? defaultPolicy(tool)]),
  );
}

watch(
  [open, () => props.serverId],
  async ([value]) => {
    if (!value) return;
    loading.value = true;
    error.value = '';
    try {
      apply(await getMcpTools(props.serverId));
    } catch (caught) {
      error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

async function sync(): Promise<void> {
  syncing.value = true;
  error.value = '';
  try {
    apply(await syncMcpTools(props.serverId));
    toast.push({ variant: 'success', title: t('connectors.mcpSynced', { count: state.value?.tools.length ?? 0 }) });
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    syncing.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    apply(await setMcpToolPolicies(props.serverId, policies.value));
    toast.push({ variant: 'success', title: t('connectors.mcpPoliciesSaved') });
    open.value = false;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

const tools = computed(() => state.value?.tools ?? []);
</script>

<template>
  <CaDialog
    v-model:open="open"
    size="large"
    :title="t('connectors.mcpToolsTitle', { name: serverName })"
    :subtitle="t('connectors.mcpToolsSubtitle')"
  >
    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <div class="mcp__bar">
      <span class="mcp__synced">
        {{
          state?.syncedAt
            ? t('connectors.mcpSyncedAt', { date: formatDateTime(state.syncedAt) })
            : t('connectors.mcpNeverSynced')
        }}
      </span>
      <CaButton v-if="canConfigure" size="small" variant="secondary" :loading="syncing" @click="sync">
        {{ t('connectors.mcpSync') }}
      </CaButton>
    </div>
    <div v-if="loading" class="mcp__loading"><CaSpinner /></div>
    <p v-else-if="tools.length === 0" class="mcp__empty">{{ t('connectors.mcpNoTools') }}</p>
    <ul v-else class="mcp__list">
      <li v-for="tool in tools" :key="tool.name" class="mcp__item">
        <div class="mcp__info">
          <span class="mcp__name">
            {{ tool.title ?? tool.name }}
            <CaBadge v-if="tool.annotations?.readOnlyHint" size="small" variant="informative">read-only</CaBadge>
            <CaBadge v-if="tool.annotations?.destructiveHint" size="small" variant="danger">destructive</CaBadge>
          </span>
          <span class="mcp__code">{{ tool.name }}</span>
          <span v-if="tool.description" class="mcp__desc">{{ tool.description }}</span>
        </div>
        <div class="mcp__controls">
          <CaSwitch v-model="policies[tool.name]!.enabled" :disabled="!canConfigure" :label="t('connectors.mcpEnabled')" />
          <CaSwitch
            v-model="policies[tool.name]!.approval"
            :disabled="!canConfigure || !policies[tool.name]!.enabled"
            :label="t('connectors.mcpApproval')"
          />
        </div>
      </li>
    </ul>
    <p class="mcp__hint">{{ t('connectors.mcpPolicyHint') }}</p>
    <template #footer>
      <CaButton variant="secondary" @click="open = false">{{ t('common.close') }}</CaButton>
      <CaButton v-if="canConfigure && tools.length" variant="primary" :loading="saving" @click="save">
        {{ t('common.save') }}
      </CaButton>
    </template>
  </CaDialog>
</template>

<style scoped>
.mcp__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ca-space-3);
  margin-bottom: var(--ca-space-3);
}

.mcp__synced,
.mcp__empty,
.mcp__hint,
.mcp__code,
.mcp__desc {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.mcp__hint {
  margin: var(--ca-space-3) 0 0;
}

.mcp__loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-6) 0;
}

.mcp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
  max-height: 50vh;
  overflow-y: auto;
}

.mcp__item {
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-4);
  padding: var(--ca-space-3);
  border: 1px solid var(--ca-border-subtle, var(--ca-border));
  border-radius: var(--ca-radius-medium, 8px);
  flex-wrap: wrap;
}

.mcp__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 240px;
}

.mcp__name {
  display: flex;
  gap: var(--ca-space-2);
  align-items: center;
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.mcp__code {
  font-family: var(--ca-font-family-monospace, monospace);
}

.mcp__controls {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}
</style>
