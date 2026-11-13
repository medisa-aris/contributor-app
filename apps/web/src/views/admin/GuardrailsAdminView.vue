<script setup lang="ts">
import { GUARDRAIL_CATEGORIES, type GuardrailGroup } from '@bara/shared';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getGuardrails, updateGuardrails } from '@/api/admin';
import { ApiError } from '@/api/http';
import { useToastStore } from '@/stores/toast.store';
import {
  CaButton,
  CaCheckbox,
  CaPageHeader,
  CaSpinner,
  CaSwitch,
  CaTextarea,
} from '@/components/ui';

const { t } = useI18n();
const toast = useToastStore();

const groups: GuardrailGroup[] = ['specific', 'general', 'consumer', 'other'];
const categoriesIn = (group: GuardrailGroup) =>
  GUARDRAIL_CATEGORIES.filter((category) => category.group === group);

const loading = ref(true);
const failed = ref(false);
const saving = ref(false);
const keyConfigured = ref(false);
const enabled = ref(false);
const blockImages = ref(true);
const selected = ref<Record<string, boolean>>({});
const terms = ref('');

function apply(settings: Awaited<ReturnType<typeof getGuardrails>>): void {
  keyConfigured.value = settings.keyConfigured;
  enabled.value = settings.enabled;
  blockImages.value = settings.blockImages;
  selected.value = Object.fromEntries(
    GUARDRAIL_CATEGORIES.map((category) => [category.id, settings.categories.includes(category.id)]),
  );
  terms.value = settings.terms.join('\n');
}

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    apply(await getGuardrails());
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    apply(
      await updateGuardrails({
        enabled: enabled.value,
        blockImages: blockImages.value,
        categories: GUARDRAIL_CATEGORIES.filter((c) => selected.value[c.id]).map((c) => c.id),
        terms: [...new Set(terms.value.split('\n').map((term) => term.trim()).filter(Boolean))],
      }),
    );
    toast.push({ variant: 'success', title: t('admin.guardrails.saved') });
  } catch (caught) {
    toast.push(
      {
        variant: 'danger',
        title: caught instanceof ApiError ? caught.message : t('errors.saveFailed'),
      },
      5000,
    );
  } finally {
    saving.value = false;
  }
}

const selectedCount = computed(() => GUARDRAIL_CATEGORIES.filter((c) => selected.value[c.id]).length);
const allSelected = computed(() => selectedCount.value === GUARDRAIL_CATEGORIES.length);

function toggleAll(): void {
  const value = !allSelected.value;
  selected.value = Object.fromEntries(GUARDRAIL_CATEGORIES.map((c) => [c.id, value]));
}

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader :title="t('admin.guardrails.title')" :description="t('admin.guardrails.description')">
      <template #actions>
        <CaButton v-if="!loading && !failed" type="submit" form="grd-form" variant="primary" :loading="saving">
          {{ t('admin.guardrails.save') }}
        </CaButton>
      </template>
    </CaPageHeader>

    <div v-if="loading" class="grd-loading"><CaSpinner size="large" /></div>
    <p v-else-if="failed" class="admin-error">{{ t('errors.loadFailed') }}</p>

    <form v-else id="grd-form" class="grd" @submit.prevent="save">
      <section class="ca-panel grd-flow" aria-labelledby="grd-flow">
        <div class="grd-head">
          <h2 id="grd-flow" class="ca-panel__title">{{ t('admin.guardrails.flowTitle') }}</h2>
          <span class="grd-status" :class="{ 'grd-status--on': enabled }">
            {{ enabled ? t('admin.guardrails.flowStatusOn', { n: selectedCount }) : t('admin.guardrails.flowStatusOff') }}
          </span>
        </div>
        <div class="grd-steps">
          <div class="grd-step">
            <span class="grd-step__label">{{ t('admin.guardrails.flowInput') }}</span>
            <span>{{ t('admin.guardrails.flowInputText') }}</span>
          </div>
          <div class="grd-step grd-step--mask">
            <span class="grd-step__label">{{ t('admin.guardrails.flowMask') }}</span>
            <span>{{ t('admin.guardrails.flowMaskText') }}</span>
          </div>
          <div class="grd-step">
            <span class="grd-step__label">{{ t('admin.guardrails.flowOutput') }}</span>
            <span><code>[NAMA_1]</code> (NIK <code>[NIK_1]</code>) mengajukan klaim, hubungi <code>[TELEPON_1]</code></span>
          </div>
        </div>
      </section>

      <section class="ca-panel" aria-labelledby="grd-general">
        <h2 id="grd-general" class="ca-panel__title grd-section-title">{{ t('admin.guardrails.generalTitle') }}</h2>
        <p v-if="!keyConfigured" class="admin-error grd-key">{{ t('admin.guardrails.keyMissing') }}</p>
        <div class="grd-row">
          <CaSwitch
            v-model="enabled"
            :label="t('admin.guardrails.enabled')"
            :disabled="!keyConfigured && !enabled"
          />
          <p class="grd-hint">{{ t('admin.guardrails.enabledHint') }}</p>
        </div>
        <div class="grd-row">
          <CaSwitch v-model="blockImages" :label="t('admin.guardrails.blockImages')" />
          <p class="grd-hint">{{ t('admin.guardrails.blockImagesHint') }}</p>
        </div>
      </section>

      <section class="ca-panel" aria-labelledby="grd-categories">
        <div class="grd-head grd-section-title">
          <h2 id="grd-categories" class="ca-panel__title">{{ t('admin.guardrails.categoriesTitle') }}</h2>
          <CaButton size="small" @click="toggleAll">
            {{ allSelected ? t('admin.guardrails.clearAll') : t('admin.guardrails.selectAll') }}
          </CaButton>
        </div>
        <fieldset v-for="group in groups" :key="group" class="grd-group">
          <legend class="grd-group__title">{{ t(`admin.guardrails.groups.${group}`) }}</legend>
          <div class="grd-options">
            <CaCheckbox
              v-for="category in categoriesIn(group)"
              :key="category.id"
              v-model="selected[category.id]"
              :label="category.label"
            />
          </div>
        </fieldset>
      </section>

      <section class="ca-panel" aria-labelledby="grd-terms">
        <h2 id="grd-terms" class="ca-panel__title">{{ t('admin.guardrails.termsTitle') }}</h2>
        <p class="grd-hint">{{ t('admin.guardrails.termsHint') }}</p>
        <CaTextarea v-model="terms" :rows="5" :aria-label="t('admin.guardrails.termsTitle')" />
      </section>
    </form>
  </section>
</template>

<style scoped>
.grd-loading {
  display: flex;
  justify-content: center;
  padding: var(--ca-space-24) 0;
}

.grd {
  display: flex;
  flex-direction: column;
  max-width: 880px;
}

.grd-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
}

.grd-section-title {
  margin-bottom: var(--ca-space-8);
}

.grd-status {
  display: inline-flex;
  align-items: center;
  padding: var(--ca-space-1) var(--ca-space-4);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface-2);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
}

.grd-status--on {
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand-text);
}

.grd-flow {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-8);
}

.grd-steps {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: var(--ca-space-6);
  align-items: stretch;
}

.grd-step {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
  padding: var(--ca-space-8);
  border-radius: var(--ca-radius-xl);
  background: var(--ca-bg-surface-2);
}

.grd-step--mask {
  justify-content: center;
  background: var(--ca-color-brand-strong);
  color: var(--ca-fg-on-brand-strong);
}

.grd-step__label {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  font-weight: var(--ca-font-weight-semibold);
}

.grd-step code {
  font-family: var(--ca-font-family-mono);
  font-size: 13px;
  padding: 0 var(--ca-space-1);
  border-radius: var(--ca-radius-sm);
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand-text);
}

.grd-key {
  margin: 0 0 var(--ca-space-6);
}

.grd-row + .grd-row {
  margin-top: var(--ca-space-8);
}

.grd-hint {
  margin: var(--ca-space-2) 0 var(--ca-space-4);
  color: var(--ca-fg-3);
}

.grd-group {
  margin: 0;
  padding: 0;
  border: 0;
}

.grd-group + .grd-group {
  margin-top: var(--ca-space-10);
}

.grd-group__title {
  margin-bottom: var(--ca-space-4);
  font-weight: var(--ca-font-weight-semibold);
}

.grd-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--ca-space-4);
}

@media (max-width: 700px) {
  .grd-steps {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
