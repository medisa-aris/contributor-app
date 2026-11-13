<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { NotificationDto, NotificationKind } from '@bara/shared';
import { apiGet } from '@/api/http';
import { formatDateTime } from '@/utils/format';
import { CaIcon } from '@/components/ui';

const { t } = useI18n();

const SEEN_KEY = 'ca.notifSeenAt';
const REFRESH_MS = 60_000;

const items = ref<NotificationDto[]>([]);
const failed = ref(false);
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const seenAt = ref(readSeenAt());
let timer: ReturnType<typeof setInterval> | null = null;

function readSeenAt(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

const unread = computed(() => items.value.filter((n) => n.createdAt > seenAt.value).length);

const KIND_ICON: Record<NotificationKind, { icon: string; tone: string }> = {
  approval: { icon: 'warning', tone: 'warning' },
  taskAction: { icon: 'warning', tone: 'warning' },
  taskDone: { icon: 'check-circle', tone: 'success' },
  taskFailed: { icon: 'error-circle', tone: 'danger' },
  documentFailed: { icon: 'error-circle', tone: 'danger' },
};

async function load(): Promise<void> {
  try {
    items.value = await apiGet<NotificationDto[]>('/notifications');
    failed.value = false;
  } catch {
    failed.value = true;
  }
}

function markSeen(): void {
  const latest = items.value[0]?.createdAt ?? new Date().toISOString();
  seenAt.value = latest;
  try {
    localStorage.setItem(SEEN_KEY, latest);
  } catch {
    // tanda baca hanya preferensi lokal
  }
}

function toggle(): void {
  open.value = !open.value;
  if (open.value) void load();
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false;
}

onMounted(() => {
  void load();
  timer = setInterval(() => void load(), REFRESH_MS);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
});
</script>

<template>
  <div ref="root" class="notif" @keydown="onKeydown">
    <button
      type="button"
      class="notif__trigger"
      :aria-label="unread > 0 ? t('notifications.unread', { count: unread }) : t('notifications.label')"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <CaIcon name="bell" :size="20" />
      <span v-if="unread > 0" class="notif__badge" aria-hidden="true">{{ unread > 9 ? '9+' : unread }}</span>
    </button>
    <div v-if="open" class="notif__panel" role="dialog" :aria-label="t('notifications.title')">
      <div class="notif__head">
        <h2 class="notif__title">{{ t('notifications.title') }}</h2>
        <button v-if="unread > 0" type="button" class="notif__seen" @click="markSeen">
          {{ t('notifications.markSeen') }}
        </button>
      </div>
      <p v-if="failed" class="notif__empty">{{ t('notifications.loadError') }}</p>
      <p v-else-if="items.length === 0" class="notif__empty">{{ t('notifications.empty') }}</p>
      <ul v-else class="notif__list">
        <li v-for="item in items" :key="item.id">
          <RouterLink
            :to="item.routePath"
            class="notif__item"
            :class="{ 'notif__item--unread': item.createdAt > seenAt }"
            @click="open = false"
          >
            <CaIcon
              :name="KIND_ICON[item.kind].icon"
              :size="16"
              class="notif__icon"
              :class="`notif__icon--${KIND_ICON[item.kind].tone}`"
            />
            <span class="notif__body">
              <span class="notif__kind">{{ t(`notifications.kinds.${item.kind}`) }}</span>
              <span class="notif__text">{{ item.title }}</span>
              <span class="notif__time">{{ formatDateTime(item.createdAt) }}</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.notif {
  position: relative;
}

.notif__trigger {
  position: relative;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--ca-radius-md);
  background: transparent;
  color: var(--ca-fg-3);
  cursor: pointer;
}

.notif__trigger:hover,
.notif__trigger[aria-expanded='true'] {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}

.notif__badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--ca-radius-circular);
  background: var(--ca-danger-stroke);
  color: var(--ca-fg-on-status);
  font-size: var(--ca-text-100);
  line-height: 16px;
  font-weight: var(--ca-font-weight-semibold);
  text-align: center;
}

.notif__panel {
  position: absolute;
  right: 0;
  top: calc(100% + var(--ca-space-2));
  z-index: var(--ca-z-dropdown);
  width: min(360px, calc(100vw - 32px));
  max-height: 480px;
  display: flex;
  flex-direction: column;
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-xl);
  box-shadow: var(--ca-shadow-28);
  overflow: hidden;
}

.notif__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
  padding: var(--ca-space-6) var(--ca-space-8);
  border-bottom: 1px solid var(--ca-stroke-2);
}

.notif__title {
  font-size: var(--ca-text-400);
  line-height: var(--ca-line-400);
  font-weight: var(--ca-font-weight-semibold);
}

.notif__seen {
  border: 0;
  background: transparent;
  color: var(--ca-color-link);
  font-weight: var(--ca-font-weight-semibold);
  cursor: pointer;
}

.notif__empty {
  padding: var(--ca-space-12) var(--ca-space-8);
  text-align: center;
  color: var(--ca-fg-3);
}

.notif__list {
  list-style: none;
  margin: 0;
  padding: var(--ca-space-2);
  overflow-y: auto;
}

.notif__item {
  display: flex;
  gap: var(--ca-space-4);
  padding: var(--ca-space-4) var(--ca-space-6);
  border-radius: var(--ca-radius-lg);
  color: var(--ca-fg-1);
  text-decoration: none;
}

.notif__item:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
  text-decoration: none;
}

.notif__item--unread {
  background: var(--ca-color-brand-subtle);
}

.notif__icon {
  flex: none;
  margin-top: 2px;
}

.notif__icon--success {
  color: var(--ca-success-fg);
}

.notif__icon--warning {
  color: var(--ca-warning-fg);
}

.notif__icon--danger {
  color: var(--ca-danger-fg);
}

.notif__body {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
  min-width: 0;
}

.notif__kind {
  font-weight: var(--ca-font-weight-semibold);
}

.notif__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notif__time {
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  color: var(--ca-fg-3);
}
</style>
