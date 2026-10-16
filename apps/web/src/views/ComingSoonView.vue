<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useNavigationStore } from '@/stores/navigation.store';
import { CaButton } from '@/components/ui';

const { t } = useI18n();
const route = useRoute();
const navigation = useNavigationStore();

const location = computed(() => navigation.findByRoute(route.path));

const crumb = computed(() => {
  if (!location.value) return '';
  const { application, module } = location.value;
  return module ? `${application.name} / ${module.name}` : application.name;
});
</script>

<template>
  <div class="soon">
    <template v-if="location">
      <p class="soon__crumb">{{ crumb }}</p>
      <h1 class="soon__title">{{ location.item.label }}</h1>
      <p class="soon__desc">{{ t('comingSoon.description') }}</p>
    </template>
    <template v-else>
      <h1 class="soon__title">{{ t('comingSoon.fallbackTitle') }}</h1>
      <p class="soon__desc">{{ t('comingSoon.fallbackDescription') }}</p>
    </template>
    <div class="soon__actions">
      <CaButton variant="secondary" to="/">{{ t('comingSoon.backHome') }}</CaButton>
    </div>
  </div>
</template>

<style scoped>
.soon {
  max-width: 560px;
  padding-top: var(--ca-space-12);
}

.soon__crumb {
  font-size: var(--ca-text-100);
  font-weight: var(--ca-font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ca-fg-3);
  margin-bottom: var(--ca-space-1);
}

.soon__title {
  font-size: var(--ca-text-700);
  line-height: var(--ca-line-700);
  font-weight: var(--ca-font-weight-semibold);
}

.soon__desc {
  margin-top: var(--ca-space-3);
  color: var(--ca-fg-2);
  font-size: var(--ca-text-300);
  line-height: var(--ca-line-300);
}

.soon__actions {
  margin-top: var(--ca-space-6);
}
</style>
