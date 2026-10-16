<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter, RouterView, RouterLink } from 'vue-router';
import type { NavMenuItemDto } from '@contributor/shared';
import { useAuthStore } from '@/stores/auth.store';
import { useConfigStore } from '@/stores/config.store';
import { useNavigationStore } from '@/stores/navigation.store';
import { useThemeStore, type ThemeMode } from '@/stores/theme.store';
import { CaAvatar, CaBadge, CaBreadcrumb, CaIconButton, CaMenu } from '@/components/ui';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const config = useConfigStore();
const navigation = useNavigationStore();
const theme = useThemeStore();

const sidebarOpen = ref(false);

watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false;
  },
);

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
  return item.routePath !== null && route.path.startsWith(item.routePath);
}
</script>

<template>
  <div class="shell">
    <a class="shell__skip" href="#main">{{ t('shell.skipToContent') }}</a>

    <aside class="shell__sidebar" :class="{ 'shell__sidebar--open': sidebarOpen }">
      <RouterLink to="/" class="shell__brand">
        <span class="shell__logo" aria-hidden="true">C</span>
        <span class="shell__brand-name">{{ config.appName }}</span>
      </RouterLink>

      <nav class="shell__nav" :aria-label="t('shell.navigation')">
        <section v-for="app in navigation.applications" :key="app.id" class="shell__app">
          <p class="shell__app-label">{{ app.name }}</p>
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
            <template v-for="module in app.modules" :key="module.id">
              <li class="shell__module-label">{{ module.name }}</li>
              <li v-for="item in module.items" :key="item.id">
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
        <p v-if="navigation.loading && !navigation.loaded" class="shell__nav-loading">
          {{ t('common.loading') }}
        </p>
      </nav>
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
  overflow-y: auto;
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

.shell__nav {
  padding: var(--ca-space-3) var(--ca-space-2) var(--ca-space-6);
}

.shell__app + .shell__app {
  margin-top: var(--ca-space-5);
}

.shell__app-label {
  margin: 0 0 var(--ca-space-1);
  padding: 0 var(--ca-space-3);
  font-size: var(--ca-text-100);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ca-fg-3);
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
  font-size: var(--ca-text-100);
  color: var(--ca-fg-4);
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
  font-size: var(--ca-text-200);
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

.shell__nav-loading {
  padding: var(--ca-space-2) var(--ca-space-3);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-200);
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
  .shell__content {
    padding: var(--ca-space-4);
  }
}
</style>
