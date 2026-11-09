<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import { listConversationConnectors, setConversationConnectors, type ConversationConnector } from '@/api/ai';
import {
  DB_ENGINE_LABELS,
  listAvailableConnectors,
  type AvailableConnector,
  type ConnectorAccess,
  type DbEngine,
} from '@/api/connectors';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { CaIcon, CaSwitch } from '@/components/ui';

/**
 * Pemilih konektor data (database/MCP) untuk satu percakapan. Hanya konektor yang
 * di-grant admin yang muncul; akses tulis hanya bila grant mengizinkan.
 */
const props = defineProps<{
  conversationId: string | null;
  ensureConversation: () => Promise<string | null>;
  disabled?: boolean;
}>();

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const available = ref<AvailableConnector[]>([]);
const attached = ref<ConversationConnector[]>([]);
const menuOpen = ref(false);
const saving = ref(false);
const root = ref<HTMLElement | null>(null);

const canUse = computed(() => auth.can('connectors.use'));
const visible = computed(() => canUse.value && (available.value.length > 0 || attached.value.length > 0));

function key(type: string, id: string): string {
  return `${type}:${id}`;
}

function engineLabel(engine: string): string {
  return engine === 'mcp' ? 'MCP' : (DB_ENGINE_LABELS[engine as DbEngine] ?? engine);
}

async function loadAvailable(): Promise<void> {
  if (!canUse.value) return;
  try {
    available.value = await listAvailableConnectors();
  } catch {
    available.value = [];
  }
}

async function loadAttached(id: string | null): Promise<void> {
  if (!id || !canUse.value) {
    attached.value = [];
    return;
  }
  try {
    attached.value = await listConversationConnectors(id);
  } catch {
    attached.value = [];
  }
}

watch(
  () => props.conversationId,
  (id) => void loadAttached(id),
  { immediate: true },
);

async function save(next: { connectorType: AvailableConnector['connectorType']; connectorId: string; access: ConnectorAccess }[]): Promise<void> {
  const id = await props.ensureConversation();
  if (!id) return;
  saving.value = true;
  try {
    attached.value = await setConversationConnectors(id, next);
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') }, 5000);
  } finally {
    saving.value = false;
  }
}

function current() {
  return attached.value
    .filter((item) => item.granted)
    .map(({ connectorType, connectorId, access }) => ({ connectorType, connectorId, access }));
}

function isAttached(item: AvailableConnector): boolean {
  return attached.value.some((a) => key(a.connectorType, a.connectorId) === key(item.connectorType, item.connectorId));
}

function attachedAccess(item: AvailableConnector): ConnectorAccess {
  return (
    attached.value.find((a) => key(a.connectorType, a.connectorId) === key(item.connectorType, item.connectorId))?.access ??
    'read'
  );
}

async function toggle(item: AvailableConnector, on: boolean): Promise<void> {
  const others = current().filter((a) => key(a.connectorType, a.connectorId) !== key(item.connectorType, item.connectorId));
  await save(on ? [...others, { connectorType: item.connectorType, connectorId: item.connectorId, access: 'read' }] : others);
}

async function setWrite(item: AvailableConnector, write: boolean): Promise<void> {
  const next = current().map((a) =>
    key(a.connectorType, a.connectorId) === key(item.connectorType, item.connectorId)
      ? { ...a, access: (write ? 'read_write' : 'read') as ConnectorAccess }
      : a,
  );
  await save(next);
}

async function remove(item: ConversationConnector): Promise<void> {
  await save(current().filter((a) => key(a.connectorType, a.connectorId) !== key(item.connectorType, item.connectorId)));
}

function onDocumentClick(event: MouseEvent): void {
  if (menuOpen.value && root.value && !root.value.contains(event.target as Node)) menuOpen.value = false;
}

onMounted(() => {
  void loadAvailable();
  document.addEventListener('click', onDocumentClick);
});

onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <div v-if="visible" ref="root" class="cbar">
    <span class="cbar__label">
      <CaIcon name="plug" :size="13" />
      {{ t('workspace.tools.connectors') }}
    </span>
    <span
      v-for="item in attached"
      :key="`${item.connectorType}:${item.connectorId}`"
      class="cbar__chip"
      :class="{ 'cbar__chip--revoked': !item.granted }"
      :title="item.granted ? '' : t('workspace.tools.revoked')"
    >
      {{ item.name }}
      <span class="cbar__chip-meta">
        {{ item.access === 'read_write' ? t('workspace.tools.accessWrite') : t('workspace.tools.accessRead') }}
      </span>
      <button
        type="button"
        class="cbar__chip-remove"
        :aria-label="t('workspace.tools.detach', { name: item.name })"
        :disabled="disabled || saving"
        @click="remove(item)"
      >
        ×
      </button>
    </span>
    <button
      type="button"
      class="cbar__add"
      :aria-expanded="menuOpen"
      :disabled="disabled || saving"
      @click.stop="menuOpen = !menuOpen"
    >
      + {{ attached.length ? t('workspace.tools.manage') : t('workspace.tools.attach') }}
    </button>

    <div v-if="menuOpen" class="cbar__menu" role="dialog" :aria-label="t('workspace.tools.connectors')" @click.stop>
      <p class="cbar__menu-hint">{{ t('workspace.tools.menuHint') }}</p>
      <ul class="cbar__menu-list">
        <li v-for="item in available" :key="`${item.connectorType}:${item.connectorId}`" class="cbar__menu-item">
          <div class="cbar__menu-info">
            <span class="cbar__menu-name">{{ item.name }}</span>
            <span class="cbar__menu-meta">
              {{ engineLabel(item.engine) }}
              <template v-if="item.tableAllowlist?.length">
                · {{ t('workspace.tools.tables', { count: item.tableAllowlist.length }) }}
              </template>
            </span>
          </div>
          <div class="cbar__menu-controls">
            <CaSwitch
              :model-value="isAttached(item)"
              :disabled="saving"
              :label="t('workspace.tools.use')"
              @update:model-value="(v: boolean) => toggle(item, v)"
            />
            <CaSwitch
              v-if="item.access === 'read_write' && isAttached(item)"
              :model-value="attachedAccess(item) === 'read_write'"
              :disabled="saving"
              :label="t('workspace.tools.allowWrite')"
              @update:model-value="(v: boolean) => setWrite(item, v)"
            />
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.cbar {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
  padding: var(--ca-space-2) var(--ca-space-4) 0;
  font-size: var(--ca-text-200);
}

.cbar__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ca-fg-3);
}

.cbar__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 10px;
  border-radius: 999px;
  background: var(--ca-bg-brand-subtle, rgba(0, 120, 80, 0.1));
  color: var(--ca-fg-1);
}

.cbar__chip--revoked {
  background: var(--ca-bg-danger-subtle, rgba(200, 0, 0, 0.08));
  text-decoration: line-through;
}

.cbar__chip-meta {
  color: var(--ca-fg-3);
}

.cbar__chip-remove {
  border: 0;
  background: transparent;
  color: var(--ca-fg-3);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
}

.cbar__add {
  border: 1px dashed var(--ca-border);
  background: transparent;
  color: var(--ca-fg-2);
  border-radius: 999px;
  padding: 2px 10px;
  cursor: pointer;
}

.cbar__add:hover:not(:disabled) {
  color: var(--ca-fg-1);
  border-style: solid;
}

.cbar__menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: var(--ca-space-4);
  z-index: 20;
  width: min(420px, calc(100vw - 32px));
  max-height: 340px;
  overflow-y: auto;
  background: var(--ca-bg-surface, #fff);
  border: 1px solid var(--ca-border);
  border-radius: var(--ca-radius-large, 10px);
  box-shadow: var(--ca-shadow-16, 0 8px 24px rgba(0, 0, 0, 0.15));
  padding: var(--ca-space-3);
}

.cbar__menu-hint {
  margin: 0 0 var(--ca-space-2);
  color: var(--ca-fg-3);
}

.cbar__menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.cbar__menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ca-space-3);
  flex-wrap: wrap;
  padding: var(--ca-space-2);
  border-radius: var(--ca-radius-medium, 6px);
  border: 1px solid var(--ca-border-subtle, var(--ca-border));
}

.cbar__menu-info {
  display: flex;
  flex-direction: column;
}

.cbar__menu-name {
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.cbar__menu-meta {
  color: var(--ca-fg-3);
}

.cbar__menu-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}
</style>
