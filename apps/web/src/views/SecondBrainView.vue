<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ChatWorkspace from '@/components/ai/ChatWorkspace.vue';
import { CaPageHeader } from '@/components/ui';

const { t } = useI18n();
</script>

<template>
  <section>
    <CaPageHeader
      :title="t('workspace.secondBrain.title')"
      :description="t('workspace.secondBrain.description')"
    />
    <ChatWorkspace mode="second_brain" />
  </section>
</template>
