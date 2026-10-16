<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth.store';
import { CaButton, CaCard, CaIcon, CaPageHeader } from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();

const modes = computed(() => [
  {
    key: 'secondBrain',
    to: '/workspace/second-brain',
    icon: 'book',
    permission: 'ai.secondbrain.query',
  },
  {
    key: 'counterpart',
    to: '/workspace/counterpart',
    icon: 'people',
    permission: 'ai.counterpart.analyze',
  },
  {
    key: 'subordinate',
    to: '/workspace/subordinate',
    icon: 'bot',
    permission: 'ai.subordinate.execute',
  },
]);

const visibleModes = computed(() => modes.value.filter((mode) => auth.can(mode.permission)));
const canHistory = computed(() => auth.can('ai.workspace.history.read'));
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('workspace.landing.title')"
      :description="t('workspace.landing.subtitle')"
    />

    <div class="landing__grid">
      <CaCard v-for="mode in visibleModes" :key="mode.key">
        <template #header>
          <span class="landing__icon" aria-hidden="true">
            <CaIcon :name="mode.icon" :size="22" />
          </span>
          <h3 class="ca-card__title">{{ t(`workspace.landing.${mode.key}.name`) }}</h3>
          <p class="ca-card__subtitle">{{ t(`workspace.landing.${mode.key}.description`) }}</p>
        </template>
        <template #footer>
          <CaButton :to="mode.to">{{ t('workspace.landing.open') }}</CaButton>
        </template>
      </CaCard>
    </div>

    <CaCard
      v-if="canHistory"
      class="landing__history"
      :title="t('workspace.landing.history.name')"
      :subtitle="t('workspace.landing.history.description')"
    >
      <template #footer>
        <CaButton variant="secondary" to="/workspace/history">
          {{ t('workspace.landing.history.open') }}
        </CaButton>
      </template>
    </CaCard>

    <p v-if="visibleModes.length === 0" class="landing__empty">
      {{ t('workspace.landing.noAccess') }}
    </p>
  </section>
</template>

<style scoped>
.landing__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--ca-space-5);
}

.landing__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--ca-radius-lg);
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand);
  margin-bottom: var(--ca-space-3);
}

.landing__history {
  margin-top: var(--ca-space-5);
}

.landing__empty {
  color: var(--ca-fg-2);
  font-size: var(--ca-text-300);
}
</style>
