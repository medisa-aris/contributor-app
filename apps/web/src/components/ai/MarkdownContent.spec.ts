import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import MarkdownContent from './MarkdownContent.vue';

function mountMarkdown(content: string) {
  const i18n = createI18n({ legacy: false, locale: 'id', messages: { id: {} } });
  return mount(MarkdownContent, { props: { content }, global: { plugins: [i18n] } });
}

describe('MarkdownContent', () => {
  it('merender tebal, daftar, dan tabel', () => {
    const wrapper = mountMarkdown('**Judul**\n\n- satu\n- dua\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(wrapper.find('strong').text()).toBe('Judul');
    expect(wrapper.findAll('li')).toHaveLength(2);
    expect(wrapper.find('table').exists()).toBe(true);
  });

  it('membersihkan HTML berbahaya', () => {
    const wrapper = mountMarkdown('halo <script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(wrapper.html()).not.toContain('<script');
    expect(wrapper.html()).not.toContain('onerror');
  });

  it('membuka tautan di tab baru dengan rel aman', () => {
    const wrapper = mountMarkdown('[BeLead AI](https://example.com)');
    const link = wrapper.find('a');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toContain('noopener');
  });
});
