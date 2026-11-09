<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { listAvailableConnectors, type AvailableConnector } from '@/api/connectors';
import {
  listAgents,
  listGroups,
  listSkills,
  type AgentGroup,
  type PersonalAgent,
  type Skill,
} from '@/api/subordinate';
import { useAuthStore } from '@/stores/auth.store';
import { CaPageHeader, CaTabs } from '@/components/ui';
import type { CaTabItem } from '@/components/ui/CaTabs.vue';
import AgentsPanel from '@/components/subordinate/AgentsPanel.vue';
import GroupsPanel from '@/components/subordinate/GroupsPanel.vue';
import NewTaskDialog from '@/components/subordinate/NewTaskDialog.vue';
import SkillsPanel from '@/components/subordinate/SkillsPanel.vue';
import TaskBoard from '@/components/subordinate/TaskBoard.vue';
import TaskThread from '@/components/subordinate/TaskThread.vue';

const { t } = useI18n();
const auth = useAuthStore();
const canManage = computed(() => auth.can('ai.agents.manage'));

const tab = ref('tasks');
const agents = ref<PersonalAgent[]>([]);
const groups = ref<AgentGroup[]>([]);
const skills = ref<Skill[]>([]);
const connectors = ref<AvailableConnector[]>([]);
const loading = ref(true);

const board = ref<InstanceType<typeof TaskBoard> | null>(null);
const newOpen = ref(false);
const newTarget = ref<string | null>(null);
const threadOpen = ref(false);
const threadId = ref<string | null>(null);

const tabs = computed<CaTabItem[]>(() => [
  { key: 'tasks', label: t('subordinate.tabs.tasks') },
  ...(canManage.value
    ? [
        { key: 'agents', label: t('subordinate.tabs.agents'), count: agents.value.length },
        { key: 'groups', label: t('subordinate.tabs.groups'), count: groups.value.length },
        { key: 'skills', label: t('subordinate.tabs.skills'), count: skills.value.length },
      ]
    : []),
]);

async function loadAll(): Promise<void> {
  if (!canManage.value) {
    loading.value = false;
    return;
  }
  const [a, g, s, c] = await Promise.allSettled([
    listAgents(),
    listGroups(),
    listSkills(),
    auth.can('connectors.use') ? listAvailableConnectors() : Promise.resolve([]),
  ]);
  agents.value = a.status === 'fulfilled' ? a.value : [];
  groups.value = g.status === 'fulfilled' ? g.value : [];
  skills.value = s.status === 'fulfilled' ? s.value : [];
  connectors.value = c.status === 'fulfilled' ? c.value : [];
  loading.value = false;
}

onMounted(loadAll);

function assign(target: string): void {
  newTarget.value = target;
  newOpen.value = true;
}

function onCreated(taskId: string): void {
  tab.value = 'tasks';
  void board.value?.reload();
  threadId.value = taskId;
  threadOpen.value = true;
}

function openTask(id: string): void {
  threadId.value = id;
  threadOpen.value = true;
}
</script>

<template>
  <div class="sub">
    <CaPageHeader :title="t('workspace.subordinate.title')" :description="t('subordinate.description')" />
    <CaTabs v-model="tab" :items="tabs" class="sub__tabs" />

    <TaskBoard v-if="tab === 'tasks'" ref="board" :agents="agents" @open="openTask" @create="assign(null as unknown as string)" />
    <AgentsPanel
      v-else-if="tab === 'agents'"
      :agents="agents"
      :skills="skills"
      :connectors="connectors"
      :loading="loading"
      @changed="loadAll"
      @assign="(id: string) => assign(`agent:${id}`)"
    />
    <GroupsPanel
      v-else-if="tab === 'groups'"
      :groups="groups"
      :agents="agents"
      :loading="loading"
      @changed="loadAll"
      @assign="(id: string) => assign(`group:${id}`)"
    />
    <SkillsPanel v-else :skills="skills" :loading="loading" @changed="loadAll" />

    <NewTaskDialog
      v-model:open="newOpen"
      :agents="agents"
      :groups="groups"
      :initial-target="newTarget"
      @created="onCreated"
    />
    <TaskThread v-model:open="threadOpen" :task-id="threadId" :agents="agents" @changed="board?.reload()" />
  </div>
</template>

<style scoped>
.sub__tabs {
  margin-bottom: var(--ca-space-5, 20px);
}
</style>
