import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import ChatMessage from './ChatMessage.vue';

function mountMessage(props: Record<string, unknown>) {
  const i18n = createI18n({
    legacy: false,
    locale: 'id',
    messages: {
      id: {
        workspace: {
          chat: {
            tokenResponse: 'Token respons: konteks {input} · output {output}',
            copy: 'Salin',
            regenerate: 'Buat ulang',
          },
        },
      },
    },
  });
  return mount(ChatMessage, {
    props: { role: 'assistant', content: 'Halo', ...props },
    global: { plugins: [i18n] },
  });
}

describe('ChatMessage token usage', () => {
  it('menampilkan token konteks dan output saat showTokens aktif', () => {
    const wrapper = mountMessage({ tokensIn: 1234, tokensOut: 567, showTokens: true });
    expect(wrapper.text()).toContain('Token respons: konteks 1.234 · output 567');
  });

  it('menyembunyikan token saat showTokens nonaktif', () => {
    const wrapper = mountMessage({ tokensIn: 1234, tokensOut: 567, showTokens: false });
    expect(wrapper.text()).not.toContain('Token respons');
  });

  it('tidak menampilkan token pada pesan pengguna', () => {
    const wrapper = mountMessage({
      role: 'user',
      content: 'Halo',
      tokensIn: 1234,
      tokensOut: 567,
      showTokens: true,
    });
    expect(wrapper.text()).not.toContain('Token respons');
  });

  it('tidak menampilkan token bila keduanya kosong', () => {
    const wrapper = mountMessage({ tokensIn: null, tokensOut: null, showTokens: true });
    expect(wrapper.text()).not.toContain('Token respons');
  });
});
