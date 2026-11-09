<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import { createTask, runTask } from '@/api/ai';
import { createAgentTask, type AgentGroup, type PersonalAgent } from '@/api/subordinate';
import WebSearchToggle from '@/components/ai/WebSearchToggle.vue';
import { useAuthStore } from '@/stores/auth.store';
import { CaButton, CaDialog, CaField, CaInput, CaSelect, CaTextarea, type CaSelectOption } from '@/components/ui';

/** Target tugas: `agent:<id>`, `group:<id>`, atau `general` (asisten umum tanpa agent). */
const props = defineProps<{ agents: PersonalAgent[]; groups: AgentGroup[]; initialTarget?: string | null }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ created: [taskId: string, runner: boolean] }>();

const { t } = useI18n();
const auth = useAuthStore();
const target = ref('general');
const title = ref('');
const instruction = ref('');
const webSearch = ref(false);
const saving = ref(false);
const error = ref('');

const options = computed<CaSelectOption[]>(() => [
  ...props.agents
    .filter((agent) => agent.status === 'active')
    .map((agent) => ({ value: `agent:${agent.id}`, label: `${t('subordinate.tasks.targetAgent')}: ${agent.name}` })),
  ...props.groups.map((group) => ({
    value: `group:${group.id}`,
    label: `${t('subordinate.tasks.targetGroup')}: ${group.name} (${group.mode === 'delegate' ? t('subordinate.groups.modeDelegate') : t('subordinate.groups.modeDiscussion')})`,
  })),
  { value: 'general', label: t('subordinate.tasks.targetGeneral') },
]);

watch(open, (value) => {
  if (!value) return;
  target.value = props.initialTarget ?? (props.agents[0] ? `agent:${props.agents[0].id}` : 'general');
  title.value = '';
  instruction.value = '';
  webSearch.value = false;
  error.value = '';
});

async function submit(): Promise<void> {
  const text = instruction.value.trim();
  if (text.length < 5) {
    error.value = t('workspace.subordinate.instructionRequired');
    return;
  }
  saving.value = true;
  error.value = '';
  const web = auth.can('ai.websearch.use') && webSearch.value ? { webSearch: true } : {};
  try {
    if (target.value === 'general') {
      const task = await createTask({ title: title.value.trim() || text.slice(0, 80), instruction: text, ...web });
      open.value = false;
      emit('created', task.id, false);
      void runTask(task.id).catch(() => undefined);
      return;
    }
    const [kind, id] = target.value.split(':') as ['agent' | 'group', string];
    const task = await createAgentTask({
      instruction: text,
      ...(title.value.trim() ? { title: title.value.trim() } : {}),
      ...(kind === 'agent' ? { agentId: id } : { groupId: id }),
      ...web,
    });
    open.value = false;
    emit('created', task.id, true);
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <CaDialog v-model:open="open" size="large" :title="t('subordinate.tasks.newTitle')" :subtitle="t('subordinate.tasks.newSubtitle')">
    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <form class="admin-form" @submit.prevent="submit">
      <CaField :label="t('subordinate.tasks.target')" required>
        <template #default="{ id }"><CaSelect :id="id" v-model="target" :options="options" /></template>
      </CaField>
      <CaField :label="t('workspace.subordinate.formTitle')" :hint="t('subordinate.tasks.titleHint')">
        <template #default="{ id, describedBy }"><CaInput :id="id" v-model="title" :aria-describedby="describedBy" /></template>
      </CaField>
      <CaField
        :label="t('workspace.subordinate.formInstruction')"
        :hint="t('subordinate.tasks.instructionHint')"
        required
      >
        <template #default="{ id, describedBy }">
          <CaTextarea :id="id" v-model="instruction" :aria-describedby="describedBy" :rows="7" />
        </template>
      </CaField>
      <WebSearchToggle v-model="webSearch" :disabled="saving" />
    </form>
    <template #footer>
      <CaButton variant="secondary" @click="open = false">{{ t('common.cancel') }}</CaButton>
      <CaButton variant="primary" :loading="saving" @click="submit">{{ t('subordinate.tasks.start') }}</CaButton>
    </template>
  </CaDialog>
</template>
