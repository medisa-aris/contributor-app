import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AuthUserDto, MeDto } from '@contributor/shared';
import { apiGet, apiPost, setCsrfToken } from '@/api/http';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUserDto | null>(null);
  const permissionSet = ref<Set<string>>(new Set());
  const ready = ref(false);

  const authenticated = computed(() => user.value !== null);
  const isSuperadmin = computed(() => user.value?.isSuperadmin ?? false);
  const permissions = computed(() => Array.from(permissionSet.value).sort());

  function applyMe(me: MeDto): void {
    user.value = me.user;
    permissionSet.value = new Set(me.permissions);
    setCsrfToken(me.csrfToken);
  }

  function clear(): void {
    user.value = null;
    permissionSet.value = new Set();
    setCsrfToken(null);
  }

  async function login(email: string, password: string): Promise<void> {
    const me = await apiPost<MeDto>('/auth/login', { email, password });
    applyMe(me);
    ready.value = true;
  }

  async function fetchMe(): Promise<void> {
    try {
      const me = await apiGet<MeDto>('/auth/me');
      applyMe(me);
    } catch {
      clear();
    } finally {
      ready.value = true;
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiPost('/auth/logout');
    } finally {
      clear();
    }
  }

  function can(permission: string): boolean {
    return isSuperadmin.value || permissionSet.value.has(permission);
  }

  function canAny(...candidates: string[]): boolean {
    return isSuperadmin.value || candidates.some((permission) => permissionSet.value.has(permission));
  }

  return {
    user,
    ready,
    authenticated,
    isSuperadmin,
    permissions,
    login,
    fetchMe,
    logout,
    can,
    canAny,
    clear,
  };
});
