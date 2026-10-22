import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { brotliDecompress, gunzip, inflate } from 'node:zlib';
import { Injectable } from '@nestjs/common';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';

export const WEB_SOURCE_LIMITS = {
  timeoutMs: 20_000,
  maxBytes: 2 * 1024 * 1024,
  maxDecompressedBytes: 5 * 1024 * 1024,
  maxRedirects: 4,
  maxTextChars: 40_000,
  maxSummaryInputChars: 16_000,
} as const;

const ACCEPTED_MIME = new Set(['text/html', 'application/xhtml+xml', 'text/plain']);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const BLOCKED_RANGES: [string, number, 'ipv4' | 'ipv6'][] = [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['255.255.255.255', 32, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
];

const blockedAddresses = new BlockList();
for (const [address, prefix, family] of BLOCKED_RANGES) {
  blockedAddresses.addSubnet(address, prefix, family);
}

interface PinnedAddress {
  address: string;
  family: number;
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface WebSourceResult {
  finalUrl: string;
  title: string;
  text: string;
  contentType: string;
  bytes: number;
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/** Node memetakan IPv4 ke rentang ::ffff:0:0/96; normalisasi agar aturan IPv4 tetap berlaku. */
function mappedIpv4(address: string): string | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (dotted) return dotted[1]!;
  const hexadecimal = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hexadecimal) return null;
  const high = Number.parseInt(hexadecimal[1]!, 16);
  const low = Number.parseInt(hexadecimal[2]!, 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, 'ipv4');
  if (family === 6) {
    const ipv4 = mappedIpv4(address);
    if (ipv4) return !blockedAddresses.check(ipv4, 'ipv4');
    return !blockedAddresses.check(address, 'ipv6');
  }
  return false;
}

export function normalizeWebUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AppError(ERROR_CODES.validation, 'URL sumber tidak boleh kosong.', 400);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError(
      ERROR_CODES.validation,
      'URL tidak valid. Sertakan alamat lengkap, misalnya https://contoh.com/artikel.',
      400,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError(ERROR_CODES.validation, 'Hanya URL http atau https yang didukung.', 400);
  }
  if (url.username || url.password) {
    throw new AppError(
      ERROR_CODES.validation,
      'URL yang menyertakan kredensial tidak diizinkan.',
      400,
    );
  }
  if (!url.hostname) {
    throw new AppError(ERROR_CODES.validation, 'URL tidak memiliki nama host.', 400);
  }
  url.hash = '';
  return url;
}

function internalAddressError(): AppError {
  return new AppError(
    ERROR_CODES.validation,
    'URL menunjuk ke jaringan internal atau privat sehingga tidak diizinkan.',
    400,
  );
}

async function resolvePublicAddresses(url: URL): Promise<PinnedAddress[]> {
  const hostname = stripBrackets(url.hostname);
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isPublicAddress(hostname)) throw internalAddressError();
    return [{ address: hostname, family: literalFamily }];
  }

  let resolved: { address: string; family: number }[];
  try {
    resolved = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError(
      ERROR_CODES.validation,
      'Nama domain sumber web tidak dapat ditemukan.',
      400,
    );
  }
  if (resolved.length === 0) {
    throw new AppError(ERROR_CODES.validation, 'Nama domain sumber web tidak dapat ditemukan.', 400);
  }
  if (resolved.some((entry) => !isPublicAddress(entry.address))) {
    throw internalAddressError();
  }
  return resolved.map((entry) => ({ address: entry.address, family: entry.family }));
}

/** Validasi URL sekaligus resolusi DNS; dipakai juga oleh tes integrasi. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = normalizeWebUrl(raw);
  await resolvePublicAddresses(url);
  return url;
}

function pinnedLookup(addresses: PinnedAddress[]) {
  return (
    _hostname: string,
    options: { all?: boolean },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | PinnedAddress[],
      family?: number,
    ) => void,
  ): void => {
    if (options?.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  };
}

function mapRequestError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const name = (error as { name?: string }).name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new AppError(
      ERROR_CODES.validation,
      `Sumber web tidak merespons dalam ${WEB_SOURCE_LIMITS.timeoutMs / 1000} detik.`,
      400,
    );
  }
  return new AppError(
    ERROR_CODES.validation,
    'Sumber web tidak dapat diakses. Periksa kembali tautan lalu coba lagi.',
    400,
  );
}

function requestOnce(target: URL, addresses: PinnedAddress[]): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const hostname = stripBrackets(target.hostname);
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };

    const options: RequestOptions = {
      method: 'GET',
      hostname,
      port: target.port ? Number(target.port) : undefined,
      path: `${target.pathname}${target.search}`,
      headers: {
        'User-Agent': 'BeLead-SourceFetcher/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'Accept-Language': 'id,en;q=0.8',
        'Accept-Encoding': 'identity',
      },
      lookup: pinnedLookup(addresses) as RequestOptions['lookup'],
      signal: AbortSignal.timeout(WEB_SOURCE_LIMITS.timeoutMs),
    };
    if (!isIP(hostname)) options.servername = hostname;

    const onResponse = (response: import('node:http').IncomingMessage): void => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        settle(() => resolve({ status, headers: response.headers, body: Buffer.alloc(0) }));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > WEB_SOURCE_LIMITS.maxBytes) {
          response.destroy();
          settle(() =>
            reject(
              new AppError(
                ERROR_CODES.validation,
                `Ukuran halaman melebihi batas ${WEB_SOURCE_LIMITS.maxBytes / (1024 * 1024)} MB.`,
                400,
              ),
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        settle(() => resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }));
      });
      response.on('error', (error) => settle(() => reject(mapRequestError(error))));
    };

    const request =
      target.protocol === 'https:'
        ? httpsRequest(options, onResponse)
        : httpRequest(options, onResponse);
    request.on('error', (error) => settle(() => reject(mapRequestError(error))));
    request.end();
  });
}

function decompressBody(body: Buffer, encoding: string | undefined): Promise<Buffer> {
  if (!encoding || encoding === 'identity') return Promise.resolve(body);
  const kind = encoding.toLowerCase().split(',')[0]?.trim();
  if (kind !== 'gzip' && kind !== 'x-gzip' && kind !== 'deflate' && kind !== 'br') {
    return Promise.reject(
      new AppError(ERROR_CODES.validation, 'Kompresi konten sumber web tidak didukung.', 400),
    );
  }
  return new Promise((resolve, reject) => {
    const options = { maxOutputLength: WEB_SOURCE_LIMITS.maxDecompressedBytes };
    const callback = (error: Error | null, result: Buffer): void => {
      if (error) {
        reject(
          new AppError(ERROR_CODES.validation, 'Konten sumber web tidak dapat dibaca.', 400),
        );
        return;
      }
      resolve(result);
    };
    if (kind === 'gzip' || kind === 'x-gzip') gunzip(body, options, callback);
    else if (kind === 'deflate') inflate(body, options, callback);
    else brotliDecompress(body, options, callback);
  });
}

function decodeBodyText(body: Buffer, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return body.toString('utf8');
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bullet: '•',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup2: '²',
  sup3: '³',
  micro: 'µ',
  euro: '€',
  pound: '£',
  yen: '¥',
  sect: '§',
  para: '¶',
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const hexadecimal = entity[1]?.toLowerCase() === 'x';
      const digits = hexadecimal ? entity.slice(2) : entity.slice(1);
      const code = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (let match = pattern.exec(tag); match; match = pattern.exec(tag)) {
    attributes[match[1]!.toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? '';
  }
  return attributes;
}

function metaContent(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const name = (attributes.property ?? attributes.name ?? '').toLowerCase();
    if (name === key && attributes.content) return attributes.content;
  }
  return null;
}

function extractTitle(html: string): string {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  for (const candidate of [metaContent(html, 'og:title'), titleTag, heading]) {
    if (!candidate) continue;
    const text = normalizeText(
      decodeHtmlEntities(candidate.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')),
    );
    if (text) return text.slice(0, 200);
  }
  return '';
}

export function extractReadableText(html: string): { title: string; text: string } {
  const title = extractTitle(html);
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|template|svg|iframe|object|embed|canvas)\b[^>]*>[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const withBreaks = withoutNoise
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|table|ul|ol|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return {
    title,
    text: normalizeText(decodeHtmlEntities(withBreaks)).slice(0, WEB_SOURCE_LIMITS.maxTextChars),
  };
}

@Injectable()
export class WebSourceService {
  async fetch(rawUrl: string): Promise<WebSourceResult> {
    let current = normalizeWebUrl(rawUrl);
    for (let hop = 0; hop <= WEB_SOURCE_LIMITS.maxRedirects; hop += 1) {
      const addresses = await resolvePublicAddresses(current);
      const response = await requestOnce(current, addresses);

      if (REDIRECT_STATUS.has(response.status)) {
        const location = response.headers.location;
        if (!location) {
          throw new AppError(
            ERROR_CODES.validation,
            'Sumber web mengalihkan ke alamat tanpa tujuan yang jelas.',
            400,
          );
        }
        if (hop === WEB_SOURCE_LIMITS.maxRedirects) {
          throw new AppError(
            ERROR_CODES.validation,
            `Sumber web mengalihkan lebih dari ${WEB_SOURCE_LIMITS.maxRedirects} kali.`,
            400,
          );
        }
        current = normalizeWebUrl(new URL(location, current).toString());
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new AppError(
          ERROR_CODES.validation,
          `Sumber web menolak permintaan (HTTP ${response.status}).`,
          400,
        );
      }

      const contentTypeHeader = String(response.headers['content-type'] ?? '');
      const mimeType = contentTypeHeader.split(';')[0]?.trim().toLowerCase() || 'text/html';
      if (!ACCEPTED_MIME.has(mimeType)) {
        throw new AppError(
          ERROR_CODES.validation,
          'Format sumber web tidak didukung. Hanya halaman HTML atau teks biasa yang dapat ditambahkan.',
          400,
        );
      }

      const body = await decompressBody(response.body, response.headers['content-encoding']);
      const decoded = decodeBodyText(body, contentTypeHeader);
      const isHtml = mimeType !== 'text/plain';
      const extracted = isHtml
        ? extractReadableText(decoded)
        : { title: '', text: normalizeText(decoded).slice(0, WEB_SOURCE_LIMITS.maxTextChars) };
      if (!extracted.text) {
        throw new AppError(
          ERROR_CODES.validation,
          'Halaman tidak memiliki teks yang dapat dibaca (mungkin memerlukan JavaScript).',
          400,
        );
      }
      return {
        finalUrl: current.toString(),
        title: extracted.title || stripBrackets(current.hostname),
        text: extracted.text,
        contentType: mimeType,
        bytes: response.body.byteLength,
      };
    }
    throw new AppError(ERROR_CODES.validation, 'Sumber web tidak dapat diambil.', 400);
  }
}
