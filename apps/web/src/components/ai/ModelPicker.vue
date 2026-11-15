<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatTokens, myModels, setPreferredModel, type UserModelDto } from '@/api/models';
import { ApiError } from '@/api/http';
import { useToastStore } from '@/stores/toast.store';
import { CaIcon } from '@/components/ui';

/**
 * Pemilih model di composer. Tersembunyi bila pengguna hanya punya model bawaan.
 * Nilai null = ikuti urutan bawaan server (model percakapan → pilihan pengguna → bawaan).
 */
const props = defineProps<{ disabled?: boolean; needsTools?: boolean; hasImages?: boolean }>();
const selected = defineModel<string | null>({ default: null });

const { t } = useI18n();
const toast = useToastStore();
const models = ref<UserModelDto[]>([]);
const preferredId = ref<string | null>(null);

const effectiveId = computed(() => {
  const ids = models.value.map((m) => m.id);
  if (selected.value && ids.includes(selected.value)) return selected.value;
  if (preferredId.value && ids.includes(preferredId.value)) return preferredId.value;
  return models.value.find((m) => m.isDefault)?.id ?? null;
});
const current = computed(() => models.value.find((m) => m.id === effectiveId.value) ?? null);
const visible = computed(() => models.value.length > 1);

function blockedReason(model: UserModelDto): string | null {
  if (props.needsTools && !model.supportsTools) return t('models.picker.noTools');
  if (props.hasImages && !model.supportsVision) return t('models.picker.noVision');
  if (model.exhausted) {
    const reset = model.quotas.find((q) => q.remaining <= 0)?.resetsAt;
    return t('models.picker.exhausted', { when: reset ? new Date(reset).toLocaleString('id-ID', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—' });
  }
  return null;
}

function quotaText(model: UserModelDto): string {
  if (model.quotas.length === 0) return model.isDefault ? t('models.picker.default') : '';
  return model.quotas
    .map((q) =>
      t('models.picker.remaining', {
        tokens: formatTokens(q.remaining),
        period: q.period === 'day' ? t('models.picker.periodDay') : t('models.picker.periodWeek'),
      }),
    )
    .join(' · ');
}

const options = computed(() =>
  models.value.map((model) => {
    const reason = blockedReason(model);
    const tier = model.costTier ? ` · ${t(`models.picker.costTier.${model.costTier}`)}` : '';
    return {
      value: model.id,
      label: `${model.displayName}${tier}${reason ? ` — ${reason}` : model.isDefault && model.quotas.length === 0 ? ` — ${t('models.picker.default')}` : ''}`,
      disabled: Boolean(reason) && model.id !== effectiveId.value,
    };
  }),
);

async function reload(): Promise<void> {
  try {
    const result = await myModels();
    models.value = result.models;
    preferredId.value = result.preferredModelId;
  } catch {
    models.value = [];
  }
}

function onChange(event: Event): void {
  selected.value = (event.target as HTMLSelectElement).value || null;
}

async function makePreferred(): Promise<void> {
  if (!effectiveId.value) return;
  try {
    await setPreferredModel(effectiveId.value);
    preferredId.value = effectiveId.value;
    toast.push({ variant: 'success', title: t('models.picker.preferredSaved') }, 3000);
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') }, 5000);
  }
}

/** Pilih model bawaan (mis. setelah kuota model lain habis). */
function useDefault(): void {
  selected.value = models.value.find((m) => m.isDefault)?.id ?? null;
}

defineExpose({ reload, useDefault });
onMounted(reload);
</script>

<template>
  <div v-if="visible" class="mpick">
    <CaIcon name="sparkle" :size="13" />
    <label class="mpick__label" for="chat-model-picker">{{ t('models.picker.label') }}</label>
    <select
      id="chat-model-picker"
      class="mpick__select"
      :value="effectiveId ?? ''"
      :disabled="disabled"
      @change="onChange"
    >
      <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">
        {{ option.label }}
      </option>
    </select>
    <span v-if="current" class="mpick__quota" :class="{ 'mpick__quota--low': current.exhausted }">
      {{ quotaText(current) }}
    </span>
    <button
      v-if="current && current.id !== preferredId"
      type="button"
      class="mpick__link"
      :disabled="disabled"
      @click="makePreferred"
    >
      {{ t('models.picker.makePreferred') }}
    </button>
  </div>
</template>

<style scoped>
.mpick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-2);
  padding: var(--ca-space-2) var(--ca-space-4) 0;
  font-size: var(--ca-text-200);
  color: var(--ca-fg-2);
}
.mpick__label {
  font-weight: 600;
}
.mpick__select {
  max-width: min(100%, 360px);
  padding: 4px 8px;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  font: inherit;
}
.mpick__select:focus-visible {
  outline: 2px solid var(--ca-stroke-focus);
  outline-offset: 1px;
}
.mpick__quota {
  color: var(--ca-fg-3);
}
.mpick__quota--low {
  color: var(--ca-fg-danger, #b3261e);
}
.mpick__link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--ca-fg-brand, var(--ca-fg-1));
  text-decoration: underline;
  cursor: pointer;
}
.mpick__link:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
