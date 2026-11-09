import { GUARDRAIL_CATEGORIES } from '@bara/shared';
import { isMasked, type MaskSession } from './masker';

/** Kata yang menandakan kolom "nama" bukan milik orang, mis. nama_produk. */
const NON_PERSON_WORDS = new Set(
  'produk barang item perusahaan company file berkas dokumen document departemen department divisi unit kota provinsi negara jabatan proyek project bank toko kategori category tabel table kolom column server domain host aplikasi app model sistem system skill tool grup group tim team role peran modul module menu acara event kegiatan kelas sekolah'.split(
    ' ',
  ),
);

/** Sinonim pendek/umum yang hanya berlaku bila menjadi seluruh nama kolom. */
const EXACT_ONLY = new Set(
  'hp wa kk sim wn jk pin iris anak mail zip jalan karyawan pegawai nasabah pelanggan konsumen customer employee mobile age balance'.split(
    ' ',
  ),
);

const COLUMN_INDEX = new Map<string, string>();
for (const category of GUARDRAIL_CATEGORIES) {
  for (const column of category.columns) COLUMN_INDEX.set(column, category.id);
}

const EMPTY_VALUES = new Set(['', '-', '—', 'null', 'none', 'n/a', 'na', 'undefined', 'nil']);
const MAX_LABEL_LENGTH = 60;
const MAX_KV_LINE_LENGTH = 5000;
const MIN_NAME_PART_LENGTH = 4;

/** Kategori yang nilainya dicari di seluruh teks, karena tidak punya pola tetap. */
const PROPAGATED = new Set(['full_name', 'mother_name', 'custom']);

const NOT_A_NAME = new Set(
  'Kota Negara Presiden Menteri Direktur Manajer Manager Gubernur Bupati Walikota Lurah Camat Kepala Guru Dosen Dokter Tuhan Pertiwi'.split(
    ' ',
  ),
);

const NAME_TRIGGER =
  /(?<!\p{L})(?:[Nn]ama (?:saya|lengkap|beliau)(?: adalah)?|[Bb]ernama|[Aa]tas nama|[Ss]aya adalah|Bapak|Pak|Ibu|Bu|Sdr[ai]?\.?|Saudara|Saudari|Tn\.?|Ny\.?|Nn\.?|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Drs\.?|Dra\.?|Prof\.?|Ir\.?)\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,3})(?![\p{L}\p{N}])/gu;

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const SIXTEEN_DIGITS = /(?<![A-Za-z0-9])\d{16}(?![A-Za-z0-9])/g;
const CARD = /(?<![A-Za-z0-9])\d(?:[ -]?\d){12,18}(?![A-Za-z0-9])/g;
const NPWP = /(?<![A-Za-z0-9])\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}(?![A-Za-z0-9])/g;
const ACCOUNT =
  /((?:[Nn]o\.?\s*[Rr]ek(?:ening)?|[Nn]omor\s+[Rr]ekening|[Rr]ekening|[Aa]ccount(?:\s+[Nn](?:umber|o\.?))?|[Vv]irtual\s+[Aa]ccount)[\s:.#-]*)(\d[\d -]{6,20}\d)/g;
const MOBILE = /(?<![A-Za-z0-9+])(?:\+62|62|0)[ -]?8\d{1,2}(?:[ -]?\d){6,9}(?![A-Za-z0-9])/g;
const LANDLINE =
  /(?<![A-Za-z0-9+])(?:\+62[ -]?|\(?0)[2-7]\d{1,2}\)?[ -]\d{3,4}[ -]?\d{2,5}(?![A-Za-z0-9])/g;
const JSON_PAIR = /"([^"\\\n]{1,60})"\s*:\s*(?:"((?:[^"\\\n]|\\.)*)(?:"|$)|(-?\d[\d.]*))/gm;
const KEY_VALUE =
  /^([\s>*•_#-]*(?:\d+[.)]\s*)?)([\p{L}][\p{L}\p{N} _./-]{0,40}?)([\s*_]*[:=][\s*_]*)(\S.*?)([\s*_]*)$/u;
const CELL = /^(\s*["']?[*_]*\s*)(.*?)(\s*[*_]*["']?\s*)$/s;
const WORD = /[\p{L}\p{N}]+/gu;
const WORD_GAP = /^[\s.,'’-]{1,3}$/;

function normalizeLabel(label: string): string {
  return label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const labelCache = new Map<string, string | null>();

/** Kategori sebuah nama kolom/kunci; null bila bukan data pribadi. */
export function categoryForLabel(label: string): string | null {
  if (label.length > MAX_LABEL_LENGTH) return null;
  const cached = labelCache.get(label);
  if (cached !== undefined) return cached;
  const normalized = normalizeLabel(label);
  let found = COLUMN_INDEX.get(normalized) ?? null;
  const words = normalized.split('_');
  if (!found && words.length <= 5 && !words.some((w) => NON_PERSON_WORDS.has(w))) {
    search: for (let size = Math.min(3, words.length); size >= 1; size -= 1) {
      for (let start = 0; start + size <= words.length; start += 1) {
        const candidate = words.slice(start, start + size).join('_');
        if (EXACT_ONLY.has(candidate)) continue;
        const category = COLUMN_INDEX.get(candidate);
        if (category) {
          found = category;
          break search;
        }
      }
    }
  }
  if (labelCache.size < 10_000) labelCache.set(label, found);
  return found;
}

function isValidNik(digits: string): boolean {
  const province = Number(digits.slice(0, 2));
  const day = Number(digits.slice(6, 8));
  const month = Number(digits.slice(8, 10));
  return (
    province >= 11 &&
    province <= 94 &&
    month >= 1 &&
    month <= 12 &&
    ((day >= 1 && day <= 31) || (day >= 41 && day <= 71))
  );
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function splitCells(line: string, delimiter: string): string[] {
  if (delimiter === '|' || !line.includes('"')) return line.split(delimiter);
  const cells: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === delimiter && !quoted) {
      cells.push(line.slice(start, i));
      start = i + 1;
    }
  }
  cells.push(line.slice(start));
  return cells;
}

function delimiterOf(line: string): string | null {
  for (const delimiter of ['|', '\t', ';', ',']) {
    if (line.includes(delimiter)) return delimiter;
  }
  return null;
}

interface TrieNode {
  next: Map<string, TrieNode>;
  category?: string;
  /** Potongan nama (satu kata) hanya cocok bila berawalan huruf besar. */
  capitalizedOnly?: boolean;
}

export interface KnownTerm {
  value: string;
  category: string;
}

/** Temukan dan ganti data pribadi. `structured` dijalankan untuk semua teks sebelum `apply`. */
export class Detector {
  private readonly root: TrieNode = { next: new Map() };
  private readonly known = new Set<string>();
  /** Nilai tanpa pola yang baru ditemukan; disimpan ke kamus percakapan. */
  readonly discovered = new Map<string, string>();

  constructor(
    private readonly session: MaskSession,
    private readonly categories: ReadonlySet<string>,
    terms: readonly KnownTerm[],
  ) {
    for (const term of terms) {
      this.addTerm(term.value, term.category);
      this.known.add(term.value);
    }
  }

  private insert(words: readonly string[], category: string, capitalizedOnly: boolean): void {
    let node = this.root;
    for (const word of words) {
      const key = word.toLowerCase();
      let child = node.next.get(key);
      if (!child) {
        child = { next: new Map() };
        node.next.set(key, child);
      }
      node = child;
    }
    if (node.category && !node.capitalizedOnly) return;
    node.category = category;
    node.capitalizedOnly = capitalizedOnly;
  }

  private addTerm(value: string, category: string): void {
    const words = value.match(WORD);
    if (!words) return;
    this.insert(words, category, false);
    if (category !== 'custom' && words.length > 1) {
      for (const word of words) {
        if (word.length >= MIN_NAME_PART_LENGTH) this.insert([word], category, true);
      }
    }
  }

  private remember(value: string, category: string): void {
    if (!PROPAGATED.has(category) || !this.categories.has(category) || isMasked(value)) return;
    this.addTerm(value, category);
    if (!this.known.has(value)) {
      this.known.add(value);
      this.discovered.set(value, category);
    }
  }

  private maskValue(raw: string, category: string): string {
    const value = raw.trim();
    if (EMPTY_VALUES.has(value.toLowerCase()) || isMasked(value)) return raw;
    this.remember(value, category);
    return raw.replace(value, () => this.session.mask(value, category));
  }

  private isActive(label: string): string | null {
    const category = categoryForLabel(label);
    return category && this.categories.has(category) ? category : null;
  }

  /** Nilai argumen tool yang kuncinya menandakan data pribadi. */
  maskByKey(key: string, value: string): string | null {
    const category = this.isActive(key);
    return category ? this.maskValue(value, category) : null;
  }

  private maskJson(text: string): string {
    if (!text.includes('"')) return text;
    return text.replace(JSON_PAIR, (match: string, key: string, str?: string, num?: string) => {
      const category = this.isActive(key);
      const value = str ?? num;
      if (!category || !value) return match;
      const masked = this.maskValue(value, category);
      if (masked === value) return match;
      const start = match.lastIndexOf(value);
      const prefix = match.slice(0, start);
      const suffix = match.slice(start + value.length);
      return num !== undefined ? `${prefix}"${masked}"${suffix}` : `${prefix}${masked}${suffix}`;
    });
  }

  private maskCell(cell: string, category: string): string {
    const parts = CELL.exec(cell);
    if (!parts) return cell;
    const masked = this.maskValue(parts[2]!, category);
    return `${parts[1]}${masked}${parts[3]}`;
  }

  private tableHeader(line: string): { delimiter: string; columns: (string | null)[] } | null {
    const delimiter = delimiterOf(line);
    if (!delimiter) return null;
    const cells = splitCells(line, delimiter).map((cell) => cell.replace(/["'*_]/g, ' ').trim());
    const named = cells.filter(Boolean);
    if (named.length < 2 || named.some((c) => c.length > MAX_LABEL_LENGTH || /[:=]/.test(c))) return null;
    const columns = cells.map((cell) => (cell ? this.isActive(cell) : null));
    return columns.some(Boolean) ? { delimiter, columns } : null;
  }

  private maskKeyValue(line: string): string {
    if (line.length > MAX_KV_LINE_LENGTH) return line;
    const match = KEY_VALUE.exec(line);
    if (!match) return line;
    const [, lead, label, separator, value, trail] = match;
    const category = this.isActive(label!);
    if (!category) return line;
    if (category === 'address') {
      return `${lead}${label}${separator}${this.maskValue(value!, category)}${trail}`;
    }
    const cut = value!.search(/\s*[,;|]\s/);
    if (cut < 0) return `${lead}${label}${separator}${this.maskValue(value!, category)}${trail}`;
    const rest = value!.slice(cut).replace(/^\s*[,;|]\s*/, '');
    const delimiter = value!.slice(cut, value!.length - rest.length);
    return `${lead}${label}${separator}${this.maskValue(value!.slice(0, cut), category)}${delimiter}${this.maskKeyValue(`${rest}${trail}`)}`;
  }

  /** Lintasan pertama: kolom, JSON, `kunci: nilai`, dan pengumpulan nama dari kata pemicu. */
  structured(text: string): string {
    if (!text) return text;
    const lines = this.maskJson(text).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const header = this.tableHeader(lines[i]!);
      const size = header ? splitCells(lines[i]!, header.delimiter).length : 0;
      const isRow = (line: string | undefined): boolean =>
        line !== undefined && line.trim() !== '' && splitCells(line, header!.delimiter).length === size;
      if (header && isRow(lines[i + 1])) {
        let row = i + 1;
        for (; isRow(lines[row]); row += 1) {
          const line = lines[row]!;
          if (/^[\s|:+-]+$/.test(line)) continue;
          lines[row] = splitCells(line, header.delimiter)
            .map((cell, index) => {
              const category = header.columns[index];
              return category ? this.maskCell(cell, category) : cell;
            })
            .join(header.delimiter);
        }
        i = row - 1;
        continue;
      }
      lines[i] = this.maskKeyValue(lines[i]!);
    }
    const result = lines.join('\n');
    if (this.categories.has('full_name')) {
      for (const match of result.matchAll(NAME_TRIGGER)) {
        const name = match[1]!;
        if (!NOT_A_NAME.has(name.split(/\s+/)[0]!)) this.remember(name, 'full_name');
      }
    }
    return result;
  }

  private applyDictionary(text: string): string {
    if (this.root.next.size === 0) return text;
    const words = [...text.matchAll(WORD)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      key: m[0].toLowerCase(),
    }));
    let output = '';
    let cursor = 0;
    for (let i = 0; i < words.length; i += 1) {
      let node: TrieNode | undefined = this.root;
      let matchedEnd = -1;
      let matchedCategory = '';
      for (let j = i; j < words.length; j += 1) {
        if (j > i && !WORD_GAP.test(text.slice(words[j - 1]!.end, words[j]!.start))) break;
        node = node.next.get(words[j]!.key);
        if (!node) break;
        if (node.category) {
          const first = text[words[i]!.start]!;
          if (!node.capitalizedOnly || first !== first.toLowerCase()) {
            matchedEnd = j;
            matchedCategory = node.category;
          }
        }
      }
      if (matchedEnd < 0) continue;
      const start = words[i]!.start;
      const end = words[matchedEnd]!.end;
      output += text.slice(cursor, start) + this.session.mask(text.slice(start, end), matchedCategory);
      cursor = end;
      i = matchedEnd;
    }
    return cursor === 0 ? text : output + text.slice(cursor);
  }

  private replacePattern(text: string, category: string, pattern: RegExp, valid?: (m: string) => boolean): string {
    if (!this.categories.has(category)) return text;
    return text.replace(pattern, (match) =>
      isMasked(match) || (valid && !valid(match)) ? match : this.session.mask(match, category),
    );
  }

  /** Lintasan kedua: kamus lalu pola tetap. */
  apply(text: string): string {
    if (!text) return text;
    let result = this.applyDictionary(text);
    result = this.replacePattern(result, 'email', EMAIL);
    result = this.replacePattern(result, 'nik', SIXTEEN_DIGITS, isValidNik);
    result = this.replacePattern(result, 'financial', NPWP);
    result = this.replacePattern(result, 'financial', CARD, (m) => passesLuhn(m.replace(/\D/g, '')));
    if (this.categories.has('financial')) {
      result = result.replace(
        ACCOUNT,
        (_m, label: string, digits: string) => `${label}${this.session.mask(digits, 'financial')}`,
      );
    }
    result = this.replacePattern(result, 'phone', MOBILE);
    result = this.replacePattern(result, 'phone', LANDLINE);
    return result;
  }
}
