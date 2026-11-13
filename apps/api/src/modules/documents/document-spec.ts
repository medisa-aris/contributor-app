import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import type { ChatTool } from '../ai/providers/types';

export const DOCUMENT_FORMATS = [
  'md',
  'txt',
  'html',
  'json',
  'csv',
  'xlsx',
  'docx',
  'pptx',
  'pdf',
] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export const DOCUMENT_LIMITS = {
  maxTitleLength: 200,
  maxContentLength: 200_000,
  maxSheets: 10,
  maxRows: 2000,
  maxColumns: 50,
  maxSlides: 60,
  maxBullets: 20,
} as const;

export const CREATE_DOCUMENT_TOOL_NAME = 'create_document';

export interface SheetSpec {
  name: string;
  rows: string[][];
}

export interface SlideSpec {
  title: string;
  bullets: string[];
  notes?: string;
  /** Nama slide layout templat (mis. "Title and Content", "Two Content"). */
  layout?: string;
  /** Nomor slide templat (1-based) yang disalin beserta desain, shape, dan SmartArt-nya. */
  templateSlide?: number;
  /** Teks baru untuk node SmartArt pada slide templat yang disalin, berurutan. */
  diagramItems?: string[];
}

export interface DocumentSpec {
  format: DocumentFormat;
  title: string;
  /** Isi untuk md/txt/html/json/csv; untuk docx/pdf berupa Markdown. */
  content?: string;
  sheets?: SheetSpec[];
  slides?: SlideSpec[];
  /** Templat gaya (id document_templates atau id lampiran Office) untuk docx/pptx/xlsx. */
  templateId?: string;
}

/** Definisi tool yang ditawarkan ke model pada percakapan Multi Brain / Partner. */
export const CREATE_DOCUMENT_TOOL: ChatTool = {
  name: CREATE_DOCUMENT_TOOL_NAME,
  description:
    'Membuat berkas dokumen untuk pengguna dan menyimpannya di "Dokumen Saya". ' +
    'Gunakan HANYA bila pengguna meminta keluaran berupa berkas/dokumen (mis. laporan, spreadsheet, ' +
    'presentasi, halaman HTML, JSON). Jangan dipakai untuk jawaban percakapan biasa. ' +
    'Pilih format: md, txt, html, json, csv, xlsx, docx, pptx, atau pdf. ' +
    'Untuk md/txt/html/json/csv isi `content` apa adanya. Untuk docx dan pdf isi `content` dengan Markdown ' +
    '(judul #, daftar -, tabel |, **tebal**). Untuk xlsx isi `sheets`. Untuk pptx isi `slides`. ' +
    'Bila pengguna ingin memakai gaya/tema/master/header-footer dari berkas Office yang dilampirkan atau dari ' +
    'templat tersimpan, isi `template_id` dengan id yang tercantum di konteks (format harus sama).',
  inputSchema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: [...DOCUMENT_FORMATS] },
      template_id: {
        type: 'string',
        description:
          'Opsional, hanya docx/pptx/xlsx: id templat gaya atau id lampiran Office. Dokumen baru memakai tema, ' +
          'style, slide master/layout, header/footer, dan media dari berkas tersebut.',
      },
      title: { type: 'string', description: 'Judul dokumen (maks. 200 karakter).' },
      content: {
        type: 'string',
        description: 'Isi dokumen untuk md, txt, html, json, csv, docx, dan pdf.',
      },
      sheets: {
        type: 'array',
        description: 'Untuk xlsx: daftar sheet. Baris pertama biasanya header.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          },
          required: ['name', 'rows'],
        },
      },
      slides: {
        type: 'array',
        description: 'Untuk pptx: daftar slide.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
            layout: {
              type: 'string',
              description: 'Opsional (dengan template_id): nama slide layout templat yang dipakai.',
            },
            template_slide: {
              type: 'integer',
              description:
                'Opsional (dengan template_id): nomor slide templat (mulai 1) yang disalin utuh — desain, shape, ' +
                'SmartArt — lalu judul/poinnya diganti.',
            },
            diagram_items: {
              type: 'array',
              items: { type: 'string' },
              description: 'Opsional (dengan template_slide berisi SmartArt): teks baru node SmartArt, berurutan.',
            },
          },
          required: ['title'],
        },
      },
    },
    required: ['format', 'title'],
  },
};

function invalid(message: string): AppError {
  return new AppError(ERROR_CODES.validation, message, 400);
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Validasi + normalisasi input tool dari model (tidak dipercaya). */
export function parseDocumentSpec(input: Record<string, unknown>): DocumentSpec {
  const format = asString(input.format).toLowerCase() as DocumentFormat;
  if (!DOCUMENT_FORMATS.includes(format)) {
    throw invalid(`Format dokumen tidak didukung: ${asString(input.format) || '(kosong)'}.`);
  }
  const title = asString(input.title).replace(/\s+/g, ' ').trim().slice(0, DOCUMENT_LIMITS.maxTitleLength);
  if (!title) throw invalid('Judul dokumen wajib diisi.');

  const spec: DocumentSpec = { format, title };
  const templateId = asString(input.template_id).trim();
  if (templateId) {
    if (!['docx', 'pptx', 'xlsx'].includes(format)) {
      throw invalid('template_id hanya berlaku untuk docx, pptx, dan xlsx.');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) {
      throw invalid('template_id tidak valid.');
    }
    spec.templateId = templateId.toLowerCase();
  }

  if (format === 'xlsx') {
    const rawSheets = Array.isArray(input.sheets) ? input.sheets : [];
    const sheets: SheetSpec[] = rawSheets.slice(0, DOCUMENT_LIMITS.maxSheets).map((raw, index) => {
      const sheet = (raw ?? {}) as { name?: unknown; rows?: unknown };
      const rows = (Array.isArray(sheet.rows) ? sheet.rows : [])
        .slice(0, DOCUMENT_LIMITS.maxRows)
        .map((row) =>
          (Array.isArray(row) ? row : [row]).slice(0, DOCUMENT_LIMITS.maxColumns).map(asString),
        );
      return { name: sanitizeSheetName(asString(sheet.name), index), rows };
    });
    if (sheets.length === 0 || sheets.every((s) => s.rows.length === 0)) {
      throw invalid('Dokumen xlsx membutuhkan setidaknya satu sheet berisi baris.');
    }
    spec.sheets = sheets;
    return spec;
  }

  if (format === 'pptx') {
    const rawSlides = Array.isArray(input.slides) ? input.slides : [];
    const slides: SlideSpec[] = rawSlides.slice(0, DOCUMENT_LIMITS.maxSlides).map((raw) => {
      const slide = (raw ?? {}) as {
        title?: unknown;
        bullets?: unknown;
        notes?: unknown;
        layout?: unknown;
        template_slide?: unknown;
        diagram_items?: unknown;
      };
      const bullets = (Array.isArray(slide.bullets) ? slide.bullets : [])
        .slice(0, DOCUMENT_LIMITS.maxBullets)
        .map(asString)
        .filter((b) => b.trim().length > 0);
      const notes = asString(slide.notes).trim();
      const layout = asString(slide.layout).trim().slice(0, 120);
      const templateSlide = Number(slide.template_slide);
      const diagramItems = (Array.isArray(slide.diagram_items) ? slide.diagram_items : [])
        .slice(0, DOCUMENT_LIMITS.maxBullets * 2)
        .map(asString)
        .map((d) => d.trim());
      return {
        title: asString(slide.title).trim() || 'Slide',
        bullets,
        ...(notes ? { notes } : {}),
        ...(spec.templateId && layout ? { layout } : {}),
        ...(spec.templateId && Number.isInteger(templateSlide) && templateSlide > 0 && templateSlide <= 500
          ? { templateSlide }
          : {}),
        ...(spec.templateId && diagramItems.length ? { diagramItems } : {}),
      };
    });
    if (slides.length === 0) throw invalid('Dokumen pptx membutuhkan setidaknya satu slide.');
    spec.slides = slides;
    return spec;
  }

  const content = asString(input.content);
  if (!content.trim()) throw invalid('Isi dokumen tidak boleh kosong.');
  if (content.length > DOCUMENT_LIMITS.maxContentLength) {
    throw invalid(`Isi dokumen melebihi batas ${DOCUMENT_LIMITS.maxContentLength} karakter.`);
  }
  if (format === 'json') {
    try {
      spec.content = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      throw invalid('Isi JSON tidak valid.');
    }
    return spec;
  }
  spec.content = content;
  return spec;
}

/** Nama sheet Excel: maks. 31 karakter, tanpa : \ / ? * [ ]. */
export function sanitizeSheetName(raw: string, index: number): string {
  const cleaned = raw.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}
