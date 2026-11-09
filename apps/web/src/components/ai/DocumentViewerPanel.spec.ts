import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import DocumentViewerPanel from './DocumentViewerPanel.vue';

const preview = vi.hoisted(() => vi.fn());
vi.mock('@/api/documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/documents')>()),
  documentPreview: preview,
  fetchDocumentBlob: vi.fn(),
  downloadUserDocument: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: 'id',
  messages: {
    id: {
      common: { close: 'Tutup', loading: 'Memuat' },
      workspace: {
        chat: { copy: 'Salin', copied: 'Tersalin' },
        documents: {
          download: 'Unduh',
          viewer: { title: 'Pratinjau', loadFailed: 'Gagal', downloadFailed: 'Gagal unduh', slide: 'Slide {n}' },
        },
      },
    },
  },
});

function doc(format: string) {
  return {
    id: 'd1',
    conversation_id: null,
    message_id: null,
    title: 'Judul',
    format,
    file_name: `judul.${format}`,
    mime_type: '',
    size_bytes: 10,
    created_at: '',
  };
}

function mountPanel(format: string) {
  return mount(DocumentViewerPanel, {
    props: { doc: doc(format) as never },
    global: { plugins: [i18n] },
  });
}

describe('DocumentViewerPanel', () => {
  beforeEach(() => {
    preview.mockReset();
  });

  it('HTML dirender di iframe sandbox tanpa allow-same-origin', async () => {
    preview.mockResolvedValue({ id: 'd1', title: 'Judul', format: 'html', text: '<h1>Halo</h1>' });
    const wrapper = mountPanel('html');
    await flushPromises();
    const frame = wrapper.find('iframe');
    expect(frame.exists()).toBe(true);
    const sandbox = frame.attributes('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(frame.attributes('srcdoc')).toBe('<h1>Halo</h1>');
  });

  it('xlsx menampilkan tabel dengan header', async () => {
    preview.mockResolvedValue({
      id: 'd1',
      title: 'Judul',
      format: 'xlsx',
      text: null,
      sheets: [{ name: 'S1', rows: [['Nama', 'Nilai'], ['A', '1']] }],
    });
    const wrapper = mountPanel('xlsx');
    await flushPromises();
    expect(wrapper.findAll('th').map((th) => th.text())).toEqual(['Nama', 'Nilai']);
    expect(wrapper.findAll('td').map((td) => td.text())).toEqual(['A', '1']);
  });

  it('menampilkan pesan kesalahan bila pratinjau gagal dan memancarkan close', async () => {
    preview.mockRejectedValue(new Error('x'));
    const wrapper = mountPanel('md');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe('Gagal');
    await wrapper.find('button[aria-label="Tutup"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
