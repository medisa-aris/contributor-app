import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import MemoryDoorsBar from './MemoryDoorsBar.vue';

const api = vi.hoisted(() => ({
  memoryReach: vi.fn(),
  contextDoors: vi.fn(),
  setContextDoors: vi.fn(),
}));
vi.mock('@/api/memory', () => api);

const granted = vi.hoisted(() => new Set<string>());
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ can: (p: string) => granted.has(p) }) }));

const i18n = createI18n({
  legacy: false,
  locale: 'id',
  missingWarn: false,
  fallbackWarn: false,
  messages: { id: {} },
});

const reach = [
  {
    subjectId: 's-staf',
    kind: 'user',
    refId: 'u1',
    name: 'Staf',
    caption: 'Analis',
    departmentName: 'IT',
    granted: true,
    visibleEntries: 3,
  },
  {
    subjectId: 's-admin',
    kind: 'user',
    refId: 'u2',
    name: 'Admin',
    caption: null,
    departmentName: 'IT',
    granted: false,
    visibleEntries: 0,
  },
];

function grant(...permissions: string[]): void {
  granted.clear();
  permissions.forEach((p) => granted.add(p));
}

describe('MemoryDoorsBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.values(api).forEach((fn) => fn.mockReset());
    api.memoryReach.mockResolvedValue(reach);
    api.contextDoors.mockResolvedValue([]);
  });

  it('tersembunyi tanpa izin membuka pintu', async () => {
    grant('ai.memory.self.manage');
    const wrapper = mount(MemoryDoorsBar, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('.mbar').exists()).toBe(false);
    expect(api.memoryReach).not.toHaveBeenCalled();
  });

  it('memilih pintu lewat v-model; pintu yang belum diizinkan tidak bisa dibuka', async () => {
    grant('ai.memory.self.manage', 'ai.memory.doors.open');
    const wrapper = mount(MemoryDoorsBar, {
      props: { modelValue: [], 'onUpdate:modelValue': (v: string[]) => wrapper.setProps({ modelValue: v }) },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await wrapper.find('.mbar__add').trigger('click');
    const switches = wrapper.findAll('.mbar__item input[type="checkbox"]');
    expect(switches).toHaveLength(2);
    expect(switches[1]!.attributes('disabled')).toBeDefined();

    await switches[0]!.setValue(true);
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([['s-staf']]);
    expect(wrapper.findAll('.mbar__chip').map((c) => c.text())).toEqual([expect.stringContaining('Staf')]);
    expect(api.setContextDoors).not.toHaveBeenCalled();
  });

  it('pintu percakapan yang izinnya dicabut tampil tercoret', async () => {
    grant('ai.memory.self.manage', 'ai.memory.doors.open');
    api.contextDoors.mockResolvedValue([{ ...reach[0], effective: false }]);
    const wrapper = mount(MemoryDoorsBar, {
      props: { conversationId: 'c1', ensureConversation: async () => 'c1' },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(api.contextDoors).toHaveBeenCalledWith('conversation', 'c1');
    expect(wrapper.find('.mbar__chip--revoked').exists()).toBe(true);
  });
});
