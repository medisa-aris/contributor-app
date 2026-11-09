<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  createGroup,
  deleteGroup,
  updateGroup,
  type AgentGroup,
  type GroupMode,
  type PersonalAgent,
} from '@/api/subordinate';
import { useToastStore } from '@/stores/toast.store';
import {
  CaBadge,
  CaButton,
  CaCheckbox,
  CaDialog,
  CaEmptyState,
  CaField,
  CaInput,
  CaRadioGroup,
  CaSelect,
  CaSpinner,
  CaTextarea,
  type CaSelectOption,
} from '@/components/ui';
import type { CaRadioOption } from '@/components/ui/CaRadioGroup.vue';
import AgentAvatar from './AgentAvatar.vue';

const props = defineProps<{ groups: AgentGroup[]; agents: PersonalAgent[]; loading: boolean }>();
const emit = defineEmits<{ changed: []; assign: [groupId: string] }>();

const { t } = useI18n();
const toast = useToastStore();

const open = ref(false);
const editing = ref<AgentGroup | null>(null);
const saving = ref(false);
const error = ref('');
const form = reactive({
  name: '',
  description: '',
  mode: 'delegate' as GroupMode,
  leaderAgentId: '',
  memberAgentIds: [] as string[],
  maxRounds: '3',
});

const modeOptions = computed<CaRadioOption[]>(() => [
  { value: 'delegate', label: t('subordinate.groups.modeDelegate'), description: t('subordinate.groups.modeDelegateHint') },
  {
    value: 'discussion',
    label: t('subordinate.groups.modeDiscussion'),
    description: t('subordinate.groups.modeDiscussionHint'),
  },
]);

const leaderOptions = computed<CaSelectOption[]>(() =>
  props.agents.map((agent) => ({ value: agent.id, label: agent.name })),
);

const agentById = (id: string) => props.agents.find((agent) => agent.id === id);

function openEditor(group: AgentGroup | null): void {
  editing.value = group;
  Object.assign(form, {
    name: group?.name ?? '',
    description: group?.description ?? '',
    mode: group?.mode ?? 'delegate',
    leaderAgentId: group?.leader_agent_id ?? props.agents[0]?.id ?? '',
    memberAgentIds: group?.members.map((m) => m.id).filter((id) => id !== group.leader_agent_id) ?? [],
    maxRounds: String(group?.max_rounds ?? 3),
  });
  error.value = '';
  open.value = true;
}

function toggleMember(id: string, on: boolean): void {
  form.memberAgentIds = on ? [...new Set([...form.memberAgentIds, id])] : form.memberAgentIds.filter((m) => m !== id);
}

const valid = computed(
  () =>
    form.name.trim().length >= 2 &&
    Boolean(form.leaderAgentId) &&
    form.memberAgentIds.filter((id) => id !== form.leaderAgentId).length >= 1,
);

async function submit(): Promise<void> {
  if (!valid.value) {
    error.value = t('subordinate.groups.invalid');
    return;
  }
  saving.value = true;
  error.value = '';
  const payload = {
    name: form.name.trim(),
    description: form.description.trim(),
    mode: form.mode,
    leaderAgentId: form.leaderAgentId,
    memberAgentIds: form.memberAgentIds.filter((id) => id !== form.leaderAgentId),
    maxRounds: Number(form.maxRounds) || 3,
  };
  try {
    if (editing.value) await updateGroup(editing.value.id, payload);
    else await createGroup(payload);
    open.value = false;
    emit('changed');
    toast.push({ variant: 'success', title: t('subordinate.groups.saved') });
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function remove(group: AgentGroup): Promise<void> {
  if (!window.confirm(t('subordinate.groups.deleteConfirm', { name: group.name }))) return;
  try {
    await deleteGroup(group.id);
    emit('changed');
    toast.push({ variant: 'success', title: t('subordinate.groups.deleted') });
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') });
  }
}
</script>

<template>
  <section class="gp">
    <div class="gp__head">
      <p class="gp__intro">{{ t('subordinate.groups.intro') }}</p>
      <CaButton variant="primary" :disabled="agents.length < 2" @click="openEditor(null)">
        {{ t('subordinate.groups.create') }}
      </CaButton>
    </div>
    <p v-if="agents.length < 2" class="gp__muted">{{ t('subordinate.groups.needAgents') }}</p>

    <div v-if="loading" class="gp__loading"><CaSpinner /></div>
    <CaEmptyState
      v-else-if="groups.length === 0"
      :title="t('subordinate.groups.emptyTitle')"
      :description="t('subordinate.groups.emptyDescription')"
    />
    <ul v-else class="gp__grid">
      <li v-for="group in groups" :key="group.id" class="gp__card">
        <div class="gp__card-head">
          <h3>{{ group.name }}</h3>
          <CaBadge size="small" :variant="group.mode === 'delegate' ? 'brand' : 'informative'">
            {{ group.mode === 'delegate' ? t('subordinate.groups.modeDelegate') : t('subordinate.groups.modeDiscussion') }}
          </CaBadge>
        </div>
        <p v-if="group.description" class="gp__muted">{{ group.description }}</p>
        <ul class="gp__members">
          <li v-for="member in group.members" :key="member.id" class="gp__member">
            <AgentAvatar :name="member.name" :color="member.avatar_color" :size="24" />
            <span>{{ member.name }}</span>
            <CaBadge v-if="member.id === group.leader_agent_id" size="small" variant="warning">Leader</CaBadge>
          </li>
        </ul>
        <span class="gp__muted">
          {{ t('subordinate.agents.taskCount', { count: group.task_count }) }}
          <template v-if="group.mode === 'discussion'"> · {{ t('subordinate.groups.rounds', { count: group.max_rounds }) }}</template>
        </span>
        <div class="gp__actions">
          <CaButton size="small" variant="primary" @click="emit('assign', group.id)">{{ t('subordinate.agents.assign') }}</CaButton>
          <CaButton size="small" variant="secondary" @click="openEditor(group)">{{ t('common.edit') }}</CaButton>
          <CaButton size="small" variant="danger" @click="remove(group)">{{ t('common.delete') }}</CaButton>
        </div>
      </li>
    </ul>

    <CaDialog
      v-model:open="open"
      size="large"
      :title="editing ? t('subordinate.groups.editTitle') : t('subordinate.groups.createTitle')"
      :subtitle="t('subordinate.groups.editorSubtitle')"
    >
      <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
      <form class="admin-form" @submit.prevent="submit">
        <CaField :label="t('subordinate.groups.name')" required>
          <template #default="{ id }"><CaInput :id="id" v-model="form.name" /></template>
        </CaField>
        <CaField :label="t('subordinate.agents.description')">
          <template #default="{ id }"><CaTextarea :id="id" v-model="form.description" :rows="2" /></template>
        </CaField>
        <CaRadioGroup v-model="form.mode" :options="modeOptions" />
        <CaField :label="t('subordinate.groups.leader')" required>
          <template #default="{ id }">
            <CaSelect :id="id" v-model="form.leaderAgentId" :options="leaderOptions" />
          </template>
        </CaField>
        <fieldset class="gp__fieldset">
          <legend>{{ t('subordinate.groups.members') }}</legend>
          <div class="gp__checks">
            <CaCheckbox
              v-for="agent in agents.filter((a) => a.id !== form.leaderAgentId)"
              :key="agent.id"
              :model-value="form.memberAgentIds.includes(agent.id)"
              :label="agent.name"
              @update:model-value="(v: boolean) => toggleMember(agent.id, v)"
            />
          </div>
        </fieldset>
        <CaField v-if="form.mode === 'discussion'" :label="t('subordinate.groups.maxRounds')" :hint="t('subordinate.groups.maxRoundsHint')">
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="form.maxRounds" inputmode="numeric" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <p v-if="agentById(form.leaderAgentId)" class="gp__muted">
          {{ form.mode === 'delegate' ? t('subordinate.groups.delegatePreview', { leader: agentById(form.leaderAgentId)!.name }) : t('subordinate.groups.discussionPreview') }}
        </p>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="open = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="saving" :disabled="!valid" @click="submit">{{ t('common.save') }}</CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.gp__head {
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--ca-space-4);
}

.gp__intro,
.gp__muted {
  margin: 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.gp__intro {
  max-width: 70ch;
}

.gp__loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-8) 0;
}

.gp__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--ca-space-4);
}

.gp__card {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  padding: var(--ca-space-4);
  border: 1px solid var(--ca-border-subtle, var(--ca-border));
  border-radius: var(--ca-radius-large, 12px);
}

.gp__card-head {
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-3);
  align-items: center;
}

.gp__card-head h3 {
  margin: 0;
  font-size: var(--ca-text-300);
}

.gp__members {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gp__member {
  display: flex;
  gap: var(--ca-space-2);
  align-items: center;
  font-size: var(--ca-text-200);
}

.gp__actions {
  display: flex;
  gap: var(--ca-space-2);
  flex-wrap: wrap;
  margin-top: auto;
}

.gp__fieldset {
  border: 1px solid var(--ca-border-subtle, var(--ca-border));
  border-radius: var(--ca-radius-medium, 8px);
  padding: var(--ca-space-3) var(--ca-space-4);
  margin: 0;
}

.gp__checks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--ca-space-2);
}
</style>
