import ExcelJS from 'exceljs';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import PDFDocument from 'pdfkit';
import PptxGenJS from 'pptxgenjs';
import type { DocumentFormat, DocumentSpec } from './document-spec';
import { inlineRuns, parseMarkdownBlocks, plainText, type MdBlock } from './markdown-blocks';

export interface RenderedDocument {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  /** Teks sumber/pratinjau untuk format berbasis teks dan Markdown sumber docx/pdf. */
  contentText: string | null;
  /** Data terstruktur untuk pratinjau xlsx/pptx. */
  previewJson: Record<string, unknown> | null;
}

export const FORMAT_MIME: Record<DocumentFormat, string> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
};

const TEXT_FORMATS: readonly DocumentFormat[] = ['md', 'txt', 'html', 'json', 'csv'];

function toCell(value: string): string | number {
  const trimmed = value.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) && trimmed.length < 16 ? Number(trimmed) : value;
}

async function renderXlsx(spec: DocumentSpec): Promise<RenderedDocument> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ContributorAI';
  workbook.title = spec.title;
  for (const sheet of spec.sheets ?? []) {
    const ws = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) ws.addRow(row.map(toCell));
    const header = ws.getRow(1);
    header.font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.columns.forEach((column, index) => {
      const widest = sheet.rows.reduce((max, row) => Math.max(max, (row[index] ?? '').length), 8);
      column.width = Math.min(60, widest + 2);
    });
  }
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    mimeType: FORMAT_MIME.xlsx,
    extension: 'xlsx',
    contentText: null,
    previewJson: { sheets: spec.sheets ?? [] },
  };
}

function docxRuns(text: string): TextRun[] {
  return inlineRuns(text).map((run) => new TextRun({ text: run.text, bold: run.bold }));
}

function docxBlock(block: MdBlock): Array<Paragraph | Table> {
  switch (block.type) {
    case 'heading':
      return [
        new Paragraph({
          heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][
            block.level - 1
          ],
          children: docxRuns(block.text),
        }),
      ];
    case 'bullet':
      return [new Paragraph({ bullet: { level: 0 }, children: docxRuns(block.text) })];
    case 'number':
      return [new Paragraph({ children: [new TextRun({ text: `${block.n}. ` }), ...docxRuns(block.text)] })];
    case 'code':
      return block.text
        .split('\n')
        .map((line) => new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New' })] }));
    case 'table':
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map(
            (row, rowIndex) =>
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: inlineRuns(cell).map(
                            (run) => new TextRun({ text: run.text, bold: run.bold || rowIndex === 0 }),
                          ),
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
        new Paragraph({ children: [] }),
      ];
    default:
      return [new Paragraph({ spacing: { after: 120 }, children: docxRuns(block.text) })];
  }
}

async function renderDocx(spec: DocumentSpec): Promise<RenderedDocument> {
  const content = spec.content ?? '';
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: spec.title })],
    }),
    ...parseMarkdownBlocks(content).flatMap(docxBlock),
  ];
  const doc = new Document({
    creator: 'ContributorAI',
    title: spec.title,
    sections: [{ children }],
  });
  return {
    buffer: Buffer.from(await Packer.toBuffer(doc)),
    mimeType: FORMAT_MIME.docx,
    extension: 'docx',
    contentText: content,
    previewJson: null,
  };
}

async function renderPptx(spec: DocumentSpec): Promise<RenderedDocument> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = spec.title;
  pptx.author = 'ContributorAI';

  const cover = pptx.addSlide();
  cover.addText(spec.title, { x: 0.8, y: 2.4, w: 11.7, h: 1.5, fontSize: 36, bold: true, color: '1F2937' });

  for (const slide of spec.slides ?? []) {
    const s = pptx.addSlide();
    s.addText(slide.title, { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: '1F2937' });
    if (slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((text) => ({ text: plainText(text), options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.5, w: 11.7, h: 5, fontSize: 20, color: '374151', valign: 'top' },
      );
    }
    if (slide.notes) s.addNotes(slide.notes);
  }
  const output = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  const outline = (spec.slides ?? [])
    .map((s) => [`## ${s.title}`, ...s.bullets.map((b) => `- ${b}`)].join('\n'))
    .join('\n\n');
  return {
    buffer: Buffer.from(output),
    mimeType: FORMAT_MIME.pptx,
    extension: 'pptx',
    contentText: `# ${spec.title}\n\n${outline}`,
    previewJson: { slides: spec.slides ?? [] },
  };
}

async function renderPdf(spec: DocumentSpec): Promise<RenderedDocument> {
  const content = spec.content ?? '';
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: spec.title, Author: 'ContributorAI' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.font('Helvetica-Bold').fontSize(22).fillColor('#111827').text(spec.title);
  doc.moveDown(0.8);
  const sizes = { 1: 18, 2: 15, 3: 13 } as const;
  for (const block of parseMarkdownBlocks(content)) {
    switch (block.type) {
      case 'heading':
        doc.moveDown(0.4).font('Helvetica-Bold').fontSize(sizes[block.level]).fillColor('#111827');
        doc.text(plainText(block.text));
        doc.moveDown(0.3);
        break;
      case 'bullet':
        doc.font('Helvetica').fontSize(11).fillColor('#1F2937').text(`•  ${plainText(block.text)}`, {
          indent: 8,
        });
        break;
      case 'number':
        doc.font('Helvetica').fontSize(11).fillColor('#1F2937').text(`${block.n}.  ${plainText(block.text)}`, {
          indent: 8,
        });
        break;
      case 'code':
        doc.font('Courier').fontSize(9.5).fillColor('#1F2937').text(block.text);
        doc.moveDown(0.4);
        break;
      case 'table':
        block.rows.forEach((row, index) => {
          doc
            .font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(10)
            .fillColor('#1F2937')
            .text(row.map(plainText).join('   |   '));
        });
        doc.moveDown(0.4);
        break;
      default:
        doc.font('Helvetica').fontSize(11).fillColor('#1F2937').text(plainText(block.text));
        doc.moveDown(0.4);
    }
  }
  doc.end();
  return {
    buffer: await done,
    mimeType: FORMAT_MIME.pdf,
    extension: 'pdf',
    contentText: content,
    previewJson: null,
  };
}

export async function renderDocument(spec: DocumentSpec): Promise<RenderedDocument> {
  if (TEXT_FORMATS.includes(spec.format)) {
    const text = spec.content ?? '';
    return {
      buffer: Buffer.from(text, 'utf8'),
      mimeType: FORMAT_MIME[spec.format],
      extension: spec.format,
      contentText: text,
      previewJson: null,
    };
  }
  switch (spec.format) {
    case 'xlsx':
      return renderXlsx(spec);
    case 'docx':
      return renderDocx(spec);
    case 'pptx':
      return renderPptx(spec);
    default:
      return renderPdf(spec);
  }
}
