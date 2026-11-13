<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import { listAgents, type AgentRow } from '@/api/agents';
import { useAuthStore } from '@/stores/auth.store';
import {
  CaBadge,
  CaButton,
  CaCard,
  CaIcon,
  CaPageHeader,
  CaSegmented,
} from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();

const canExecute = computed(() => auth.can('agents.execute'));
const canManage = computed(
  () =>
    auth.can('agents.create') || auth.can('agents.update') || auth.can('agents.delete'),
);

const agents = ref<AgentRow[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await listAgents({ page: 1, pageSize: 100 });
    agents.value = result.items;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

type ApprovalFilter = 'all' | 'approval' | 'direct';
const filter = ref<ApprovalFilter>('all');

const counts = computed(() => ({
  all: agents.value.length,
  approval: agents.value.filter((a) => a.require_approval).length,
  direct: agents.value.filter((a) => !a.require_approval).length,
  active: agents.value.filter((a) => a.status === 'active').length,
  tools: agents.value.reduce((sum, a) => sum + a.tool_allowlist.length, 0),
}));

const filterItems = computed(() => [
  { key: 'all' as const, label: t('agents.filterAll', { n: counts.value.all }) },
  { key: 'approval' as const, label: t('agents.filterApproval', { n: counts.value.approval }) },
  { key: 'direct' as const, label: t('agents.filterDirect', { n: counts.value.direct }) },
]);

const visibleAgents = computed(() =>
  agents.value.filter((a) =>
    filter.value === 'all' ? true : filter.value === 'approval' ? a.require_approval : !a.require_approval,
  ),
);

const HOW_STEPS = ['instruction', 'agent', 'approval', 'tools', 'result'] as const;

function statusVariant(agent: AgentRow): 'success' | 'neutral' {
  return agent.status === 'active' ? 'success' : 'neutral';
}

function statusLabel(agent: AgentRow): string {
  return agent.status === 'active' ? t('agents.statusActive') : t('agents.statusInactive');
}
</script>

<template>
  <div>
    <CaPageHeader :title="t('agents.catalogTitle')" :description="t('agents.catalogDescription')">
      <template #actions>
        <CaButton v-if="canManage" variant="secondary" to="/agents/definitions">
          {{ t('agents.manageDefinitions') }}
        </CaButton>
        <CaButton v-if="canExecute" variant="primary" to="/agents/operations">
          {{ t('agents.goOperations') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <p v-if="!loading && agents.length === 0 && !error" class="agents-empty">
      {{ t('agents.catalogEmpty') }}
    </p>

    <section class="ca-panel agents-how" aria-labelledby="agents-how">
      <div class="agents-section-head">
        <h2 id="agents-how" class="ca-panel__title">{{ t('agents.howTitle') }}</h2>
        <span class="agents-muted">
          {{ t('agents.howSummary', { active: counts.active, approval: counts.approval, tools: counts.tools }) }}
        </span>
      </div>
      <ol class="agents-steps">
        <li v-for="(step, index) in HOW_STEPS" :key="step" class="agents-step">
          <span class="agents-step__num" aria-hidden="true">{{ index + 1 }}</span>
          <span class="agents-step__title">{{ t(`agents.howSteps.${step}.title`) }}</span>
          <span class="agents-muted">{{ t(`agents.howSteps.${step}.desc`) }}</span>
        </li>
      </ol>
    </section>

    <div class="agents-section-head agents-list-head">
      <h2 class="ca-panel__title">{{ t('agents.listTitle') }}</h2>
      <CaSegmented v-model="filter" :items="filterItems" :label="t('agents.filterLabel')" />
    </div>

    <div class="agents-grid">
      <CaCard v-for="agent in visibleAgents" :key="agent.id">
        <div class="agents-card">
          <div class="agents-card__icon" aria-hidden="true">
            <CaIcon name="bot" :size="28" />
          </div>
          <div class="agents-card__main">
            <div class="agents-card__head">
              <h2 class="agents-card__name">{{ agent.name }}</h2>
              <div class="agents-card__badges">
                <CaBadge :variant="statusVariant(agent)" size="small">
                  {{ statusLabel(agent) }}
                </CaBadge>
                <CaBadge v-if="agent.require_approval" variant="warning" size="small">
                  {{ t('agents.approvalRequired') }}
                </CaBadge>
                <CaBadge v-else variant="neutral" size="small">{{ t('agents.runsDirect') }}</CaBadge>
              </div>
            </div>
            <p v-if="agent.description" class="agents-card__desc">{{ agent.description }}</p>
            <p class="agents-card__meta">
              <span class="agents-card__code">{{ agent.code }}</span>
              <span>{{ t('agents.taskCount', { count: agent.task_count ?? 0 }) }}</span>
            </p>
            <p class="agents-card__tools">
              {{ t('agents.toolCount', { count: agent.tool_allowlist.length }) }}
            </p>
          </div>
          <div class="agents-card__actions">
            <CaButton
              v-if="canExecute && agent.status === 'active'"
              size="small"
              variant="primary"
              :to="`/agents/operations?agent=${agent.id}`"
            >
              {{ t('agents.runAction') }}
            </CaButton>
          </div>
        </div>
      </CaCard>
    </div>
  </div>
</template>

<style scoped>
.agents-how {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-8);
  margin-bottom: var(--ca-space-12);
}

.agents-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-6);
}

.agents-list-head {
  margin-bottom: var(--ca-space-8);
}

.agents-muted {
  color: var(--ca-fg-3);
}

.agents-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--ca-space-6);
}

.agents-step {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
  padding: var(--ca-space-6);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface-2);
}

.agents-step__num {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ca-radius-circular);
  background: var(--ca-color-brand-strong);
  color: var(--ca-fg-on-brand-strong);
  font-size: var(--ca-text-200);
  font-weight: var(--ca-font-weight-semibold);
}

.agents-step__title {
  font-weight: var(--ca-font-weight-semibold);
}

.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: var(--ca-space-6);
}

.agents-card {
  display: flex;
  gap: var(--ca-space-5);
  align-items: flex-start;
}

.agents-card__icon {
  flex: none;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ca-radius-xl);
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand-text);
}

.agents-card__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.agents-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
}

.agents-card__name {
  margin: 0;
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}

.agents-card__badges {
  display: flex;
  gap: var(--ca-space-3);
}

.agents-card__desc {
  margin: 0;
  font-size: var(--ca-text-300);
  color: var(--ca-fg-2);
}

.agents-card__meta {
  margin: 0;
  display: flex;
  gap: var(--ca-space-4);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.agents-card__code {
  font-family: var(--ca-font-family-monospace, monospace);
}

.agents-card__tools {
  margin: 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.agents-card__actions {
  flex: none;
  align-self: center;
}

.agents-empty {
  margin: 0 0 var(--ca-space-6);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-300);
}
</style>
