<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { NavMenuItemDto } from '@bara/shared';
import { useAuthStore } from '@/stores/auth.store';
import { useNavigationStore } from '@/stores/navigation.store';
import { CaBadge, CaEmptyState } from '@/components/ui';

const { t } = useI18n();
const auth = useAuthStore();
const navigation = useNavigationStore();

interface HomeItem {
  id: string;
  label: string;
  routePath: string;
  isFuture: boolean;
}

interface HomeGroup {
  key: string;
  label: string | null;
  items: HomeItem[];
}

interface HomeApp {
  id: string;
  name: string;
  groups: HomeGroup[];
}

function toHomeItem(item: NavMenuItemDto): HomeItem | null {
  if (item.routePath === null) return null;
  return { id: item.id, label: item.label, routePath: item.routePath, isFuture: item.isFuture };
}

function notNull(value: HomeItem | null): value is HomeItem {
  return value !== null;
}

const apps = computed<HomeApp[]>(() =>
  navigation.applications
    .map((app) => {
      const groups: HomeGroup[] = [];
      const direct = app.items.map(toHomeItem).filter(notNull);
      if (direct.length > 0) groups.push({ key: 'root', label: null, items: direct });
      for (const module of app.modules) {
        const items = module.items.map(toHomeItem).filter(notNull);
        if (items.length > 0) groups.push({ key: module.id, label: module.name, items });
      }
      return { id: app.id, name: app.name, groups };
    })
    .filter((app) => app.groups.length > 0),
);
</script>

<template>
  <div class="home">
    <header class="home__header">
      <h1 class="home__title">{{ t('home.title', { name: auth.user?.displayName ?? '' }) }}</h1>
      <p class="home__subtitle">{{ t('home.subtitle') }}</p>
    </header>

    <CaEmptyState
      v-if="apps.length === 0"
      :title="t('home.emptyTitle')"
      :description="t('home.emptyDescription')"
    />

    <div v-else class="home__grid">
      <section v-for="app in apps" :key="app.id" class="home__card">
        <h2 class="home__app-name">{{ app.name }}</h2>
        <div v-for="group in app.groups" :key="group.key" class="home__group">
          <p v-if="group.label" class="home__group-label">{{ group.label }}</p>
          <ul class="home__list">
            <li v-for="item in group.items" :key="item.id">
              <RouterLink :to="item.routePath" class="home__link">
                <span>{{ item.label }}</span>
                <CaBadge v-if="item.isFuture" size="small" variant="neutral">
                  {{ t('common.soon') }}
                </CaBadge>
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home__title {
  font-size: var(--ca-text-700);
  line-height: var(--ca-line-700);
  font-weight: var(--ca-font-weight-semibold);
}

.home__subtitle {
  margin-top: var(--ca-space-1);
  color: var(--ca-fg-3);
  font-size: var(--ca-text-300);
}

.home__grid {
  margin-top: var(--ca-space-6);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--ca-space-4);
}

.home__card {
  background: var(--ca-bg-surface);
  border: 1px solid var(--ca-stroke-2);
  border-radius: var(--ca-radius-lg);
  box-shadow: var(--ca-shadow-2);
  padding: var(--ca-space-4) var(--ca-space-4) var(--ca-space-5);
}

.home__app-name {
  font-size: var(--ca-text-400);
  font-weight: var(--ca-font-weight-semibold);
  margin-bottom: var(--ca-space-2);
}

.home__group + .home__group {
  margin-top: var(--ca-space-3);
}

.home__group-label {
  font-size: var(--ca-text-100);
  font-weight: var(--ca-font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ca-fg-3);
  margin-bottom: var(--ca-space-1);
}

.home__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.home__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ca-space-2);
  padding: var(--ca-space-1) var(--ca-space-2);
  margin: 0 calc(-1 * var(--ca-space-2));
  border-radius: var(--ca-radius-md);
  color: var(--ca-fg-2);
  text-decoration: none;
  font-size: var(--ca-text-200);
}

.home__link:hover {
  background: var(--ca-bg-surface-hover);
  color: var(--ca-fg-1);
}
</style>
