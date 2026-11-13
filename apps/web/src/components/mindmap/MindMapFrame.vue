<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CaIcon, CaTabs } from '@/components/ui';
import type { MindMapMode, MindMapQuery } from '@/api/mindmap/types';
import { useFullscreen } from '@/composables/useFullscreen';
import MappingTab from './MappingTab.vue';
import ThoughtStructureTab from './ThoughtStructureTab.vue';
import { MODE_COLORS, MODE_DASH, MODE_ORDER } from './mode-colors';

const { t } = useI18n();
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

const { ui, setFullscreen } = useFullscreen();
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
            <span class="mm__chip-line" :style="{ borderTopColor: MODE_COLORS[mode], borderTopStyle: MODE_DASH[mode] }" />
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
          <CaIcon :name="ui.fullscreen ? 'close' : 'fullscreen'" :size="16" />
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

  </section>
</template>

<style scoped>
.mm {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-8);
  height: calc(100vh - var(--ca-topbar-height) - var(--ca-space-16) * 2);
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
  align-items: flex-end;
  gap: var(--ca-space-6) var(--ca-space-8);
}
.mm__titles {
  min-width: 0;
}
.mm__title {
  margin: 0;
  font-size: var(--ca-text-700);
  line-height: var(--ca-line-700);
  font-weight: var(--ca-font-weight-semibold);
  color: var(--ca-fg-1);
}
.mm__desc {
  margin: var(--ca-space-2) 0 0;
  color: var(--ca-fg-3);
  max-width: 680px;
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
  border: 1px solid var(--ca-stroke-accessible);
  border-radius: var(--ca-radius-md);
  overflow: hidden;
}
.mm__seg-btn {
  height: 30px;
  padding: 0 12px;
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  border: 0;
  cursor: pointer;
  font: inherit;
}
.mm__seg-btn + .mm__seg-btn {
  border-left: 1px solid var(--ca-stroke-accessible);
}
.mm__seg-btn--on {
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand-text);
  font-weight: var(--ca-font-weight-semibold);
}
.mm__modes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ca-space-4);
}
.mm__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--ca-radius-lg);
  border: 1px solid var(--ca-stroke-2);
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
.mm__chip-line {
  width: 16px;
  height: 0;
  border-top-width: 2px;
}
.mm__full {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--ca-radius-md);
  border: 1px solid var(--ca-stroke-accessible);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-1);
  cursor: pointer;
  font: inherit;
  font-weight: var(--ca-font-weight-semibold);
}
.mm__full:hover {
  border-color: var(--ca-color-brand);
}
.mm__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: visible;
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
