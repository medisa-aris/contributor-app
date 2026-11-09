/**
 * Parser Markdown minimal untuk renderer docx/pdf: judul, daftar, tabel, kode, dan paragraf.
 * Sengaja kecil — cukup untuk dokumen yang ditulis model, bukan CommonMark penuh.
 */
export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'number'; text: string; n: number }
  | { type: 'table'; rows: string[][] }
  | { type: 'code'; text: string }
  | { type: 'paragraph'; text: string };

export interface InlineRun {
  text: string;
  bold?: boolean;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

const isTableSeparator = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdownBlocks(markdown: string): MdBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(heading[1]!.length, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, text: heading[2]!.trim() });
      continue;
    }
    if (line.includes('|') && isTableSeparator(lines[i + 1] ?? '')) {
      flush();
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(splitRow(lines[i] ?? ''));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'table', rows });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ type: 'bullet', text: bullet[1]!.trim() });
      continue;
    }
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      blocks.push({ type: 'number', n: Number(numbered[1]), text: numbered[2]!.trim() });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Pecah teks inline menjadi potongan biasa/tebal; penanda ` dan * dibuang. */
export function inlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) runs.push({ text: stripMarks(text.slice(last, match.index)) });
    runs.push({ text: stripMarks(match[1]!), bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: stripMarks(text.slice(last)) });
  return runs.filter((run) => run.text.length > 0);
}

export function stripMarks(text: string): string {
  return text.replace(/`([^`]*)`/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function plainText(text: string): string {
  return inlineRuns(text)
    .map((run) => run.text)
    .join('');
}
