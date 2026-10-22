import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import MindThoughtList from './MindThoughtList.vue';
import { dominantMode, initials, truncate } from './mode-colors';

const i18n = createI18n({
  legacy: false,
  locale: 'id',
  messages: {
    id: {
      workspace: {
        mindMap: { modes: { second_brain: 'Multi Brain', counterpart: 'Partner', subordinate: 'Subordinate' } },
      },
    },
  },
});

describe('MindThoughtList', () => {
  it('menampilkan judul beserta nama mode', () => {
    const wrapper = mount(MindThoughtList, {
      props: {
        thoughts: [
          { id: '1', mode: 'second_brain', title: 'Strategi onboarding', status: null, at: '2026-10-20T08:00:00Z' },
          { id: '2', mode: 'subordinate', title: 'Ringkas laporan K3', status: 'completed', at: '2026-10-21T08:00:00Z' },
        ],
      },
      global: { plugins: [i18n] },
    });
    expect(wrapper.findAll('li')).toHaveLength(2);
    expect(wrapper.text()).toContain('Strategi onboarding');
    expect(wrapper.text()).toContain('Multi Brain');
    expect(wrapper.text()).toContain('Subordinate');
  });
});

describe('mode-colors helpers', () => {
  it('menentukan mode dominan, inisial, dan pemotongan teks', () => {
    expect(dominantMode({ second_brain: 1, counterpart: 5, subordinate: 2 })).toBe('counterpart');
    expect(initials('Budi Santoso Wijaya')).toBe('BS');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abc', 5)).toBe('abc');
  });
});
