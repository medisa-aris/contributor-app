<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import { createSkill, deleteSkill, updateSkill, type Skill } from '@/api/subordinate';
import { useToastStore } from '@/stores/toast.store';
import { CaBadge, CaButton, CaDialog, CaEmptyState, CaField, CaInput, CaSpinner, CaTextarea } from '@/components/ui';
import MarkdownContent from '@/components/ai/MarkdownContent.vue';

defineProps<{ skills: Skill[]; loading: boolean }>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const toast = useToastStore();

const open = ref(false);
const editing = ref<Skill | null>(null);
const viewing = ref<Skill | null>(null);
const saving = ref(false);
const error = ref('');
const form = reactive({ name: '', description: '', instructions: '' });

function openEditor(skill: Skill | null): void {
  editing.value = skill;
  Object.assign(form, {
    name: skill?.name ?? '',
    description: skill?.description ?? '',
    instructions: skill?.instructions ?? '',
  });
  error.value = '';
  open.value = true;
}

async function submit(): Promise<void> {
  if (form.name.trim().length < 2 || form.description.trim().length < 5 || form.instructions.trim().length < 10) {
    error.value = t('subordinate.skills.invalid');
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      instructions: form.instructions.trim(),
    };
    if (editing.value) await updateSkill(editing.value.id, payload);
    else await createSkill(payload);
    open.value = false;
    emit('changed');
    toast.push({ variant: 'success', title: t('subordinate.skills.saved') });
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function remove(skill: Skill): Promise<void> {
  if (!window.confirm(t('subordinate.skills.deleteConfirm', { name: skill.name }))) return;
  try {
    await deleteSkill(skill.id);
    emit('changed');
    toast.push({ variant: 'success', title: t('subordinate.skills.deleted') });
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') });
  }
}
</script>

<template>
  <section class="sp">
    <div class="sp__head">
      <p class="sp__intro">{{ t('subordinate.skills.intro') }}</p>
      <CaButton variant="primary" @click="openEditor(null)">{{ t('subordinate.skills.create') }}</CaButton>
    </div>
    <div v-if="loading" class="sp__loading"><CaSpinner /></div>
    <CaEmptyState
      v-else-if="skills.length === 0"
      :title="t('subordinate.skills.emptyTitle')"
      :description="t('subordinate.skills.emptyDescription')"
    />
    <ul v-else class="sp__list">
      <li v-for="skill in skills" :key="skill.id" class="sp__item">
        <div class="sp__info">
          <div class="sp__title">
            <strong>{{ skill.name }}</strong>
            <CaBadge v-if="skill.is_global" size="small" variant="informative" no-icon>{{ t('subordinate.skills.global') }}</CaBadge>
            <span class="sp__muted">{{ t('subordinate.skills.usedBy', { count: skill.agent_count }) }}</span>
          </div>
          <p class="sp__muted">{{ skill.description }}</p>
        </div>
        <div class="sp__actions">
          <CaButton size="small" variant="subtle" @click="viewing = skill">{{ t('subordinate.skills.view') }}</CaButton>
          <template v-if="!skill.is_global">
            <CaButton size="small" variant="secondary" @click="openEditor(skill)">{{ t('common.edit') }}</CaButton>
            <CaButton size="small" variant="danger" @click="remove(skill)">{{ t('common.delete') }}</CaButton>
          </template>
        </div>
      </li>
    </ul>

    <CaDialog
      v-model:open="open"
      size="large"
      :title="editing ? t('subordinate.skills.editTitle') : t('subordinate.skills.createTitle')"
      :subtitle="t('subordinate.skills.editorSubtitle')"
    >
      <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
      <form class="admin-form" @submit.prevent="submit">
        <CaField :label="t('subordinate.skills.name')" required>
          <template #default="{ id }"><CaInput :id="id" v-model="form.name" /></template>
        </CaField>
        <CaField :label="t('subordinate.skills.description')" :hint="t('subordinate.skills.descriptionHint')" required>
          <template #default="{ id, describedBy }">
            <CaInput :id="id" v-model="form.description" :aria-describedby="describedBy" />
          </template>
        </CaField>
        <CaField :label="t('subordinate.skills.instructions')" :hint="t('subordinate.skills.instructionsHint')" required>
          <template #default="{ id, describedBy }">
            <CaTextarea :id="id" v-model="form.instructions" :aria-describedby="describedBy" :rows="12" />
          </template>
        </CaField>
      </form>
      <template #footer>
        <CaButton variant="secondary" @click="open = false">{{ t('common.cancel') }}</CaButton>
        <CaButton variant="primary" :loading="saving" @click="submit">{{ t('common.save') }}</CaButton>
      </template>
    </CaDialog>

    <CaDialog
      :open="viewing !== null"
      size="large"
      :title="viewing?.name ?? ''"
      :subtitle="viewing?.description ?? ''"
      @update:open="(v: boolean) => { if (!v) viewing = null; }"
    >
      <MarkdownContent v-if="viewing" :content="viewing.instructions" />
      <template #footer>
        <CaButton variant="secondary" @click="viewing = null">{{ t('common.close') }}</CaButton>
      </template>
    </CaDialog>
  </section>
</template>

<style scoped>
.sp__head {
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--ca-space-4);
}

.sp__intro,
.sp__muted {
  margin: 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.sp__intro {
  max-width: 70ch;
}

.sp__loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-8) 0;
}

.sp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
}

.sp__item {
  display: flex;
  justify-content: space-between;
  gap: var(--ca-space-4);
  align-items: center;
  flex-wrap: wrap;
  padding: var(--ca-space-3) var(--ca-space-4);
  border: 1px solid var(--ca-stroke-2, var(--ca-stroke-2));
  border-radius: var(--ca-radius-xl, 8px);
}

.sp__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 280px;
}

.sp__title {
  display: flex;
  gap: var(--ca-space-2);
  align-items: center;
  flex-wrap: wrap;
}

.sp__actions {
  display: flex;
  gap: var(--ca-space-2);
}
</style>
