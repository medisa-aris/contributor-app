import { createHmac, timingSafeEqual } from 'node:crypto';

/** JWT HS256 minimal (tanpa dependensi) untuk pertukaran dengan OnlyOffice Document Server. */

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = hmac(`${header}.${body}`, secret).toString('base64url');
  return `${header}.${body}.${signature}`;
}

/** Mengembalikan payload bila tanda tangan sah dan belum kedaluwarsa; selain itu null. */
export function verifyJwt(
  token: string,
  secret: string,
  nowMs = Date.now(),
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  let parsedHeader: { alg?: unknown };
  let payload: Record<string, unknown>;
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
      alg?: unknown;
    };
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
  if (parsedHeader.alg !== 'HS256') return null;
  if (!safeEqual(Buffer.from(signature, 'base64url'), hmac(`${header}.${body}`, secret)))
    return null;
  if (typeof payload.exp === 'number' && payload.exp * 1000 < nowMs) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload;
}

export type OfficeSourceKind = 'doc' | 'att';

export interface FileTokenClaims {
  /** doc = user_documents, att = conversation_attachments. */
  k: OfficeSourceKind;
  id: string;
  uid: string;
  /** Versi dokumen saat editor dibuka (lampiran selalu 0). */
  v: number;
  /** Detik epoch. */
  exp: number;
}

/** Token berumur pendek di query string URL berkas/callback: payload.base64url + HMAC. */
export function mintFileToken(claims: FileTokenClaims, secret: string): string {
  const body = b64url(JSON.stringify(claims));
  return `${body}.${hmac(`file:${body}`, secret).toString('base64url')}`;
}

export function verifyFileToken(
  token: string,
  secret: string,
  expected: { k: OfficeSourceKind; id: string },
  nowMs = Date.now(),
): FileTokenClaims | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  if (!safeEqual(Buffer.from(signature, 'base64url'), hmac(`file:${body}`, secret))) return null;
  let claims: FileTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FileTokenClaims;
  } catch {
    return null;
  }
  if (claims.k !== expected.k || claims.id !== expected.id) return null;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < nowMs) return null;
  if (typeof claims.uid !== 'string' || typeof claims.v !== 'number') return null;
  return claims;
}
