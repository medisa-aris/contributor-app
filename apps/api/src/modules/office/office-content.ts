import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { OfficeParser } from 'officeparser';

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx';

export const OFFICE_FORMATS: readonly OfficeFormat[] = ['docx', 'xlsx', 'pptx'];

export function isOfficeFormat(value: string): value is OfficeFormat {
  return (OFFICE_FORMATS as readonly string[]).includes(value);
}

/** Jenis editor OnlyOffice untuk tiap format. */
export const DOCUMENT_TYPE: Record<OfficeFormat, 'word' | 'cell' | 'slide'> = {
  docx: 'word',
  xlsx: 'cell',
  pptx: 'slide',
};

const PREVIEW_LIMITS = { maxSheets: 10, maxRows: 500, maxColumns: 50, maxSlides: 60 } as const;

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Teks tiap paragraf <a:p> dalam satu shape/blok XML DrawingML. */
export function drawingParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const match of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p [^>]*>([\s\S]*?)<\/a:p>/g)) {
    const inner = match[1] ?? match[2] ?? '';
    const text = Array.from(inner.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g), (m) =>
      decodeXml(m[1] ?? ''),
    ).join('');
    if (text.trim()) paragraphs.push(text.trim());
  }
  return paragraphs;
}

function slideNumber(path: string): number {
  return Number(/slide(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/** Ringkasan slide (judul + poin) dari pptx hasil suntingan. */
export async function pptxSlides(
  buffer: Buffer,
): Promise<Array<{ title: string; bullets: string[] }>> {
  const zip = await JSZip.loadAsync(buffer);
  const paths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .slice(0, PREVIEW_LIMITS.maxSlides);
  const slides: Array<{ title: string; bullets: string[] }> = [];
  for (const path of paths) {
    const xml = await zip.file(path)!.async('string');
    let title = '';
    const bullets: string[] = [];
    for (const shape of xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
      const body = shape[1] ?? '';
      const paragraphs = drawingParagraphs(body);
      if (paragraphs.length === 0) continue;
      const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(body);
      if (isTitle && !title) title = paragraphs.join(' ');
      else bullets.push(...paragraphs);
    }
    slides.push({ title: title || bullets.shift() || `Slide ${slides.length + 1}`, bullets });
  }
  return slides;
}

async function xlsxSheets(buffer: Buffer): Promise<Array<{ name: string; rows: string[][] }>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook.worksheets.slice(0, PREVIEW_LIMITS.maxSheets).map((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= PREVIEW_LIMITS.maxRows) return;
      const cells: string[] = [];
      for (let c = 1; c <= Math.min(row.cellCount, PREVIEW_LIMITS.maxColumns); c += 1) {
        cells.push(row.getCell(c).text ?? '');
      }
      rows.push(cells);
    });
    return { name: ws.name, rows };
  });
}

/** Teks + data pratinjau untuk berkas Office yang baru disunting, agar konteks AI ikut mutakhir. */
export async function extractOfficeContent(
  format: OfficeFormat,
  buffer: Buffer,
): Promise<{ contentText: string | null; previewJson: Record<string, unknown> | null }> {
  if (format === 'xlsx') {
    return { contentText: null, previewJson: { sheets: await xlsxSheets(buffer) } };
  }
  if (format === 'pptx') {
    const slides = await pptxSlides(buffer);
    const outline = slides
      .map((s) => [`## ${s.title}`, ...s.bullets.map((b) => `- ${b}`)].join('\n'))
      .join('\n\n');
    return { contentText: outline, previewJson: { slides } };
  }
  const ast = await OfficeParser.parseOffice(buffer, {
    fileType: 'docx',
    ocr: false,
    extractAttachments: false,
  });
  const text = (await ast.to('text')).value?.trim() ?? '';
  return { contentText: text || null, previewJson: null };
}
