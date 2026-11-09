<script setup lang="ts">
import { GUARDRAIL_CATEGORIES, type GuardrailGroup } from '@bara/shared';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getGuardrails, updateGuardrails } from '@/api/admin';
import { ApiError } from '@/api/http';
import { useToastStore } from '@/stores/toast.store';
import {
  CaButton,
  CaCard,
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

onMounted(load);
</script>

<template>
  <section>
    <CaPageHeader :title="t('admin.guardrails.title')" :description="t('admin.guardrails.description')" />

    <div v-if="loading" class="grd-loading"><CaSpinner size="large" /></div>
    <p v-else-if="failed" class="admin-error">{{ t('errors.loadFailed') }}</p>

    <form v-else class="grd" @submit.prevent="save">
      <CaCard>
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
      </CaCard>

      <CaCard>
        <h2 class="grd-title">{{ t('admin.guardrails.categoriesTitle') }}</h2>
        <div v-for="group in groups" :key="group" class="grd-group">
          <h3 class="grd-group__title">{{ t(`admin.guardrails.groups.${group}`) }}</h3>
          <div class="grd-options">
            <CaCheckbox
              v-for="category in categoriesIn(group)"
              :key="category.id"
              v-model="selected[category.id]"
              :label="category.label"
            />
          </div>
        </div>
      </CaCard>

      <CaCard>
        <h2 class="grd-title">{{ t('admin.guardrails.termsTitle') }}</h2>
        <p class="grd-hint">{{ t('admin.guardrails.termsHint') }}</p>
        <CaTextarea v-model="terms" :rows="5" />
      </CaCard>

      <div>
        <CaButton type="submit" variant="primary" :disabled="saving">
          {{ t('admin.guardrails.save') }}
        </CaButton>
      </div>
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
  gap: var(--ca-space-8);
  max-width: 760px;
}

.grd-key {
  margin: 0 0 var(--ca-space-6);
}

.grd-row + .grd-row {
  margin-top: var(--ca-space-6);
}

.grd-hint {
  margin: var(--ca-space-1) 0 var(--ca-space-3);
  font-size: var(--ca-text-200);
  color: var(--ca-fg-3);
}

.grd-title {
  margin: 0 0 var(--ca-space-3);
  font-size: var(--ca-text-400);
  color: var(--ca-fg-1);
}

.grd-group + .grd-group {
  margin-top: var(--ca-space-6);
}

.grd-group__title {
  margin: 0 0 var(--ca-space-3);
  font-size: var(--ca-text-200);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-2);
}

.grd-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--ca-space-3);
}
</style>
