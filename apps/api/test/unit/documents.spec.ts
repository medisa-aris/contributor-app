import { parseDocumentSpec } from '../../src/modules/documents/document-spec';
import { parseMarkdownBlocks } from '../../src/modules/documents/markdown-blocks';
import { renderDocument } from '../../src/modules/documents/renderers';

const MARKDOWN = [
  '# Ringkasan',
  '',
  'Paragraf dengan **tebal** dan `kode`.',
  '',
  '- butir satu',
  '- butir dua',
  '',
  '| Nama | Nilai |',
  '| --- | --- |',
  '| A | 1 |',
].join('\n');

describe('dokumen: validasi spec dari model', () => {
  it('menolak format tak dikenal dan judul kosong', () => {
    expect(() => parseDocumentSpec({ format: 'exe', title: 'x', content: 'y' })).toThrow(/Format/);
    expect(() => parseDocumentSpec({ format: 'md', title: '  ', content: 'y' })).toThrow(/Judul/);
    expect(() => parseDocumentSpec({ format: 'md', title: 'x', content: '  ' })).toThrow(/kosong/);
  });

  it('menolak JSON tidak valid dan merapikan JSON valid', () => {
    expect(() => parseDocumentSpec({ format: 'json', title: 'x', content: '{bad' })).toThrow(
      /JSON/,
    );
    expect(parseDocumentSpec({ format: 'json', title: 'x', content: '{"a":1}' }).content).toBe(
      '{\n  "a": 1\n}',
    );
  });

  it('xlsx butuh sheet; nama sheet dibersihkan; pptx butuh slide', () => {
    expect(() => parseDocumentSpec({ format: 'xlsx', title: 'x' })).toThrow(/sheet/);
    const xlsx = parseDocumentSpec({
      format: 'xlsx',
      title: 'x',
      sheets: [{ name: 'a/b:c', rows: [['h'], [1]] }],
    });
    expect(xlsx.sheets?.[0]).toEqual({ name: 'a b c', rows: [['h'], ['1']] });
    expect(() => parseDocumentSpec({ format: 'pptx', title: 'x' })).toThrow(/slide/);
  });
});

describe('dokumen: parser Markdown', () => {
  it('mengenali judul, paragraf, daftar, dan tabel', () => {
    const types = parseMarkdownBlocks(MARKDOWN).map((b) => b.type);
    expect(types).toEqual(['heading', 'paragraph', 'bullet', 'bullet', 'table']);
  });
});

describe('dokumen: renderer', () => {
  it('menulis format teks apa adanya', async () => {
    const out = await renderDocument({ format: 'html', title: 't', content: '<p>hai</p>' });
    expect(out.buffer.toString()).toBe('<p>hai</p>');
    expect(out.mimeType).toMatch(/text\/html/);
  });

  it.each([
    ['docx', 'PK'],
    ['pdf', '%PDF'],
  ] as const)('menghasilkan berkas %s yang valid', async (format, magic) => {
    const out = await renderDocument({ format, title: 'Laporan', content: MARKDOWN });
    expect(out.buffer.subarray(0, magic.length).toString('latin1')).toBe(magic);
    expect(out.contentText).toBe(MARKDOWN);
  });

  it('menghasilkan xlsx dan pptx (zip OOXML) dengan data pratinjau', async () => {
    const xlsx = await renderDocument({
      format: 'xlsx',
      title: 'Data',
      sheets: [
        {
          name: 'S1',
          rows: [
            ['Nama', 'Nilai'],
            ['A', '1'],
          ],
        },
      ],
    });
    expect(xlsx.buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(xlsx.previewJson).toEqual({
      sheets: [
        {
          name: 'S1',
          rows: [
            ['Nama', 'Nilai'],
            ['A', '1'],
          ],
        },
      ],
    });

    const pptx = await renderDocument({
      format: 'pptx',
      title: 'Deck',
      slides: [{ title: 'Satu', bullets: ['a', 'b'] }],
    });
    expect(pptx.buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(pptx.contentText).toContain('## Satu');
  });
});
