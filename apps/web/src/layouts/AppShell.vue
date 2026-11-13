<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterView, useRoute } from 'vue-router';
import { useUiStore } from '@/stores/ui.store';
import AppHeader from '@/components/shell/AppHeader.vue';
import AppSidebar from '@/components/shell/AppSidebar.vue';

const { t } = useI18n();
const route = useRoute();
const ui = useUiStore();

const RAIL_KEY = 'ca.sidebarCollapsed';
const MOBILE_QUERY = '(max-width: 900px)';

function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

const railPreferred = ref(readRail());
const mobileOpen = ref(false);
const media = typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY) : null;
const isMobile = ref(media?.matches ?? false);

function onMediaChange(event: MediaQueryListEvent): void {
  isMobile.value = event.matches;
  if (!event.matches) mobileOpen.value = false;
}

media?.addEventListener('change', onMediaChange);
onBeforeUnmount(() => media?.removeEventListener('change', onMediaChange));

const rail = computed(() => railPreferred.value && !isMobile.value);

function setRail(value: boolean): void {
  railPreferred.value = value;
  try {
    localStorage.setItem(RAIL_KEY, value ? '1' : '0');
  } catch {
    // preferensi tampilan saja
  }
}

watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false;
  },
);
</script>

<template>
  <div class="shell" :class="{ 'shell--immersive': ui.fullscreen }">
    <a class="shell__skip" href="#main">{{ t('shell.skipToContent') }}</a>

    <AppSidebar
      v-if="!ui.fullscreen"
      :rail="rail"
      :mobile-open="mobileOpen"
      @toggle-rail="setRail(!railPreferred)"
      @expand="setRail(false)"
    />

    <div v-if="mobileOpen && !ui.fullscreen" class="shell__scrim" aria-hidden="true" @click="mobileOpen = false" />

    <div class="shell__main">
      <AppHeader v-if="!ui.fullscreen" @toggle-mobile="mobileOpen = !mobileOpen" />
      <main id="main" class="shell__content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
  background: var(--ca-bg-canvas);
  color: var(--ca-fg-1);
}

.shell__skip {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: var(--ca-z-toast);
  padding: var(--ca-space-2) var(--ca-space-4);
  background: var(--ca-color-brand);
  color: var(--ca-fg-on-brand);
  border-radius: var(--ca-radius-md);
  text-decoration: none;
}

.shell__skip:focus {
  left: var(--ca-space-3);
  top: var(--ca-space-3);
}

.shell__scrim {
  display: none;
}

.shell__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.shell__content {
  flex: 1;
  width: 100%;
  max-width: var(--ca-content-max-width);
  padding: var(--ca-space-16) var(--ca-space-12);
}

.shell--immersive .shell__content {
  max-width: none;
  padding: 0;
}

@media (max-width: 900px) {
  .shell__scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1050;
    background: var(--ca-bg-overlay);
  }

  .shell__content {
    padding: var(--ca-space-12) var(--ca-space-8);
  }
}
</style>
