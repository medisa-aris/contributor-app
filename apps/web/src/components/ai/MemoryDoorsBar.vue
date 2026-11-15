<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/api/http';
import {
  contextDoors,
  memoryReach,
  setContextDoors,
  type MemoryContextDoorDto,
  type MemoryReachSubjectDto,
} from '@/api/memory';
import { useAuthStore } from '@/stores/auth.store';
import { useToastStore } from '@/stores/toast.store';
import { CaIcon, CaSwitch } from '@/components/ui';

/**
 * Pintu memori: atasan membuka memori bawahan (orang/agent) untuk memperluas memori AI.
 * - Dengan `ensureConversation`: pilihan disimpan per percakapan (server memvalidasi izin).
 * - Tanpa itu (dialog tugas baru): pilihan disimpan lewat v-model dan dikirim saat tugas dibuat.
 */
const props = defineProps<{
  conversationId?: string | null;
  ensureConversation?: () => Promise<string | null>;
  disabled?: boolean;
}>();

const selection = defineModel<string[]>({ default: () => [] });

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const reach = ref<MemoryReachSubjectDto[]>([]);
const opened = ref<MemoryContextDoorDto[]>([]);
const menuOpen = ref(false);
const saving = ref(false);
const root = ref<HTMLElement | null>(null);

const persistent = computed(() => Boolean(props.ensureConversation));
const canOpen = computed(() => auth.can('ai.memory.doors.open'));
const visible = computed(() => canOpen.value && (reach.value.length > 0 || opened.value.length > 0));

/** Chip yang tampil: dari server (percakapan) atau dari pilihan lokal (tugas baru). */
const chips = computed<MemoryContextDoorDto[]>(() =>
  persistent.value
    ? opened.value
    : selection.value
        .map((id) => reach.value.find((s) => s.subjectId === id))
        .filter((s): s is MemoryReachSubjectDto => Boolean(s))
        .map((s) => ({ ...s, effective: s.granted })),
);
const openIds = computed(() => new Set(chips.value.map((c) => c.subjectId)));

async function loadReach(): Promise<void> {
  if (!canOpen.value) return;
  try {
    reach.value = await memoryReach();
  } catch {
    reach.value = [];
  }
}

async function loadOpened(id: string | null | undefined): Promise<void> {
  if (!persistent.value || !id || !auth.can('ai.memory.self.manage')) {
    opened.value = [];
    return;
  }
  try {
    opened.value = await contextDoors('conversation', id);
  } catch {
    opened.value = [];
  }
}

watch(
  () => props.conversationId,
  (id) => void loadOpened(id),
  { immediate: true },
);

async function apply(next: string[]): Promise<void> {
  if (!persistent.value) {
    selection.value = next;
    return;
  }
  const id = await props.ensureConversation!();
  if (!id) return;
  saving.value = true;
  try {
    opened.value = await setContextDoors('conversation', id, next);
  } catch (caught) {
    toast.push({ variant: 'danger', title: caught instanceof ApiError ? caught.message : t('errors.saveFailed') }, 5000);
  } finally {
    saving.value = false;
  }
}

/** Pintu yang izinnya sudah dicabut tidak dikirim ulang; server akan menolaknya. */
function current(): string[] {
  return chips.value.filter((c) => c.effective).map((c) => c.subjectId);
}

async function toggle(subject: MemoryReachSubjectDto, on: boolean): Promise<void> {
  const others = current().filter((id) => id !== subject.subjectId);
  await apply(on ? [...others, subject.subjectId] : others);
}

async function close(chip: MemoryContextDoorDto): Promise<void> {
  await apply(current().filter((id) => id !== chip.subjectId));
}

function onDocumentClick(event: MouseEvent): void {
  if (menuOpen.value && root.value && !root.value.contains(event.target as Node)) menuOpen.value = false;
}

onMounted(() => {
  void loadReach();
  document.addEventListener('click', onDocumentClick);
});

onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <div v-if="visible" ref="root" class="mbar">
    <span class="mbar__label">
      <CaIcon name="book" :size="13" />
      {{ t('memory.bar.label') }}
    </span>
    <span
      v-for="chip in chips"
      :key="chip.subjectId"
      class="mbar__chip"
      :class="{ 'mbar__chip--revoked': !chip.effective }"
      :title="chip.effective ? '' : t('memory.bar.revoked')"
    >
      <CaIcon :name="chip.kind === 'agent' ? 'bot' : 'people'" :size="12" />
      {{ chip.name }}
      <button
        type="button"
        class="mbar__chip-remove"
        :aria-label="t('memory.bar.close', { name: chip.name })"
        :disabled="disabled || saving"
        @click="close(chip)"
      >
        ×
      </button>
    </span>
    <button
      type="button"
      class="mbar__add"
      :aria-expanded="menuOpen"
      :disabled="disabled || saving"
      @click.stop="menuOpen = !menuOpen"
    >
      + {{ chips.length ? t('memory.bar.manage') : t('memory.bar.open') }}
    </button>

    <div v-if="menuOpen" class="mbar__menu" role="dialog" :aria-label="t('memory.bar.label')" @click.stop>
      <p class="mbar__hint">{{ t('memory.bar.hint') }}</p>
      <p v-if="reach.length === 0" class="mbar__hint">{{ t('memory.bar.none') }}</p>
      <ul class="mbar__list">
        <li v-for="subject in reach" :key="subject.subjectId" class="mbar__item">
          <div class="mbar__info">
            <span class="mbar__name">
              <CaIcon :name="subject.kind === 'agent' ? 'bot' : 'people'" :size="13" />
              {{ subject.name }}
            </span>
            <span class="mbar__meta">
              {{ subject.kind === 'agent' ? t('memory.bar.agent') : subject.departmentName || t('memory.bar.person') }}
              <template v-if="subject.caption"> · {{ subject.caption }}</template>
              <template v-if="subject.granted"> · {{ t('memory.bar.entries', { n: subject.visibleEntries }) }}</template>
            </span>
            <span v-if="!subject.granted" class="mbar__meta mbar__meta--muted">{{ t('memory.bar.notGranted') }}</span>
          </div>
          <CaSwitch
            :model-value="openIds.has(subject.subjectId)"
            :disabled="saving || !subject.granted"
            :label="openIds.has(subject.subjectId) ? t('memory.bar.opened') : t('memory.bar.closed')"
            @update:model-value="(v: boolean) => toggle(subject, v)"
          />
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.mbar {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--ca-space-2);
  padding: var(--ca-space-2) var(--ca-space-4) 0;
  font-size: var(--ca-text-200);
}

.mbar__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ca-fg-3);
}

.mbar__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 10px;
  border-radius: 999px;
  background: var(--ca-color-brand-subtle);
  color: var(--ca-fg-1);
}

.mbar__chip--revoked {
  background: var(--ca-danger-bg);
  text-decoration: line-through;
}

.mbar__chip-remove {
  border: 0;
  background: transparent;
  color: var(--ca-fg-3);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
}

.mbar__add {
  border: 1px dashed var(--ca-stroke-2);
  background: transparent;
  color: var(--ca-fg-2);
  border-radius: 999px;
  padding: 2px 10px;
  cursor: pointer;
}

.mbar__add:hover:not(:disabled) {
  color: var(--ca-fg-1);
  border-style: solid;
}

.mbar__menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: var(--ca-space-4);
  z-index: 20;
  /* Tetap di dalam kolom chat yang sempit (panel lampiran/dokumen terbuka). */
  width: min(440px, calc(100% - 2 * var(--ca-space-4)));
  min-width: 260px;
  max-height: 360px;
  overflow-y: auto;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl, 10px);
  box-shadow: var(--ca-shadow-16, 0 8px 24px rgba(0, 0, 0, 0.15));
  padding: var(--ca-space-3);
}

.mbar__hint {
  margin: 0 0 var(--ca-space-2);
  color: var(--ca-fg-3);
}

.mbar__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-2);
}

.mbar__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ca-space-3);
  padding: var(--ca-space-2) var(--ca-space-3);
  border-radius: var(--ca-radius-xl, 6px);
  border: 1px solid var(--ca-stroke-2);
}

.mbar__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mbar__name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: var(--ca-font-weight-medium);
  color: var(--ca-fg-1);
}

.mbar__meta {
  color: var(--ca-fg-3);
}

.mbar__meta--muted {
  font-style: italic;
}
</style>
