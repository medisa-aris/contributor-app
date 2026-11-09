import { createHmac } from 'node:crypto';

const HASH_LENGTH = 12;
const TOKEN_BODY = '[a-z0-9]{4}[0-9a-f]{12}';
const STRICT_TOKEN = /^[A-Z0-9]{4}[0-9a-f]{12}$/;
const HEX_LETTER = /[a-f]/;
const SIMPLE_EMAIL = /^[^@\s]+@[^@\s]+$/;

/** Ekor stream yang ditahan; lebih panjang dari token email (37) agar tanda baca di belakangnya muat. */
const STREAM_HOLD_LENGTH = 80;

/** Geser satu karakter +1. `Z` dan `9` tetap, supaya urutan tidak rusak. */
function shift(char: string): string {
  if (char === 'Z' || char === '9') return char;
  return String.fromCharCode(char.charCodeAt(0) + 1);
}

/** Karakter pertama tetap, lalu 3 karakter pertama digeser +1: Medisa → MNFE. */
export function tokenPrefix(value: string): string {
  const alnum = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  const head = alnum.slice(0, 3).padEnd(3, 'X');
  return `${head[0]}${[...head].map(shift).join('')}`;
}

/** Bentuk token tunggal. Selalu memuat huruf hex, sehingga NIK 16 digit tidak pernah cocok. */
export function isToken(value: string): boolean {
  return STRICT_TOKEN.test(value) && HEX_LETTER.test(value.slice(4));
}

export function isMaskedEmail(value: string): boolean {
  const match = /^(.+)@(.+)\.com$/i.exec(value);
  return match !== null && isToken(normalizeToken(match[1]!)) && isToken(normalizeToken(match[2]!));
}

/** Teks sudah berupa token; dipakai agar masking idempoten. */
export function isMasked(value: string): boolean {
  return isToken(value) || isMaskedEmail(value);
}

function normalizeToken(token: string): string {
  return `${token.slice(0, 4).toUpperCase()}${token.slice(4).toLowerCase()}`;
}

/** Peta dua arah token ↔ nilai asli untuk satu permintaan LLM; hanya hidup di memori. */
export class MaskSession {
  private readonly tokens = new Map<string, string>();
  private readonly values = new Map<string, string>();
  private readonly pattern = new RegExp(
    `(?<![a-z0-9])(${TOKEN_BODY})(?:@(${TOKEN_BODY})\\.com)?(?![a-z0-9])`,
    'gi',
  );
  readonly counts: Record<string, number> = {};
  unresolved = 0;

  constructor(private readonly key: Buffer) {}

  get size(): number {
    return this.tokens.size;
  }

  private tokenFor(value: string): string {
    const known = this.tokens.get(value);
    if (known) return known;
    const prefix = tokenPrefix(value);
    for (let salt = 0; ; salt += 1) {
      const hash = createHmac('sha256', this.key)
        .update(salt === 0 ? value : `${value}\0${salt}`)
        .digest('hex')
        .slice(0, HASH_LENGTH);
      if (!HEX_LETTER.test(hash)) continue;
      const token = `${prefix}${hash}`;
      const owner = this.values.get(token);
      if (owner !== undefined && owner !== value) continue;
      this.tokens.set(value, token);
      this.values.set(token, value);
      return token;
    }
  }

  private emailToken(email: string): string {
    const known = this.tokens.get(email);
    if (known) return known;
    const at = email.lastIndexOf('@');
    const token = `${this.tokenFor(email.slice(0, at))}@${this.tokenFor(email.slice(at + 1))}.com`;
    this.tokens.set(email, token);
    this.values.set(token, email);
    return token;
  }

  /** Token untuk `value`; nilai yang sudah berupa token dikembalikan apa adanya. */
  mask(value: string, category: string): string {
    if (isMasked(value)) return value;
    this.counts[category] = (this.counts[category] ?? 0) + 1;
    return SIMPLE_EMAIL.test(value) ? this.emailToken(value) : this.tokenFor(value);
  }

  private restore(raw: string): string | undefined {
    return this.values.get(normalizeToken(raw));
  }

  unmask(text: string): string {
    if (this.values.size === 0) return text;
    return text.replace(this.pattern, (match: string, first: string, second?: string) => {
      if (second) {
        const whole = this.values.get(`${normalizeToken(first)}@${normalizeToken(second)}.com`);
        if (whole !== undefined) return whole;
        const local = this.restore(first);
        const domain = this.restore(second);
        if (local === undefined && domain === undefined) {
          this.unresolved += 1;
          return match;
        }
        return `${local ?? first}@${domain ?? second}.com`;
      }
      const value = this.restore(first);
      if (value !== undefined) return value;
      if (isToken(normalizeToken(first))) this.unresolved += 1;
      return match;
    });
  }

  unmaskDeep<T>(value: T): T {
    if (typeof value === 'string') return this.unmask(value) as T;
    if (Array.isArray(value)) return value.map((entry) => this.unmaskDeep(entry) as unknown) as T;
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, this.unmaskDeep(entry as unknown)]),
      ) as T;
    }
    return value;
  }
}

/** Unmask untuk stream: token bisa terbelah antar-delta, jadi ekor yang mungkin token ditahan. */
export class StreamUnmasker {
  private buffer = '';

  constructor(private readonly session: MaskSession) {}

  push(delta: string): string {
    this.buffer += delta;
    const tail = /[A-Za-z0-9@.]*$/.exec(this.buffer)?.[0].length ?? 0;
    const cut = this.buffer.length - Math.min(tail, STREAM_HOLD_LENGTH);
    const ready = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);
    return ready ? this.session.unmask(ready) : '';
  }

  flush(): string {
    const rest = this.buffer;
    this.buffer = '';
    return rest ? this.session.unmask(rest) : '';
  }
}
