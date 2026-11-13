<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute } from 'vue-router';
import type { NavApplicationDto, NavMenuItemDto } from '@bara/shared';
import { useConfigStore } from '@/stores/config.store';
import { useNavigationStore } from '@/stores/navigation.store';
import { CaBadge, CaIcon } from '@/components/ui';

const props = defineProps<{
  rail: boolean;
  mobileOpen: boolean;
}>();

const emit = defineEmits<{ 'toggle-rail': []; expand: [] }>();

const { t } = useI18n();
const route = useRoute();
const config = useConfigStore();
const navigation = useNavigationStore();
const appVersion = __APP_VERSION__;

const OPEN_GROUPS_KEY = 'ca.navOpen';

interface SidebarGroup {
  id: string;
  name: string;
  icon: string;
  items: NavMenuItemDto[];
}

function readOpenGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

const openGroups = ref<Set<string>>(readOpenGroups());

function persistOpenGroups(): void {
  try {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify([...openGroups.value]));
  } catch {
    // preferensi tampilan saja; abaikan bila storage tidak tersedia
  }
}

function linkedItems(app: NavApplicationDto): NavMenuItemDto[] {
  const all = [...app.items, ...app.modules.flatMap((m) => m.items)];
  return all.filter((item) => item.routePath !== null);
}

const groups = computed<SidebarGroup[]>(() =>
  navigation.applications
    .map((app) => ({ id: app.id, name: app.name, icon: app.icon ?? 'desk', items: linkedItems(app) }))
    .filter((g) => g.items.length > 0),
);

const currentPath = computed(() => route.meta.navPath ?? route.path);

function isActive(item: NavMenuItemDto): boolean {
  return item.routePath !== null && currentPath.value === item.routePath;
}

const activeGroupId = computed(() => groups.value.find((g) => g.items.some(isActive))?.id ?? null);
const homeActive = computed(() => route.name === 'home');

watch(
  activeGroupId,
  (id) => {
    if (id && !openGroups.value.has(id)) {
      openGroups.value = new Set([...openGroups.value, id]);
      persistOpenGroups();
    }
  },
  { immediate: true },
);

function isOpen(group: SidebarGroup): boolean {
  return openGroups.value.has(group.id);
}

function toggleGroup(group: SidebarGroup): void {
  if (props.rail) {
    openGroups.value = new Set([...openGroups.value, group.id]);
    persistOpenGroups();
    emit('expand');
    return;
  }
  const next = new Set(openGroups.value);
  if (next.has(group.id)) next.delete(group.id);
  else next.add(group.id);
  openGroups.value = next;
  persistOpenGroups();
}
</script>

<template>
  <aside
    class="sidebar"
    :class="{ 'sidebar--rail': rail, 'sidebar--open': mobileOpen }"
    :aria-label="t('shell.navigation')"
  >
    <RouterLink to="/" class="sidebar__brand" :title="config.appName">
      <span class="sidebar__logo" aria-hidden="true">{{ config.appName.charAt(0) }}</span>
      <span class="sidebar__brand-name">{{ config.appName }}</span>
    </RouterLink>

    <nav class="sidebar__nav">
      <RouterLink
        to="/"
        class="sidebar__group-head"
        :class="{ 'sidebar__group-head--active': homeActive }"
        :aria-current="homeActive ? 'page' : undefined"
        :title="rail ? t('shell.home') : undefined"
      >
        <CaIcon name="home" :size="20" class="sidebar__group-icon" />
        <span class="sidebar__label">{{ t('shell.home') }}</span>
      </RouterLink>

      <div v-for="group in groups" :key="group.id" class="sidebar__group">
        <button
          type="button"
          class="sidebar__group-head"
          :class="{ 'sidebar__group-head--active': group.id === activeGroupId }"
          :aria-expanded="rail ? undefined : isOpen(group)"
          :aria-label="rail ? group.name : undefined"
          :title="rail ? group.name : undefined"
          @click="toggleGroup(group)"
        >
          <CaIcon :name="group.icon" :size="20" class="sidebar__group-icon" />
          <span class="sidebar__label">{{ group.name }}</span>
          <CaIcon
            name="chevron-right"
            :size="16"
            class="sidebar__chevron"
            :class="{ 'sidebar__chevron--open': isOpen(group) }"
          />
        </button>
        <ul v-if="!rail && isOpen(group)" class="sidebar__items">
          <li v-for="item in group.items" :key="item.id">
            <RouterLink
              :to="item.routePath!"
              class="sidebar__item"
              :class="{ 'sidebar__item--active': isActive(item) }"
              :aria-current="isActive(item) ? 'page' : undefined"
            >
              <span class="sidebar__item-label">{{ item.label }}</span>
              <CaBadge v-if="item.isFuture" size="small" variant="neutral">{{ t('common.soon') }}</CaBadge>
            </RouterLink>
          </li>
        </ul>
      </div>

      <p v-if="navigation.loading && !navigation.loaded" class="sidebar__loading">{{ t('common.loading') }}</p>
    </nav>

    <div class="sidebar__footer">
      <a
        class="sidebar__credit"
        href="https://fusi24.com"
        target="_blank"
        rel="noopener noreferrer"
        :title="t('shell.developedBy') + ' Fusi Solusi'"
      >
        <img class="sidebar__credit-logo" src="/fusi-logo.png" alt="Fusi" width="24" height="24" />
        <span class="sidebar__credit-text">Fusi Solusi · v{{ appVersion }}</span>
      </a>
      <button
        type="button"
        class="sidebar__collapse"
        :aria-label="rail ? t('shell.expandSidebar') : t('shell.collapseSidebar')"
        :title="rail ? t('shell.expandSidebar') : t('shell.collapseSidebar')"
        @click="emit('toggle-rail')"
      >
        <CaIcon :name="rail ? 'chevron-right' : 'chevron-left'" :size="16" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--ca-sidebar-width);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--ca-bg-surface);
  border-right: 1px solid var(--ca-stroke-2);
  transition: width var(--ca-duration-normal) var(--ca-curve-point);
  z-index: 100;
}

.sidebar--rail {
  width: var(--ca-sidebar-rail-width);
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: var(--ca-space-6);
  height: var(--ca-topbar-height);
  padding: 0 var(--ca-space-6);
  border-bottom: 1px solid var(--ca-stroke-2);
  color: var(--ca-fg-1);
  text-decoration: none;
  flex: none;
}

.sidebar__brand:hover {
  color: var(--ca-fg-1);
  text-decoration: none;
}

.sidebar__logo {
  width: 32px;
  height: 32px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ca-radius-xl);
  background: var(--ca-color-brand-strong);
  color: var(--ca-fg-on-brand-strong);
  font-weight: var(--ca-font-weight-semibold);
  font-size: var(--ca-text-400);
}

.sidebar__brand-name {
  font-weight: var(--ca-font-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar__nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
  padding: var(--ca-space-6) var(--ca-space-4);
}

.sidebar__group {
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
}

.sidebar__group-head {
  display: flex;
  align-items: center;
  gap: var(--ca-space-6);
  width: 100%;
  min-height: 40px;
  padding: var(--ca-space-5) var(--ca-space-6);
  border: 0;
  border-radius: var(--ca-radius-lg);
  background: transparent;
  color: var(--ca-fg-1);
  font: inherit;
  font-weight: var(--ca-font-weight-semibold);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.sidebar__group-head:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
  text-decoration: none;
}

.sidebar__group-icon {
  flex: none;
  color: var(--ca-fg-3);
}

.sidebar__group-head--active .sidebar__group-icon {
  color: var(--ca-color-brand-text);
}

.sidebar__label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar__chevron {
  flex: none;
  color: var(--ca-fg-3);
  transition: transform var(--ca-duration-fast) var(--ca-curve-easy-ease);
}

.sidebar__chevron--open {
  transform: rotate(90deg);
}

.sidebar__items {
  list-style: none;
  margin: 0;
  padding: 0 0 var(--ca-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--ca-space-1);
}

.sidebar__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
  min-height: 36px;
  padding: var(--ca-space-4) var(--ca-space-6) var(--ca-space-4) 44px;
  border-radius: var(--ca-radius-lg);
  color: var(--ca-fg-1);
  text-decoration: none;
}

.sidebar__item:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
  text-decoration: none;
}

.sidebar__item-label {
  flex: 1;
  min-width: 0;
}

.sidebar__item--active,
.sidebar__item--active:hover {
  background: var(--ca-color-brand-subtle);
  font-weight: var(--ca-font-weight-semibold);
}

.sidebar__item--active::before {
  content: '';
  position: absolute;
  left: 30px;
  top: 10px;
  width: 3px;
  height: 16px;
  border-radius: var(--ca-radius-sm);
  background: var(--ca-color-brand-text);
}

.sidebar__loading {
  padding: var(--ca-space-4) var(--ca-space-6);
  color: var(--ca-fg-3);
}

.sidebar__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-4);
  padding: var(--ca-space-6) var(--ca-space-8);
  border-top: 1px solid var(--ca-stroke-2);
  flex: none;
}

.sidebar__credit {
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
  min-width: 0;
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  text-decoration: none;
}

.sidebar__credit:hover {
  color: var(--ca-fg-1);
}

.sidebar__credit-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar__collapse {
  width: 32px;
  height: 32px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-3);
  cursor: pointer;
}

.sidebar__collapse:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}

.sidebar--rail .sidebar__brand {
  padding: 0 var(--ca-space-6);
}

.sidebar--rail .sidebar__brand-name,
.sidebar--rail .sidebar__label,
.sidebar--rail .sidebar__chevron,
.sidebar--rail .sidebar__credit {
  display: none;
}

.sidebar--rail .sidebar__nav {
  padding: var(--ca-space-6) var(--ca-space-3);
}

.sidebar--rail .sidebar__group-head {
  justify-content: center;
  padding: var(--ca-space-5) 0;
}

.sidebar--rail .sidebar__footer {
  justify-content: center;
  padding: var(--ca-space-6) 0;
}

@media (max-width: 900px) {
  .sidebar,
  .sidebar--rail {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--ca-sidebar-width);
    z-index: 1100;
    transform: translateX(-100%);
    transition: transform var(--ca-duration-normal) var(--ca-curve-decelerate-mid);
    box-shadow: var(--ca-shadow-28);
  }

  .sidebar--open {
    transform: translateX(0);
  }

  .sidebar--rail .sidebar__brand-name,
  .sidebar--rail .sidebar__label,
  .sidebar--rail .sidebar__chevron,
  .sidebar--rail .sidebar__credit {
    display: revert;
  }

  .sidebar__collapse {
    display: none;
  }
}
</style>
