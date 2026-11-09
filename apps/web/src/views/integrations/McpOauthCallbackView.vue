<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '@/api/http';
import { completeMcpOauth } from '@/api/integrations';
import { CaButton } from '@/components/ui';
import { useToastStore } from '@/stores/toast.store';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToastStore();

const errorMessage = ref('');

onMounted(async () => {
  const { code, state, error, error_description: description } = route.query;
  if (typeof error === 'string') {
    errorMessage.value = typeof description === 'string' ? description : error;
    return;
  }
  if (typeof code !== 'string' || typeof state !== 'string') {
    errorMessage.value = t('integrations.oauthCallbackFailed');
    return;
  }
  try {
    await completeMcpOauth({ code, state });
    toast.push({ variant: 'success', title: t('integrations.oauthCallbackDone') });
    await router.replace('/integrations');
  } catch (caught) {
    errorMessage.value = caught instanceof ApiError ? caught.message : t('integrations.oauthCallbackFailed');
  }
});
</script>

<template>
  <section class="oauth-callback">
    <h1>{{ t('integrations.oauthCallbackTitle') }}</h1>
    <p v-if="!errorMessage">{{ t('integrations.oauthCallbackWorking') }}</p>
    <template v-else>
      <p class="admin-error" role="alert">{{ errorMessage }}</p>
      <CaButton variant="secondary" @click="router.replace('/integrations')">
        {{ t('integrations.oauthBack') }}
      </CaButton>
    </template>
  </section>
</template>

<style scoped>
.oauth-callback {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ca-space-6);
  padding: var(--ca-space-8);
}
</style>
