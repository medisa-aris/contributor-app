<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { useNavigationStore } from '@/stores/navigation.store';
import { useThemeStore, type ThemeMode } from '@/stores/theme.store';
import { CaAvatar, CaBreadcrumb, CaIcon, CaIconButton, CaMenu } from '@/components/ui';
import CommandPalette from './CommandPalette.vue';
import NotificationsMenu from './NotificationsMenu.vue';

const emit = defineEmits<{ 'toggle-mobile': [] }>();

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const navigation = useNavigationStore();
const theme = useThemeStore();

const paletteOpen = ref(false);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const shortcutLabel = isMac ? '⌘ K' : t('shell.searchShortcut');

const breadcrumbItems = computed(() => {
  const location = navigation.findByRoute(route.meta.navPath ?? route.path);
  if (location) return [{ label: location.application.name }, { label: location.item.label }];
  if (route.name === 'showcase') return [{ label: t('showcase.title') }];
  return [{ label: t('shell.home') }];
});

const themeMenuItems = computed(() => [
  { key: 'light', label: t('theme.light') },
  { key: 'dark', label: t('theme.dark') },
  { key: 'system', label: t('theme.system') },
]);

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

function onGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    paletteOpen.value = true;
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown));
</script>

<template>
  <header class="header">
    <CaIconButton class="header__menu" :label="t('shell.toggleNavigation')" @click="emit('toggle-mobile')">
      <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true">
        <path
          d="M2.5 5h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1 0-1.5Zm0 4.25h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1 0-1.5Zm0 4.25h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1 0-1.5Z"
        />
      </svg>
    </CaIconButton>

    <CaBreadcrumb :items="breadcrumbItems" class="header__crumbs" />

    <button type="button" class="header__search" @click="paletteOpen = true">
      <CaIcon name="search" :size="16" />
      <span class="header__search-text">{{ t('shell.searchMenu') }}</span>
      <kbd class="header__kbd">{{ shortcutLabel }}</kbd>
    </button>

    <div class="header__actions">
      <CaMenu :items="themeMenuItems" align="end" @select="theme.setMode($event as ThemeMode)">
        <template #trigger>
          <button type="button" class="header__icon" :aria-label="t('theme.label')">
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <circle cx="10" cy="10" r="6.5" />
              <path d="M10 3.5v13a6.5 6.5 0 0 0 0-13z" fill="currentColor" />
            </svg>
          </button>
        </template>
      </CaMenu>
      <NotificationsMenu />
      <CaMenu :items="userMenuItems" align="end" @select="onUserMenuSelect">
        <template #trigger>
          <button
            type="button"
            class="header__user"
            :aria-label="t('shell.profile', { name: auth.user?.displayName ?? '' })"
          >
            <CaAvatar :name="auth.user?.displayName ?? '?'" size="small" />
            <span class="header__user-name">{{ auth.user?.displayName }}</span>
          </button>
        </template>
      </CaMenu>
    </div>

    <CommandPalette v-model:open="paletteOpen" />
  </header>
</template>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ca-space-6) var(--ca-space-8);
  min-height: var(--ca-topbar-height);
  padding: var(--ca-space-3) var(--ca-space-12);
  background: var(--ca-bg-surface);
  border-bottom: 1px solid var(--ca-stroke-2);
}

.header__menu {
  display: none;
}

.header__crumbs {
  flex: 1 1 240px;
}

.header__search {
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
  flex: 0 1 360px;
  min-width: 200px;
  height: 32px;
  padding: 0 var(--ca-space-4) 0 var(--ca-space-6);
  border: 0;
  border-bottom: 1px solid var(--ca-stroke-accessible);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface-2);
  color: var(--ca-fg-3);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.header__search:hover {
  background: var(--ca-bg-surface-hover);
}

.header__search-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header__kbd {
  font-family: inherit;
  font-size: var(--ca-text-200);
  line-height: var(--ca-line-200);
  padding: var(--ca-space-1) var(--ca-space-3);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-md);
  background: var(--ca-bg-surface);
  color: var(--ca-fg-3);
}

.header__actions {
  display: flex;
  align-items: center;
  gap: var(--ca-space-2);
}

.header__icon {
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

.header__icon:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}

.header__user {
  display: flex;
  align-items: center;
  gap: var(--ca-space-4);
  height: 32px;
  margin-left: var(--ca-space-2);
  padding: 0 var(--ca-space-4) 0 var(--ca-space-2);
  border: 0;
  border-radius: var(--ca-radius-md);
  background: transparent;
  color: var(--ca-fg-1);
  font: inherit;
  font-weight: var(--ca-font-weight-semibold);
  cursor: pointer;
}

.header__user:hover {
  background: var(--ca-bg-surface-hover);
}

.header__user-name {
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 900px) {
  .header {
    padding: var(--ca-space-3) var(--ca-space-8);
  }

  .header__menu {
    display: inline-flex;
  }

  .header__crumbs {
    flex: 1 1 0;
    min-width: 0;
  }

  .header__search {
    order: 10;
    flex: 1 1 100%;
  }

  .header__kbd,
  .header__user-name {
    display: none;
  }
}
</style>
