import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { NavApplicationDto, NavMenuItemDto, NavModuleDto } from '@bara/shared';
import { apiGet } from '@/api/http';

export interface NavLocation {
  application: NavApplicationDto;
  module: NavModuleDto | null;
  item: NavMenuItemDto;
}

function findInItems(items: NavMenuItemDto[], routePath: string): NavMenuItemDto | null {
  for (const item of items) {
    if (item.routePath === routePath) return item;
    const child = findInItems(item.children, routePath);
    if (child) return child;
  }
  return null;
}

export const useNavigationStore = defineStore('navigation', () => {
  const applications = ref<NavApplicationDto[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  let inflight: Promise<void> | null = null;

  async function load(force = false): Promise<void> {
    if (inflight) return inflight;
    if (loaded.value && !force) return;
    loading.value = true;
    inflight = apiGet<NavApplicationDto[]>('/navigation')
      .then((tree) => {
        applications.value = tree;
        loaded.value = true;
      })
      .finally(() => {
        loading.value = false;
        inflight = null;
      });
    return inflight;
  }

  function reset(): void {
    applications.value = [];
    loaded.value = false;
  }

  function findByRoute(routePath: string): NavLocation | null {
    const normalize = (value: string) => (value.length > 1 ? value.replace(/\/+$/, '') : value);
    const target = normalize(routePath);
    for (const application of applications.value) {
      const appItem = findInItems(application.items, target);
      if (appItem) return { application, module: null, item: appItem };
      for (const module of application.modules) {
        const item = findInItems(module.items, target);
        if (item) return { application, module, item };
      }
    }
    return null;
  }

  function allRoutes(): string[] {
    const routes: string[] = [];
    const collect = (items: NavMenuItemDto[]) => {
      for (const item of items) {
        if (item.routePath) routes.push(item.routePath);
        collect(item.children);
      }
    };
    for (const application of applications.value) {
      collect(application.items);
      for (const module of application.modules) collect(module.items);
    }
    return routes;
  }

  return { applications, loading, loaded, load, reset, findByRoute, allRoutes };
});
