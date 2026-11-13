<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { DashboardHighlightDto, DashboardSummaryDto, NavMenuItemDto } from '@bara/shared';
import { apiGet } from '@/api/http';
import { listConversations } from '@/api/ai';
import type { ConversationSummary } from '@/api/ai/types';
import { useAuthStore } from '@/stores/auth.store';
import { useNavigationStore } from '@/stores/navigation.store';
import { formatDateTime } from '@/utils/format';
import { CaButton, CaEmptyState, CaIcon, CaPageHeader, CaStatCard } from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const navigation = useNavigationStore();

const summary = ref<DashboardSummaryDto | null>(null);
const recent = ref<ConversationSummary[]>([]);
const canHistory = computed(() => auth.can('ai.workspace.history.read'));

interface Hub {
  id: string;
  name: string;
  count: number;
  menus: string;
  to: string;
}

const hubs = computed<Hub[]>(() =>
  navigation.applications
    .map((app) => {
      const items = [...app.items, ...app.modules.flatMap((m) => m.items)].filter(
        (item): item is NavMenuItemDto & { routePath: string } => item.routePath !== null,
      );
      return {
        id: app.id,
        name: app.name,
        count: items.length,
        menus: items
          .slice(0, 4)
          .map((i) => i.label)
          .join(' · '),
        to: items[0]?.routePath ?? '/',
      };
    })
    .filter((hub) => hub.count > 0),
);

const stackOrder = ref<number[]>([]);
const highlights = computed<DashboardHighlightDto[]>(() => summary.value?.highlights.slice(0, 3) ?? []);
const stacked = computed(() =>
  stackOrder.value.map((index, depth) => ({ depth, item: highlights.value[index]! })).reverse(),
);

function bringToFront(depth: number): void {
  const next = [...stackOrder.value];
  const [picked] = next.splice(depth, 1);
  stackOrder.value = [picked!, ...next];
}

function chatRoute(conversation: ConversationSummary): string {
  const base = conversation.mode === 'counterpart' ? '/workspace/counterpart' : '/workspace/second-brain';
  return `${base}?c=${conversation.id}`;
}

onMounted(async () => {
  const [summaryResult, recentResult] = await Promise.allSettled([
    apiGet<DashboardSummaryDto>('/dashboard/summary'),
    canHistory.value ? listConversations({ page: 1, pageSize: 5 }) : Promise.resolve(null),
  ]);
  if (summaryResult.status === 'fulfilled') {
    summary.value = summaryResult.value;
    stackOrder.value = summaryResult.value.highlights.slice(0, 3).map((_, i) => i);
  }
  if (recentResult.status === 'fulfilled' && recentResult.value) {
    recent.value = recentResult.value.items;
  }
});
</script>

<template>
  <div class="home">
    <CaPageHeader :title="t('home.title', { name: auth.user?.displayName ?? '' })" :description="t('home.subtitle')">
      <template #actions>
        <CaButton v-if="auth.can('ai.subordinate.execute')" to="/workspace/subordinate">{{ t('home.delegate') }}</CaButton>
        <CaButton v-if="auth.can('ai.secondbrain.query')" variant="primary" to="/workspace/second-brain">
          <template #icon-start><CaIcon name="add" :size="16" /></template>
          {{ t('home.startChat') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <CaEmptyState v-if="hubs.length === 0" :title="t('home.emptyTitle')" :description="t('home.emptyDescription')" />

    <template v-else>
      <section v-if="summary" class="home__kpis" :aria-label="t('home.kpiLabel')">
        <CaStatCard
          v-if="summary.tasks"
          hero
          to="/workspace/subordinate"
          :label="t('home.tasksDone')"
          :value="summary.tasks.done"
          :hint="t('home.tasksDoneHint', { total: summary.tasks.total, stopped: summary.tasks.stopped })"
        />
        <CaStatCard
          v-if="summary.documents"
          to="/knowledge/documents"
          :label="t('home.docsIndexed')"
          :value="summary.documents.indexed"
          :tone="summary.documents.failed > 0 ? 'danger' : 'success'"
          :hint="
            summary.documents.failed > 0
              ? t('home.docsFailed', summary.documents)
              : t('home.docsHealthy', summary.documents)
          "
        />
        <CaStatCard
          v-if="summary.agents"
          to="/agents"
          :label="t('home.agentsActive')"
          :value="summary.agents.active"
          :tone="summary.agents.requiresApproval > 0 ? 'warning' : 'neutral'"
          :hint="
            summary.agents.requiresApproval > 0
              ? t('home.agentsApproval', { n: summary.agents.requiresApproval })
              : t('home.agentsDirect')
          "
        />
        <CaStatCard
          v-if="summary.approvals"
          to="/agents/approvals"
          :label="t('home.approvalsPending')"
          :value="summary.approvals.pending"
          :tone="summary.approvals.pending > 0 ? 'warning' : 'neutral'"
          :hint="summary.approvals.pending > 0 ? t('home.approvalsSome') : t('home.approvalsNone')"
        />
      </section>

      <div class="home__row">
        <section v-if="summary" class="home__card home__highlights" aria-labelledby="home-highlights">
          <div class="home__card-head">
            <h2 id="home-highlights" class="home__h2">{{ t('home.highlights') }}</h2>
            <span v-if="highlights.length > 1" class="home__caption">{{ t('home.highlightsHint') }}</span>
          </div>
          <p v-if="highlights.length === 0" class="home__muted">{{ t('home.highlightsEmpty') }}</p>
          <div v-else class="home__stack">
            <template v-for="card in stacked" :key="card.item.kind">
              <RouterLink
                v-if="card.depth === 0"
                :to="card.item.routePath"
                class="home__deck home__deck--front"
                :class="`home__deck--${card.item.kind}`"
              >
                <span class="home__deck-text">
                  <span class="home__deck-kind">
                    {{ t(`home.highlightKinds.${card.item.kind}`) }} · {{ formatDateTime(card.item.at) }}
                  </span>
                  <span class="home__deck-title">{{ card.item.title }}</span>
                </span>
                <span class="home__deck-open">
                  {{ t('home.highlightOpen') }} <CaIcon name="arrow-right" :size="16" />
                </span>
              </RouterLink>
              <button
                v-else
                type="button"
                class="home__deck home__deck--back"
                :class="`home__deck--depth-${card.depth}`"
                :aria-label="t('home.showCard', { title: card.item.title })"
                @click="bringToFront(card.depth)"
              >
                <span class="home__deck-kind">{{ t(`home.highlightKinds.${card.item.kind}`) }}</span>
              </button>
            </template>
          </div>
        </section>

        <section class="home__hubs" aria-labelledby="home-hubs">
          <h2 id="home-hubs" class="home__h2">{{ t('home.hubs') }}</h2>
          <div class="home__hub-grid">
            <RouterLink v-for="hub in hubs" :key="hub.id" :to="hub.to" class="home__hub">
              <span class="home__hub-head">
                <span class="home__hub-name">{{ hub.name }}</span>
                <span class="home__hub-count">{{ t('home.menuCount', { n: hub.count }) }}</span>
              </span>
              <span class="home__caption">{{ hub.menus }}</span>
            </RouterLink>
          </div>
        </section>
      </div>

      <section v-if="canHistory" class="home__card home__recent" aria-labelledby="home-recent">
        <div class="home__recent-head">
          <h2 id="home-recent" class="home__h2">{{ t('home.recent') }}</h2>
          <RouterLink to="/workspace/history" class="home__link">{{ t('home.seeHistory') }}</RouterLink>
        </div>
        <p v-if="recent.length === 0" class="home__muted home__recent-empty">{{ t('home.recentEmpty') }}</p>
        <div v-else class="home__table-wrap">
          <table class="home__table">
            <thead>
              <tr>
                <th scope="col">{{ t('home.colTitle') }}</th>
                <th scope="col">{{ t('home.colMode') }}</th>
                <th scope="col" class="home__num">{{ t('home.colUpdated') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="conversation in recent" :key="conversation.id">
                <td>
                  <RouterLink :to="chatRoute(conversation)" class="home__row-title">{{ conversation.title }}</RouterLink>
                </td>
                <td>
                  <span class="home__mode">{{ t(`home.modes.${conversation.mode}`) }}</span>
                </td>
                <td class="home__num home__muted">{{ formatDateTime(conversation.updated_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-12);
}

.home :deep(.page-header) {
  margin-bottom: 0;
}

.home__kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--ca-space-8);
}

.home__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-12);
  align-items: stretch;
}

.home__card {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
  padding: var(--ca-space-10);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  box-shadow: var(--ca-shadow-4);
}

.home__card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--ca-space-4);
}

.home__h2 {
  font-size: var(--ca-text-500);
  line-height: var(--ca-line-500);
  font-weight: var(--ca-font-weight-semibold);
}

.home__caption {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}

.home__muted {
  color: var(--ca-fg-3);
}

.home__highlights {
  flex: 1 1 360px;
  min-width: 0;
}

.home__stack {
  position: relative;
  height: 280px;
  perspective: 1200px;
}

.home__deck {
  position: absolute;
  left: var(--ca-space-12);
  top: 40px;
  width: min(300px, calc(100% - 96px));
  height: 190px;
  padding: var(--ca-space-10);
  box-sizing: border-box;
  border-radius: var(--ca-radius-xl);
  font: inherit;
  text-align: left;
  transform-origin: left center;
  transition:
    transform var(--ca-duration-unfold) var(--ca-curve-decelerate-mid),
    box-shadow var(--ca-duration-normal) var(--ca-curve-decelerate-mid);
}

.home__deck--front {
  z-index: 3;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--ca-color-brand-strong);
  color: var(--ca-fg-on-brand-strong);
  text-decoration: none;
  transform: rotateY(-14deg);
  box-shadow: var(--ca-shadow-28);
}

.home__deck--front:hover {
  color: var(--ca-fg-on-brand-strong);
  text-decoration: none;
  transform: rotateY(-8deg) translateX(4px);
}

.home__deck--front.home__deck--taskFailed {
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  border: 1px solid var(--ca-danger-stroke);
}

.home__deck--front.home__deck--taskFailed:hover {
  color: var(--ca-fg-1);
}

.home__deck-text {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.home__deck-kind {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}

.home__deck-title {
  font-size: var(--ca-text-500);
  line-height: var(--ca-line-500);
  font-weight: var(--ca-font-weight-semibold);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.home__deck-open {
  display: inline-flex;
  align-items: center;
  gap: var(--ca-space-3);
  font-weight: var(--ca-font-weight-semibold);
}

.home__deck--back {
  display: flex;
  align-items: flex-start;
  border: 1px solid var(--ca-stroke-2);
  color: var(--ca-fg-3);
  font-weight: var(--ca-font-weight-semibold);
  cursor: pointer;
}

.home__deck--depth-1 {
  z-index: 2;
  background: var(--ca-bg-surface);
  transform: translate3d(36px, -18px, -90px) rotateY(-14deg);
  box-shadow: var(--ca-shadow-8);
}

.home__deck--depth-2 {
  z-index: 1;
  background: var(--ca-bg-surface-2);
  transform: translate3d(72px, -36px, -180px) rotateY(-14deg);
  box-shadow: var(--ca-shadow-4);
}

.home__deck--back:hover {
  box-shadow: var(--ca-shadow-16);
}

.home__hubs {
  flex: 2 1 560px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-6);
}

.home__hub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--ca-space-8);
}

.home__hub {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-4);
  padding: var(--ca-space-10);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  box-shadow: var(--ca-shadow-4);
  color: var(--ca-fg-1);
  text-decoration: none;
  transition: box-shadow var(--ca-duration-normal) var(--ca-curve-decelerate-mid);
}

.home__hub:hover {
  box-shadow: var(--ca-shadow-8);
  color: var(--ca-fg-1);
  text-decoration: none;
}

.home__hub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
}

.home__hub-name {
  font-size: var(--ca-text-400);
  line-height: var(--ca-line-400);
  font-weight: var(--ca-font-weight-semibold);
}

.home__hub-count {
  flex: none;
  padding: var(--ca-space-1) var(--ca-space-4);
  border-radius: var(--ca-radius-md);
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand-text);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
}

.home__recent {
  padding: 0;
  gap: 0;
  overflow: hidden;
}

.home__recent-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ca-space-4);
  padding: var(--ca-space-8) var(--ca-space-10);
  border-bottom: 1px solid var(--ca-stroke-2);
}

.home__recent-empty {
  padding: var(--ca-space-10);
}

.home__link {
  font-weight: var(--ca-font-weight-semibold);
}

.home__table-wrap {
  overflow-x: auto;
}

.home__table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
}

.home__table th {
  padding: var(--ca-space-4) var(--ca-space-10);
  background: var(--ca-bg-surface-2);
  color: var(--ca-fg-3);
  font-weight: var(--ca-font-weight-semibold);
  text-align: left;
}

.home__table td {
  padding: var(--ca-space-5) var(--ca-space-10);
  border-top: 1px solid var(--ca-stroke-2);
}

.home__num {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.home__row-title {
  color: var(--ca-fg-1);
  font-weight: var(--ca-font-weight-semibold);
}

.home__mode {
  display: inline-block;
  padding: var(--ca-space-1) var(--ca-space-4);
  border-radius: var(--ca-radius-md);
  border: 1px solid var(--ca-stroke-2);
  background: var(--ca-bg-surface-2);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
}
</style>
