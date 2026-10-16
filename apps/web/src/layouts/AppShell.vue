<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter, RouterView, RouterLink } from 'vue-router';
import type { NavMenuItemDto } from '@contributor/shared';
import { useAuthStore } from '@/stores/auth.store';
import { useConfigStore } from '@/stores/config.store';
import { useNavigationStore } from '@/stores/navigation.store';
import { useThemeStore, type ThemeMode } from '@/stores/theme.store';
import { CaAvatar, CaBadge, CaBreadcrumb, CaIcon, CaIconButton, CaInput, CaMenu } from '@/components/ui';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const config = useConfigStore();
const navigation = useNavigationStore();
const theme = useThemeStore();

const SIDEBAR_COLLAPSE_KEY = 'ca.sidebarCollapsed';
const sidebarOpen = ref(false);
const collapsed = ref(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1');
const menuQuery = ref('');

watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false;
    menuQuery.value = '';
  },
);

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value;
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed.value ? '1' : '0');
}

const breadcrumbItems = computed(() => {
  const location = navigation.findByRoute(route.path);
  const items: { label: string; to?: string }[] = [{ label: config.appName }];
  if (location) {
    items.push({ label: location.application.name });
    if (location.module) items.push({ label: location.module.name });
    items.push({ label: location.item.label });
  } else if (route.name === 'home') {
    items.push({ label: t('shell.home') });
  } else if (route.name === 'showcase') {
    items.push({ label: t('showcase.title') });
  }
  return items;
});

const themeMenuItems = computed(() => [
  { key: 'light', label: t('theme.light') },
  { key: 'dark', label: t('theme.dark') },
  { key: 'system', label: t('theme.system') },
]);

function onThemeSelect(key: string): void {
  theme.setMode(key as ThemeMode);
}

const userMenuItems = computed(() => [
  { key: 'showcase', label: t('shell.showcase') },
  { key: 'logout', label: t('shell.logout'), danger: true, divider: true },
]);

async function onUserMenuSelect(key: string): Promise<void> {
  if (key === 'showcase') {
    await router.push('/showcase');
    return;
  }
  if (key === 'logout') {
    await auth.logout();
    navigation.reset();
    await router.push({ name: 'login' });
  }
}

function isActive(item: NavMenuItemDto): boolean {
  if (item.routePath === null) return false;
  const current = route.meta.navPath ?? route.path;
  return current === item.routePath;
}

interface SearchModuleNode {
  id: string;
  name: string;
  items: NavMenuItemDto[];
}

interface SearchAppNode {
  id: string;
  name: string;
  icon: string | null;
  items: NavMenuItemDto[];
  modules: SearchModuleNode[];
}

const searching = computed(() => menuQuery.value.trim().length > 0);

const visibleApps = computed<SearchAppNode[]>(() => {
  if (!searching.value) {
    return navigation.applications.map((app) => ({
      id: app.id,
      name: app.name,
      icon: app.icon,
      items: app.items,
      modules: app.modules,
    }));
  }
  const q = menuQuery.value.trim().toLowerCase();
  const out: SearchAppNode[] = [];
  for (const app of navigation.applications) {
    if (app.name.toLowerCase().includes(q)) {
      out.push({ id: app.id, name: app.name, icon: app.icon, items: app.items, modules: app.modules });
      continue;
    }
    const modules: SearchModuleNode[] = [];
    for (const mod of app.modules) {
      if (mod.name.toLowerCase().includes(q)) {
        modules.push({ id: mod.id, name: mod.name, items: mod.items });
        continue;
      }
      const items = mod.items.filter((item) => item.label.toLowerCase().includes(q));
      if (items.length > 0) modules.push({ id: mod.id, name: mod.name, items });
    }
    const items = app.items.filter((item) => item.label.toLowerCase().includes(q));
    if (modules.length > 0 || items.length > 0) {
      out.push({ id: app.id, name: app.name, icon: app.icon, items, modules });
    }
  }
  return out;
});
</script>

<template>
  <div class="shell">
    <a class="shell__skip" href="#main">{{ t('shell.skipToContent') }}</a>

    <button
      v-if="collapsed"
      type="button"
      class="shell__reopen"
      :aria-label="t('shell.expandSidebar')"
      :title="t('shell.expandSidebar')"
      @click="toggleCollapsed"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true">
        <path d="M7.4 4.4a.75.75 0 0 1 1.1 0l5.5 5.5a.75.75 0 0 1 0 1l-5.5 5.6a.75.75 0 1 1-1.1-1.1L12.3 10 7.4 5.5a.75.75 0 0 1 0-1.1Z" />
      </svg>
    </button>

    <aside
      class="shell__sidebar"
      :class="{ 'shell__sidebar--open': sidebarOpen, 'shell__sidebar--collapsed': collapsed }"
      :aria-hidden="collapsed"
    >
      <RouterLink to="/" class="shell__brand">
        <span class="shell__logo" aria-hidden="true">C</span>
        <span class="shell__brand-name">{{ config.appName }}</span>
      </RouterLink>

      <div class="shell__search">
        <svg
          class="shell__search-icon"
          viewBox="0 0 20 20"
          fill="currentColor"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path d="M8.75 3a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5ZM1.5 8.75a7.25 7.25 0 1 1 12.9 4.5l3.07 3.06a.75.75 0 1 1-1.06 1.06l-3.07-3.07A7.25 7.25 0 0 1 1.5 8.75Z" />
        </svg>
        <CaInput
          v-model="menuQuery"
          type="search"
          class="shell__search-input"
          :placeholder="t('shell.searchMenu')"
          :aria-label="t('shell.searchMenu')"
          autocomplete="off"
        />
        <button
          v-if="menuQuery"
          type="button"
          class="shell__search-clear"
          :aria-label="t('shell.searchClear')"
          @click="menuQuery = ''"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" aria-hidden="true">
            <path d="M10 8.8 5.9 4.7a.75.75 0 1 0-1.1 1L8.9 10l-4.1 4.2a.75.75 0 1 0 1 1.1L10 11.1l4.2 4.1a.75.75 0 1 0 1-1L11.1 10l4.1-4.2a.75.75 0 1 0-1.1-1L10 8.8Z" />
          </svg>
        </button>
      </div>

      <nav class="shell__nav" :aria-label="t('shell.navigation')">
        <template v-if="visibleApps.length > 0">
          <section v-for="app in visibleApps" :key="app.id" class="shell__app">
            <p class="shell__app-label">
              <CaIcon v-if="app.icon" :name="app.icon" class="shell__app-icon" :size="16" />
              <span>{{ app.name }}</span>
            </p>
            <ul class="shell__list">
              <li v-for="item in app.items" :key="item.id">
                <RouterLink
                  v-if="item.routePath"
                  :to="item.routePath"
                  class="shell__link"
                  :class="{ 'shell__link--active': isActive(item) }"
                >
                  <span>{{ item.label }}</span>
                  <CaBadge v-if="item.isFuture" size="small" variant="neutral">{{ t('common.soon') }}</CaBadge>
                </RouterLink>
              </li>
              <template v-for="mod in app.modules" :key="mod.id">
                <li class="shell__module-label">{{ mod.name }}</li>
                <li v-for="item in mod.items" :key="item.id">
                  <RouterLink
                    v-if="item.routePath"
                    :to="item.routePath"
                    class="shell__link"
                    :class="{ 'shell__link--active': isActive(item) }"
                  >
                    <span>{{ item.label }}</span>
                    <CaBadge v-if="item.isFuture" size="small" variant="neutral">{{ t('common.soon') }}</CaBadge>
                  </RouterLink>
                </li>
              </template>
            </ul>
          </section>
        </template>
        <p v-else-if="searching" class="shell__search-empty">{{ t('shell.searchEmpty') }}</p>
        <p v-else-if="navigation.loading && !navigation.loaded" class="shell__nav-loading">
          {{ t('common.loading') }}
        </p>
      </nav>

      <div class="shell__sidebar-footer">
        <button
          type="button"
          class="shell__collapse"
          :aria-label="t('shell.collapseSidebar')"
          :title="t('shell.collapseSidebar')"
          @click="toggleCollapsed"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
            <path d="M12.6 4.4a.75.75 0 0 0-1.1 0L6 10l5.5 5.5a.75.75 0 1 0 1.1-1L8.2 10l4.4-4.5a.75.75 0 0 0 0-1.1Z" />
          </svg>
        </button>
      </div>
    </aside>

    <div v-if="sidebarOpen" class="shell__scrim" aria-hidden="true" @click="sidebarOpen = false" />

    <div class="shell__main">
      <header class="shell__topbar">
        <CaIconButton
          class="shell__menu-toggle"
          :label="t('shell.toggleNavigation')"
          @click="sidebarOpen = !sidebarOpen"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path d="M2.5 5h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1 0-1.5Zm0 4.25h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1 0-1.5Zm0 4.25h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1 0-1.5Z" />
          </svg>
        </CaIconButton>
        <CaBreadcrumb :items="breadcrumbItems" />
        <span class="shell__spacer" />
        <CaMenu :items="themeMenuItems" align="end" @select="onThemeSelect">
          <template #trigger>
            <CaIconButton :label="t('theme.label')">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 1.5v13a6.5 6.5 0 0 1 0-13Z" />
              </svg>
            </CaIconButton>
          </template>
        </CaMenu>
        <CaMenu :items="userMenuItems" align="end" @select="onUserMenuSelect">
          <template #trigger>
            <button type="button" class="shell__user" :aria-label="t('shell.userMenu')">
              <CaAvatar :name="auth.user?.displayName ?? '?'" size="small" />
              <span class="shell__user-name">{{ auth.user?.displayName }}</span>
            </button>
          </template>
        </CaMenu>
      </header>

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
  z-index: 2000;
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

.shell__sidebar {
  width: var(--ca-sidebar-width);
  flex-shrink: 0;
  background: var(--ca-bg-surface);
  border-right: 1px solid var(--ca-stroke-1);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}

.shell__brand {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  padding: var(--ca-space-4);
  border-bottom: 1px solid var(--ca-stroke-1);
  color: inherit;
  text-decoration: none;
}

.shell__logo {
  width: 32px;
  height: 32px;
  border-radius: var(--ca-radius-md);
  background: linear-gradient(135deg, var(--ca-brand-60), var(--ca-brand-100));
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: var(--ca-text-300);
  flex-shrink: 0;
}

.shell__brand-name {
  font-size: var(--ca-text-300);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shell__search {
  position: relative;
  padding: var(--ca-space-3) var(--ca-space-3) var(--ca-space-2);
}

.shell__search-icon {
  position: absolute;
  left: calc(var(--ca-space-3) + var(--ca-space-3));
  top: 50%;
  transform: translateY(-50%);
  color: var(--ca-fg-3);
  pointer-events: none;
}

.shell__search-input {
  padding-left: 36px;
  padding-right: 32px;
}

.shell__search-clear {
  position: absolute;
  right: calc(var(--ca-space-3) + var(--ca-space-2));
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--ca-radius-circular);
  background: transparent;
  color: var(--ca-fg-3);
  cursor: pointer;
}
.shell__search-clear:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}

.shell__nav {
  flex: 1;
  overflow-y: auto;
  padding: var(--ca-space-2) var(--ca-space-2) var(--ca-space-6);
}

.shell__app + .shell__app {
  margin-top: var(--ca-space-5);
}

.shell__app-label {
  margin: 0 0 var(--ca-space-1);
  padding: 0 var(--ca-space-3);
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  font-size: var(--ca-text-200);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ca-color-brand);
}

.shell__app-icon {
  flex-shrink: 0;
}

.shell__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.shell__module-label {
  margin-top: var(--ca-space-2);
  padding: var(--ca-space-1) var(--ca-space-3);
  font-size: var(--ca-text-200);
  color: var(--ca-color-brand-soft);
}

.shell__link {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-2);
  padding: var(--ca-space-2) var(--ca-space-3);
  border-radius: var(--ca-radius-md);
  color: var(--ca-fg-2);
  text-decoration: none;
  font-size: var(--ca-text-300);
  transition: background var(--ca-duration-fast) var(--ca-curve-easy-ease);
}
.shell__link:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}
.shell__link--active {
  background: var(--ca-color-brand-subtle);
  color: var(--ca-color-brand);
  font-weight: 600;
}
.shell__link--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: var(--ca-radius-circular);
  background: var(--ca-color-brand);
}

.shell__search-empty,
.shell__nav-loading {
  padding: var(--ca-space-2) var(--ca-space-3);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-300);
}

.shell__sidebar-footer {
  margin-top: auto;
  padding: var(--ca-space-3);
  border-top: 1px solid var(--ca-stroke-1);
  display: flex;
  justify-content: flex-end;
}

.shell__collapse {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ca-radius-circular);
  border: 1px solid var(--ca-stroke-1);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-2);
  cursor: pointer;
  transition:
    color var(--ca-duration-fast) var(--ca-curve-easy-ease),
    border-color var(--ca-duration-fast) var(--ca-curve-easy-ease),
    background var(--ca-duration-fast) var(--ca-curve-easy-ease);
}
.shell__collapse:hover {
  color: var(--ca-color-brand);
  border-color: var(--ca-color-brand);
  background: var(--ca-color-brand-subtle);
}

.shell__reopen {
  position: fixed;
  left: var(--ca-space-4);
  bottom: var(--ca-space-4);
  z-index: 1200;
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ca-radius-circular);
  border: 1px solid var(--ca-stroke-1);
  background: var(--ca-bg-surface);
  color: var(--ca-color-brand);
  box-shadow: var(--ca-shadow-8);
  cursor: pointer;
  animation:
    shell-reopen-in var(--ca-duration-normal) var(--ca-curve-decelerate-mid) both,
    shell-reopen-float 2.4s ease-in-out var(--ca-duration-slow) infinite alternate;
}
.shell__reopen:hover {
  background: var(--ca-color-brand-subtle);
  border-color: var(--ca-color-brand);
}

@keyframes shell-reopen-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.85);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes shell-reopen-float {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-5px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .shell__reopen {
    animation: none;
  }
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

.shell__topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  min-height: var(--ca-topbar-height);
  padding: 0 var(--ca-space-4);
  background: var(--ca-bg-surface);
  border-bottom: 1px solid var(--ca-stroke-1);
}

.shell__menu-toggle {
  display: none;
}

.shell__spacer {
  flex: 1;
}

.shell__user {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
  padding: var(--ca-space-1) var(--ca-space-2);
  background: transparent;
  border: none;
  border-radius: var(--ca-radius-md);
  color: var(--ca-fg-1);
  cursor: pointer;
  font: inherit;
  font-size: var(--ca-text-200);
}
.shell__user:hover {
  background: var(--ca-bg-surface-hover);
}

.shell__user-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shell__content {
  flex: 1;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--ca-space-6);
}

@media (min-width: 901px) {
  .shell__sidebar {
    overflow: hidden;
    transition:
      width var(--ca-duration-normal) var(--ca-curve-decelerate-mid),
      visibility 0s linear var(--ca-duration-normal);
  }
  .shell__sidebar--collapsed {
    width: 0;
    border-right: none;
    visibility: hidden;
  }
}

@media (max-width: 900px) {
  .shell__sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 1100;
    transform: translateX(-100%);
    transition: transform var(--ca-duration-normal) var(--ca-curve-decelerate-mid);
    box-shadow: var(--ca-shadow-28);
  }
  .shell__sidebar--open {
    transform: translateX(0);
  }
  .shell__scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1050;
    background: var(--ca-bg-overlay);
  }
  .shell__menu-toggle {
    display: inline-flex;
  }
  .shell__sidebar-footer,
  .shell__reopen {
    display: none;
  }
  .shell__content {
    padding: var(--ca-space-4);
  }
}
</style>
