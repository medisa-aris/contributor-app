<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import { DB_ENGINE_LABELS, type AvailableConnector, type ConnectorAccess, type DbEngine } from '@/api/connectors';
import {
  createAgent,
  updateAgent,
  type PersonalAgent,
  type PersonalAgentInput,
  type Skill,
} from '@/api/subordinate';
import { CaButton, CaCheckbox, CaDialog, CaField, CaInput, CaSwitch, CaTextarea } from '@/components/ui';

const props = defineProps<{
  agent: PersonalAgent | null;
  skills: Skill[];
  connectors: AvailableConnector[];
}>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ saved: [agent: PersonalAgent] }>();

const { t } = useI18n();

const COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#be123c', '#15803d', '#a16207', '#0e7490'];

const form = reactive({
  name: '',
  description: '',
  avatarColor: COLORS[0]!,
  responsibilities: '',
  instruction: '',
  boundaries: '',
  memory: '',
  skillIds: [] as string[],
  connectors: {} as Record<string, ConnectorAccess | null>,
});
const saving = ref(false);
const error = ref('');

function connectorKey(item: { connectorType: string; connectorId: string }): string {
  return `${item.connectorType}:${item.connectorId}`;
}

watch(
  [open, () => props.agent],
  ([value]) => {
    if (!value) return;
    const agent = props.agent;
    Object.assign(form, {
      name: agent?.name ?? '',
      description: agent?.description ?? '',
      avatarColor: agent?.avatar_color ?? COLORS[0]!,
      responsibilities: agent?.responsibilities ?? '',
      instruction: agent?.instruction ?? '',
      boundaries: agent?.boundaries ?? '',
      memory: agent?.memory ?? '',
      skillIds: agent?.skills.map((s) => s.id) ?? [],
      connectors: Object.fromEntries((agent?.connectors ?? []).filter((c) => c.granted).map((c) => [connectorKey(c), c.access])),
    });
    error.value = '';
  },
  { immediate: true },
);

function toggleSkill(id: string, on: boolean): void {
  form.skillIds = on ? [...new Set([...form.skillIds, id])] : form.skillIds.filter((s) => s !== id);
}

function toggleConnector(item: AvailableConnector, on: boolean): void {
  form.connectors = { ...form.connectors, [connectorKey(item)]: on ? 'read' : null };
}

function setWrite(item: AvailableConnector, write: boolean): void {
  form.connectors = { ...form.connectors, [connectorKey(item)]: write ? 'read_write' : 'read' };
}

const engineLabel = (engine: string) => (engine === 'mcp' ? 'MCP' : (DB_ENGINE_LABELS[engine as DbEngine] ?? engine));

const valid = computed(() => form.name.trim().length >= 2 && form.instruction.trim().length >= 10);

async function submit(): Promise<void> {
  if (!valid.value) {
    error.value = t('subordinate.agents.invalid');
    return;
  }
  saving.value = true;
  error.value = '';
  const payload: PersonalAgentInput = {
    name: form.name.trim(),
    description: form.description.trim(),
    avatarColor: form.avatarColor,
    responsibilities: form.responsibilities.trim(),
    instruction: form.instruction.trim(),
    boundaries: form.boundaries.trim(),
    memory: form.memory.trim(),
    skillIds: form.skillIds,
    connectors: props.connectors
      .filter((item) => form.connectors[connectorKey(item)])
      .map((item) => ({
        connectorType: item.connectorType,
        connectorId: item.connectorId,
        access: form.connectors[connectorKey(item)]!,
      })),
  };
  try {
    const saved = props.agent ? await updateAgent(props.agent.id, payload) : await createAgent(payload);
    emit('saved', saved);
    open.value = false;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : t('errors.saveFailed');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <CaDialog
    v-model:open="open"
    size="large"
    :title="agent ? t('subordinate.agents.editTitle') : t('subordinate.agents.createTitle')"
    :subtitle="t('subordinate.agents.editorSubtitle')"
  >
    <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
    <form class="admin-form" @submit.prevent="submit">
      <div class="ae__row">
        <CaField :label="t('subordinate.agents.name')" required>
          <template #default="{ id }">
            <CaInput :id="id" v-model="form.name" :placeholder="t('subordinate.agents.namePlaceholder')" />
          </template>
        </CaField>
        <div class="ae__colors" role="radiogroup" :aria-label="t('subordinate.agents.color')">
          <span class="ae__label">{{ t('subordinate.agents.color') }}</span>
          <div class="ae__swatches">
            <button
              v-for="color in COLORS"
              :key="color"
              type="button"
              class="ae__swatch"
              :class="{ 'ae__swatch--active': form.avatarColor === color }"
              :style="{ background: color }"
              role="radio"
              :aria-checked="form.avatarColor === color"
              :aria-label="color"
              @click="form.avatarColor = color"
            />
          </div>
        </div>
      </div>
      <CaField :label="t('subordinate.agents.description')">
        <template #default="{ id }">
          <CaInput :id="id" v-model="form.description" :placeholder="t('subordinate.agents.descriptionPlaceholder')" />
        </template>
      </CaField>
      <CaField :label="t('subordinate.agents.responsibilities')" :hint="t('subordinate.agents.responsibilitiesHint')">
        <template #default="{ id, describedBy }">
          <CaTextarea :id="id" v-model="form.responsibilities" :aria-describedby="describedBy" :rows="3" />
        </template>
      </CaField>
      <CaField :label="t('subordinate.agents.instruction')" :hint="t('subordinate.agents.instructionHint')" required>
        <template #default="{ id, describedBy }">
          <CaTextarea :id="id" v-model="form.instruction" :aria-describedby="describedBy" :rows="5" />
        </template>
      </CaField>
      <CaField :label="t('subordinate.agents.boundaries')" :hint="t('subordinate.agents.boundariesHint')">
        <template #default="{ id, describedBy }">
          <CaTextarea :id="id" v-model="form.boundaries" :aria-describedby="describedBy" :rows="3" />
        </template>
      </CaField>
      <CaField :label="t('subordinate.agents.memory')" :hint="t('subordinate.agents.memoryHint')">
        <template #default="{ id, describedBy }">
          <CaTextarea :id="id" v-model="form.memory" :aria-describedby="describedBy" :rows="3" />
        </template>
      </CaField>

      <fieldset class="ae__group">
        <legend>{{ t('subordinate.agents.skills') }}</legend>
        <p v-if="skills.length === 0" class="ae__hint">{{ t('subordinate.agents.noSkills') }}</p>
        <div v-else class="ae__checks">
          <CaCheckbox
            v-for="skill in skills"
            :key="skill.id"
            :model-value="form.skillIds.includes(skill.id)"
            :label="skill.is_global ? `${skill.name} (${t('subordinate.skills.global')})` : skill.name"
            @update:model-value="(v: boolean) => toggleSkill(skill.id, v)"
          />
        </div>
      </fieldset>

      <fieldset class="ae__group">
        <legend>{{ t('subordinate.agents.connectors') }}</legend>
        <p class="ae__hint">{{ t('subordinate.agents.connectorsHint') }}</p>
        <p v-if="connectors.length === 0" class="ae__hint">{{ t('subordinate.agents.noConnectors') }}</p>
        <ul v-else class="ae__connectors">
          <li v-for="item in connectors" :key="connectorKey(item)" class="ae__connector">
            <div>
              <strong>{{ item.name }}</strong>
              <span class="ae__hint"> · {{ engineLabel(item.engine) }}</span>
            </div>
            <div class="ae__connector-controls">
              <CaSwitch
                :model-value="Boolean(form.connectors[connectorKey(item)])"
                :label="t('workspace.tools.use')"
                @update:model-value="(v: boolean) => toggleConnector(item, v)"
              />
              <CaSwitch
                v-if="item.access === 'read_write' && form.connectors[connectorKey(item)]"
                :model-value="form.connectors[connectorKey(item)] === 'read_write'"
                :label="t('workspace.tools.allowWrite')"
                @update:model-value="(v: boolean) => setWrite(item, v)"
              />
            </div>
          </li>
        </ul>
      </fieldset>
    </form>
    <template #footer>
      <CaButton variant="secondary" @click="open = false">{{ t('common.cancel') }}</CaButton>
      <CaButton variant="primary" :loading="saving" :disabled="!valid" @click="submit">{{ t('common.save') }}</CaButton>
    </template>
  </CaDialog>
</template>

<style scoped>
.ae__row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--ca-space-4);
  align-items: end;
}

.ae__colors {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.ae__label {
  font-size: var(--ca-text-200);
  color: var(--ca-fg-2);
}

.ae__swatches {
  display: flex;
  gap: 6px;
}

.ae__swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}

.ae__swatch--active {
  outline: 2px solid var(--ca-fg-1);
  outline-offset: 2px;
}

.ae__group {
  border: 1px solid var(--ca-border-subtle, var(--ca-border));
  border-radius: var(--ca-radius-medium, 8px);
  padding: var(--ca-space-3) var(--ca-space-4);
  margin: 0;
}

.ae__group legend {
  font-weight: var(--ca-font-weight-semibold);
  padding: 0 4px;
}

.ae__hint {
  margin: 0 0 var(--ca-space-2);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.ae__checks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--ca-space-2);
}

.ae__connectors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.ae__connector {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ca-space-3);
  flex-wrap: wrap;
}

.ae__connector-controls {
  display: flex;
  gap: var(--ca-space-4);
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .ae__row {
    grid-template-columns: 1fr;
  }
}
</style>
