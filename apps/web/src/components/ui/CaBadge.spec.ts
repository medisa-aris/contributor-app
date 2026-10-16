import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CaBadge from './CaBadge.vue';

describe('CaBadge', () => {
  it('renders default neutral medium badge', () => {
    const wrapper = mount(CaBadge, { slots: { default: 'Staf' } });
    expect(wrapper.text()).toBe('Staf');
    expect(wrapper.classes()).toContain('ca-badge--neutral');
    expect(wrapper.classes()).toContain('ca-badge--medium');
  });

  it('supports variant and strong modifiers', () => {
    const wrapper = mount(CaBadge, {
      props: { variant: 'danger', strong: true, size: 'small' },
      slots: { default: 'Terlarang' },
    });
    expect(wrapper.classes()).toContain('ca-badge--danger');
    expect(wrapper.classes()).toContain('ca-badge--strong');
    expect(wrapper.classes()).toContain('ca-badge--small');
  });
});
