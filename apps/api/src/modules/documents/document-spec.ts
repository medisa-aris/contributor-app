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
}

export interface DocumentSpec {
  format: DocumentFormat;
  title: string;
  /** Isi untuk md/txt/html/json/csv; untuk docx/pdf berupa Markdown. */
  content?: string;
  sheets?: SheetSpec[];
  slides?: SlideSpec[];
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
    '(judul #, daftar -, tabel |, **tebal**). Untuk xlsx isi `sheets`. Untuk pptx isi `slides`.',
  inputSchema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: [...DOCUMENT_FORMATS] },
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
      const slide = (raw ?? {}) as { title?: unknown; bullets?: unknown; notes?: unknown };
      const bullets = (Array.isArray(slide.bullets) ? slide.bullets : [])
        .slice(0, DOCUMENT_LIMITS.maxBullets)
        .map(asString)
        .filter((b) => b.trim().length > 0);
      const notes = asString(slide.notes).trim();
      return { title: asString(slide.title).trim() || 'Slide', bullets, ...(notes ? { notes } : {}) };
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
