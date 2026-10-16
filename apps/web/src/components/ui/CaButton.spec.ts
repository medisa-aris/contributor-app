import { describe, expect, it, vi } from 'vitest';
import { createAppI18n } from '@/i18n';
import { mount } from '@vue/test-utils';
import CaButton from './CaButton.vue';

function mountButton(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(CaButton, {
    props,
    slots: { default: 'Simpan', ...slots },
    global: { plugins: [createAppI18n()] },
  });
}

describe('CaButton', () => {
  it('renders slot content and fires click', async () => {
    const onClick = vi.fn();
    const wrapper = mountButton({}, {});
    wrapper.vm.$el.addEventListener('click', onClick);
    await wrapper.trigger('click');
    expect(wrapper.text()).toContain('Simpan');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies variant and size classes', () => {
    const wrapper = mountButton({ variant: 'primary', size: 'large' });
    expect(wrapper.classes()).toContain('ca-button--primary');
    expect(wrapper.classes()).toContain('ca-button--large');
  });

  it('is disabled when disabled prop is set', async () => {
    const onClick = vi.fn();
    const wrapper = mountButton({ disabled: true });
    wrapper.vm.$el.addEventListener('click', onClick);
    await wrapper.trigger('click');
    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows a busy state while loading', () => {
    const wrapper = mountButton({ loading: true });
    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('.ca-spinner').exists()).toBe(true);
  });

  it('renders icon slots', () => {
    const wrapper = mountButton(
      {},
      { 'icon-start': '<svg data-test="icon" />', default: 'Tambah' },
    );
    expect(wrapper.find('[data-test="icon"]').exists()).toBe(true);
  });
});
