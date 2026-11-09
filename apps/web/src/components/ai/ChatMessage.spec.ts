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
            webUsed: 'Menggunakan pencarian web',
            webFailed: 'Pencarian web gagal',
            webSearches: '{n} pencarian',
            webPages: '{n} halaman dibaca',
            guardMasked: 'Data pribadi dimasking oleh Guardrails',
            guardCount: '{n} data',
            guardCustom: 'Istilah tambahan',
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

describe('ChatMessage dokumen', () => {
  const doc = {
    id: 'd1',
    conversation_id: 'c1',
    message_id: '1',
    title: 'Laporan Cuti',
    format: 'xlsx',
    file_name: 'Laporan-Cuti.xlsx',
    mime_type: 'application/octet-stream',
    size_bytes: 2048,
    created_at: '',
  };

  it('menampilkan kartu dokumen dan memancarkan openDocument saat diklik', async () => {
    const wrapper = mountMessage({ documents: [doc] });
    const card = wrapper.find('.doc-card');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain('Laporan Cuti');
    expect(card.text()).toContain('Excel');
    await card.trigger('click');
    expect(wrapper.emitted('openDocument')?.[0]).toEqual([doc]);
  });

  it('tidak menampilkan kartu bila tidak ada dokumen', () => {
    expect(mountMessage({}).find('.doc-card').exists()).toBe(false);
  });
});

describe('ChatMessage info pencarian web', () => {
  const step = (name: string, status: string, source: string | null) => ({
    id: `${name}-${source}`,
    name,
    label: name,
    source,
    input: {},
    status,
    summary: '',
  });

  it('merangkum pencarian, halaman, dan penyedia di atas baris tanggal', () => {
    const wrapper = mountMessage({
      createdAt: '2026-11-09T01:00:00Z',
      toolSteps: [
        step('web_search', 'ok', 'Tavily'),
        step('web_search', 'ok', 'Tavily'),
        step('web_read', 'ok', 'Firecrawl'),
      ],
    });
    const info = wrapper.get('.msg__web');
    expect(info.text()).toBe(
      'Menggunakan pencarian web · 2 pencarian · 1 halaman dibaca · Tavily, Firecrawl',
    );
    expect(
      info.element.compareDocumentPosition(wrapper.get('.msg__footer').element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('menandai bila semua pencarian gagal', () => {
    const wrapper = mountMessage({ toolSteps: [step('web_search', 'error', null)] });
    expect(wrapper.get('.msg__web').text()).toBe('Pencarian web gagal');
  });

  it('tidak tampil tanpa langkah web atau saat masih berjalan', () => {
    expect(
      mountMessage({ toolSteps: [step('db_query', 'ok', 'HSE')] })
        .find('.msg__web')
        .exists(),
    ).toBe(false);
    expect(
      mountMessage({ pending: true, toolSteps: [step('web_search', 'ok', 'Tavily')] })
        .find('.msg__web')
        .exists(),
    ).toBe(false);
  });
});

describe('ChatMessage info Guardrails', () => {
  const mountWith = (props: Record<string, unknown>) =>
    mountMessage({ createdAt: '2026-11-09T01:00:00Z', ...props });

  it('merangkum jumlah dan jenis data di atas baris tanggal', () => {
    const wrapper = mountWith({ guardrails: { full_name: 2, email: 3, custom: 1 } });
    const info = wrapper.find('.msg__web');
    expect(info.text()).toBe(
      'Data pribadi dimasking oleh Guardrails · 6 data · Nama lengkap, Alamat email, Istilah tambahan',
    );
    expect(info.element.nextElementSibling?.classList.contains('msg__footer')).toBe(true);
  });

  it('tidak tampil tanpa masking, saat berjalan, atau pada pesan pengguna', () => {
    expect(mountWith({ guardrails: null }).find('.msg__web').exists()).toBe(false);
    expect(mountWith({ guardrails: {} }).find('.msg__web').exists()).toBe(false);
    expect(mountWith({ guardrails: { email: 1 }, pending: true }).find('.msg__web').exists()).toBe(false);
    expect(mountWith({ guardrails: { email: 1 }, role: 'user' }).find('.msg__web').exists()).toBe(false);
  });
});
