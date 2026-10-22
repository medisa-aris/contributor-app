<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CaIcon, CaTabs } from '@/components/ui';
import type { MindMapMode, MindMapQuery } from '@/api/mindmap/types';
import { useUiStore } from '@/stores/ui.store';
import MappingTab from './MappingTab.vue';
import ThoughtStructureTab from './ThoughtStructureTab.vue';
import { MODE_COLORS, MODE_ORDER } from './mode-colors';

const { t } = useI18n();
const ui = useUiStore();

const tab = ref<'mapping' | 'thinking'>('mapping');
const tabs = computed(() => [
  { key: 'mapping', label: t('workspace.mindMap.tabs.mapping') },
  { key: 'thinking', label: t('workspace.mindMap.tabs.thinking') },
]);

const RANGES = [7, 30, 90] as const;
const activeModes = ref<MindMapMode[]>([...MODE_ORDER]);
const days = ref<number>(30);

const query = reactive<MindMapQuery>({ days: 30, modes: [...MODE_ORDER] });
function applyQuery(): void {
  query.days = days.value;
  query.modes = [...activeModes.value];
}

function toggleMode(mode: MindMapMode): void {
  const next = activeModes.value.includes(mode)
    ? activeModes.value.filter((m) => m !== mode)
    : [...activeModes.value, mode];
  if (next.length === 0) return;
  activeModes.value = next;
  applyQuery();
}

function setDays(value: number): void {
  days.value = value;
  applyQuery();
}

async function setFullscreen(value: boolean): Promise<void> {
  ui.setFullscreen(value);
  try {
    if (value && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else if (!value && document.fullscreenElement) await document.exitFullscreen?.();
  } catch {
    // Layar penuh peramban opsional; tata letak tetap bekerja tanpanya.
  }
}

function onFullscreenChange(): void {
  if (!document.fullscreenElement && ui.fullscreen) ui.setFullscreen(false);
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && ui.fullscreen) void setFullscreen(false);
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('keydown', onKeydown);
  void setFullscreen(false);
});
</script>

<template>
  <section class="mm" :class="{ 'mm--full': ui.fullscreen }">
    <header class="mm__head">
      <div class="mm__titles">
        <h1 class="mm__title">{{ t('workspace.mindMap.title') }}</h1>
        <p v-if="!ui.fullscreen" class="mm__desc">{{ t('workspace.mindMap.description') }}</p>
      </div>

      <CaTabs
        v-model="tab"
        class="mm__tabs"
        :items="tabs"
        :aria-label="t('workspace.mindMap.tabs.label')"
      />

      <div class="mm__filters">
        <div class="mm__seg" role="group" :aria-label="t('workspace.mindMap.range.label')">
          <button
            v-for="r in RANGES"
            :key="r"
            type="button"
            class="mm__seg-btn"
            :class="{ 'mm__seg-btn--on': days === r }"
            :aria-pressed="days === r"
            @click="setDays(r)"
          >
            {{ t(`workspace.mindMap.range.d${r}`) }}
          </button>
        </div>
        <div class="mm__modes">
          <button
            v-for="mode in MODE_ORDER"
            :key="mode"
            type="button"
            class="mm__chip"
            :class="{ 'mm__chip--on': activeModes.includes(mode) }"
            :aria-pressed="activeModes.includes(mode)"
            @click="toggleMode(mode)"
          >
            <span class="mm__chip-dot" :style="{ background: MODE_COLORS[mode] }" />
            {{ t(`workspace.mindMap.modes.${mode}`) }}
          </button>
        </div>
        <button
          type="button"
          class="mm__full"
          :title="ui.fullscreen ? t('workspace.mindMap.exitFullscreen') : t('workspace.mindMap.fullscreen')"
          :aria-label="ui.fullscreen ? t('workspace.mindMap.exitFullscreen') : t('workspace.mindMap.fullscreen')"
          @click="setFullscreen(!ui.fullscreen)"
        >
          <CaIcon :name="ui.fullscreen ? 'close' : 'columns'" :size="16" />
          <span class="mm__full-text">
            {{ ui.fullscreen ? t('workspace.mindMap.exitFullscreen') : t('workspace.mindMap.fullscreen') }}
          </span>
        </button>
      </div>
    </header>

    <div class="mm__stage">
      <MappingTab v-if="tab === 'mapping'" :query="query" />
      <ThoughtStructureTab v-else :query="query" />
    </div>

    <p class="mm__notice">{{ t('workspace.mindMap.auditNotice') }}</p>
  </section>
</template>

<style scoped>
.mm {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-3);
  height: calc(100vh - var(--ca-topbar-height) - var(--ca-space-6) * 2);
  min-height: 560px;
}
.mm--full {
  height: 100vh;
  padding: var(--ca-space-3) var(--ca-space-4);
  background: var(--ca-bg-canvas);
}
.mm__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-3) var(--ca-space-5);
}
.mm__titles {
  min-width: 0;
}
.mm__title {
  margin: 0;
  font-size: var(--ca-text-500, 20px);
  color: var(--ca-fg-1);
}
.mm__desc {
  margin: 2px 0 0;
  color: var(--ca-fg-2);
  max-width: 60ch;
}
.mm__filters {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-2) var(--ca-space-3);
}
.mm__seg {
  display: inline-flex;
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-md);
  overflow: hidden;
}
.mm__seg-btn {
  padding: 6px 12px;
  background: var(--ca-bg-surface);
  color: var(--ca-fg-2);
  border: 0;
  cursor: pointer;
  font: inherit;
}
.mm__seg-btn + .mm__seg-btn {
  border-left: 1px solid var(--ca-stroke-1);
}
.mm__seg-btn--on {
  background: var(--ca-color-brand);
  color: var(--ca-fg-on-brand);
}
.mm__modes {
  display: flex;
  gap: var(--ca-space-1);
}
.mm__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--ca-radius-circular);
  border: 1px solid var(--ca-stroke-1);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-3);
  cursor: pointer;
  font: inherit;
  opacity: 0.7;
}
.mm__chip--on {
  color: var(--ca-fg-1);
  border-color: var(--ca-stroke-2);
  opacity: 1;
}
.mm__chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.mm__full {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--ca-radius-md);
  border: 1px solid var(--ca-stroke-1);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  cursor: pointer;
  font: inherit;
}
.mm__full:hover {
  border-color: var(--ca-color-brand);
}
.mm__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--ca-stroke-1);
  border-radius: var(--ca-radius-lg);
  background:
    radial-gradient(circle at 50% 50%, var(--ca-bg-surface) 0%, var(--ca-bg-canvas) 100%);
  overflow: hidden;
}
.mm__notice {
  margin: 0;
  color: var(--ca-fg-3);
  font-size: 12px;
}
@media (max-width: 700px) {
  .mm__full-text {
    display: none;
  }
  .mm__filters {
    margin-left: 0;
  }
}
</style>
