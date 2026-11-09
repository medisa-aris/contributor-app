<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import type { AvailableConnector } from '@/api/connectors';
import {
  createAgentFromTemplate,
  deleteAgent,
  listAgentTemplates,
  updateAgent,
  type AgentTemplate,
  type PersonalAgent,
  type Skill,
} from '@/api/subordinate';
import { useToastStore } from '@/stores/toast.store';
import { CaBadge, CaButton, CaDialog, CaEmptyState, CaSpinner } from '@/components/ui';
import AgentAvatar from './AgentAvatar.vue';
import AgentEditorDialog from './AgentEditorDialog.vue';

const props = defineProps<{
  agents: PersonalAgent[];
  skills: Skill[];
  connectors: AvailableConnector[];
  loading: boolean;
}>();
const emit = defineEmits<{ changed: []; assign: [agentId: string] }>();

const { t } = useI18n();
const toast = useToastStore();

const editorOpen = ref(false);
const editing = ref<PersonalAgent | null>(null);
const templatesOpen = ref(false);
const templates = ref<AgentTemplate[]>([]);
const templatesLoading = ref(false);
const creatingFrom = ref<string | null>(null);

function openCreate(): void {
  editing.value = null;
  editorOpen.value = true;
}

function openEdit(agent: PersonalAgent): void {
  editing.value = agent;
  editorOpen.value = true;
}

async function openTemplates(): Promise<void> {
  templatesOpen.value = true;
  templatesLoading.value = true;
  try {
    templates.value = await listAgentTemplates();
  } catch {
    templates.value = [];
  } finally {
    templatesLoading.value = false;
  }
}

async function useTemplate(template: AgentTemplate): Promise<void> {
  creatingFrom.value = template.id;
  try {
    const agent = await createAgentFromTemplate(template.id);
    templatesOpen.value = false;
    emit('changed');
    toast.push({ variant: 'success', title: t('subordinate.agents.createdFromTemplate', { name: agent.name }) });
    openEdit(agent);
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') });
  } finally {
    creatingFrom.value = null;
  }
}

async function toggleStatus(agent: PersonalAgent): Promise<void> {
  try {
    await updateAgent(agent.id, { status: agent.status === 'active' ? 'inactive' : 'active' });
    emit('changed');
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') });
  }
}

async function remove(agent: PersonalAgent): Promise<void> {
  if (!window.confirm(t('subordinate.agents.deleteConfirm', { name: agent.name }))) return;
  try {
    await deleteAgent(agent.id);
    emit('changed');
    toast.push({ variant: 'success', title: t('subordinate.agents.deleted') });
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') });
  }
}

function onSaved(): void {
  emit('changed');
  toast.push({ variant: 'success', title: t('subordinate.agents.saved') });
}

defineExpose({ openCreate });
void props;
</script>

<template>
  <section class="ap">
    <div class="ap__head">
      <p class="ap__intro">{{ t('subordinate.agents.intro') }}</p>
      <div class="ap__actions">
        <CaButton variant="secondary" @click="openTemplates">{{ t('subordinate.agents.fromTemplate') }}</CaButton>
        <CaButton variant="primary" @click="openCreate">{{ t('subordinate.agents.create') }}</CaButton>
      </div>
    </div>

    <div v-if="loading" class="ap__loading"><CaSpinner /></div>
    <CaEmptyState
      v-else-if="agents.length === 0"
      :title="t('subordinate.agents.emptyTitle')"
      :description="t('subordinate.agents.emptyDescription')"
    />
    <ul v-else class="ap__grid">
      <li v-for="agent in agents" :key="agent.id" class="ap__card" :class="{ 'ap__card--inactive': agent.status !== 'active' }">
        <div class="ap__card-head">
          <AgentAvatar :name="agent.name" :color="agent.avatar_color" :size="40" />
          <div class="ap__card-title">
            <h3>{{ agent.name }}</h3>
            <span class="ap__muted">
              {{ agent.template_name ? t('subordinate.agents.basedOn', { name: agent.template_name }) : t('subordinate.agents.custom') }}
              · {{ t('subordinate.agents.taskCount', { count: agent.task_count }) }}
            </span>
          </div>
          <CaBadge v-if="agent.status !== 'active'" size="small">{{ t('subordinate.agents.inactive') }}</CaBadge>
        </div>
        <p class="ap__desc">{{ agent.description || agent.responsibilities || agent.instruction }}</p>
        <div v-if="agent.skills.length" class="ap__chips">
          <span class="ap__chip-label">{{ t('subordinate.agents.skills') }}</span>
          <CaBadge v-for="skill in agent.skills" :key="skill.id" size="small" variant="informative">{{ skill.name }}</CaBadge>
        </div>
        <div v-if="agent.connectors.length" class="ap__chips">
          <span class="ap__chip-label">{{ t('subordinate.agents.connectors') }}</span>
          <CaBadge
            v-for="connector in agent.connectors"
            :key="`${connector.connectorType}:${connector.connectorId}`"
            size="small"
            :variant="!connector.granted ? 'danger' : connector.access === 'read_write' ? 'warning' : 'success'"
          >
            {{ connector.name }}{{ connector.access === 'read_write' ? ' · tulis' : '' }}
          </CaBadge>
        </div>
        <div class="ap__card-actions">
          <CaButton size="small" variant="primary" :disabled="agent.status !== 'active'" @click="emit('assign', agent.id)">
            {{ t('subordinate.agents.assign') }}
          </CaButton>
          <CaButton size="small" variant="secondary" @click="openEdit(agent)">{{ t('common.edit') }}</CaButton>
          <CaButton size="small" variant="subtle" @click="toggleStatus(agent)">
            {{ agent.status === 'active' ? t('subordinate.agents.deactivate') : t('subordinate.agents.activate') }}
          </CaButton>
          <CaButton size="small" variant="danger" @click="remove(agent)">{{ t('common.delete') }}</CaButton>
        </div>
      </li>
    </ul>

    <AgentEditorDialog
      v-model:open="editorOpen"
      :agent="editing"
      :skills="skills"
      :connectors="connectors"
      @saved="onSaved"
    />

    <CaDialog
      v-model:open="templatesOpen"
      size="large"
      :title="t('subordinate.agents.templatesTitle')"
      :subtitle="t('subordinate.agents.templatesSubtitle')"
    >
      <div v-if="templatesLoading" class="ap__loading"><CaSpinner /></div>
      <p v-else-if="templates.length === 0" class="ap__muted">{{ t('subordinate.agents.noTemplates') }}</p>
      <ul v-else class="ap__templates">
        <li v-for="template in templates" :key="template.id" class="ap__template">
          <div>
            <strong>{{ template.name }}</strong>
            <p class="ap__muted">{{ template.description || template.instruction.slice(0, 160) }}</p>
          </div>
          <CaButton size="small" variant="primary" :loading="creatingFrom === template.id" @click="useTemplate(template)">
            {{ t('subordinate.agents.useTemplate') }}
          </CaButton>
        </li>
      </ul>
      <template #footer>
        <CaButton variant="secondary" @click="templatesOpen = false">{{ t('common.close') }}</CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.ap__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--ca-space-4);
}

.ap__intro {
  margin: 0;
  max-width: 70ch;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
}

.ap__actions,
.ap__card-actions {
  display: flex;
  gap: var(--ca-space-2);
  flex-wrap: wrap;
}

.ap__loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-8) 0;
}

.ap__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--ca-space-4);
}

.ap__card {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  padding: var(--ca-space-4);
  border: 1px solid var(--ca-border-subtle, var(--ca-border));
  border-radius: var(--ca-radius-large, 12px);
  background: var(--ca-bg-surface, transparent);
}

.ap__card--inactive {
  opacity: 0.65;
}

.ap__card-head {
  display: flex;
  gap: var(--ca-space-3);
  align-items: center;
}

.ap__card-title {
  flex: 1;
  min-width: 0;
}

.ap__card-title h3 {
  margin: 0;
  font-size: var(--ca-text-300);
  color: var(--ca-fg-1);
}

.ap__muted {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  margin: 0;
}

.ap__desc {
  margin: 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ap__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.ap__chip-label {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
  margin-right: 4px;
}

.ap__card-actions {
  margin-top: auto;
}

.ap__templates {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.ap__template {
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-4);
  align-items: center;
  padding: var(--ca-space-3);
  border: 1px solid var(--ca-border-subtle, var(--ca-border));
  border-radius: var(--ca-radius-medium, 8px);
}
</style>
