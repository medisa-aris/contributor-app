/**
 * Pengaman SQL untuk query yang ditulis model:
 * - menolak lebih dari satu statement;
 * - mengklasifikasikan statement menjadi `read`, `write` (DML, wajib approval), atau `blocked`
 *   (DDL/DCL/prosedur dan perintah sesi yang tidak diizinkan sama sekali);
 * - mengekstrak nama tabel secara heuristik untuk allowlist tabel.
 *
 * Klasifikasi ini adalah lapisan pertama. Query `read` tetap dijalankan di dalam transaksi
 * read-only/rollback oleh driver sebagai lapisan kedua.
 */

export type SqlKind = 'read' | 'write' | 'blocked';

export interface SqlClassification {
  kind: SqlKind;
  /** Statement yang sudah dirapikan (tanpa titik koma penutup). */
  statement: string;
  /** Kata kunci pertama (huruf besar), mis. SELECT, UPDATE. */
  verb: string;
  reason?: string;
}

const READ_VERBS = new Set([
  'SELECT',
  'WITH',
  'SHOW',
  'DESCRIBE',
  'DESC',
  'EXPLAIN',
  'VALUES',
  'TABLE',
]);
const WRITE_VERBS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT', 'REPLACE']);
const DML_INSIDE = /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE)\b/;
const DDL_INSIDE = /\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE|CALL)\b/;

/**
 * Ganti isi literal string, identifier berkutip, dan komentar dengan spasi agar analisis
 * kata kunci dan titik koma tidak tertipu isinya. Panjang teks dipertahankan.
 */
export function maskSql(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === '#') {
      // komentar gaya MySQL
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          // kutip ganda di dalam literal ('it''s') = escape
          if (sql[j + 1] === close && close !== ']') {
            j += 2;
            continue;
          }
          break;
        }
        if (sql[j] === '\\' && close === "'") j += 1;
        j += 1;
      }
      const stop = Math.min(j + 1, sql.length);
      // Pertahankan identifier berkutip sebagai teks "q" agar tabel tetap terdeteksi.
      const length = stop - i;
      if (ch === "'") out += length >= 2 ? `'${' '.repeat(length - 2)}'` : ' '.repeat(length);
      else out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '$') {
      // dollar-quoting PostgreSQL: $tag$ ... $tag$
      const match = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (match) {
        const tag = match[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        out += ' '.repeat(stop - i);
        i = stop;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function classifySql(raw: string): SqlClassification {
  const trimmed = raw.trim().replace(/;\s*$/, '').trim();
  const masked = maskSql(trimmed);
  const verb = (/^[\s(]*([A-Za-z]+)/.exec(masked)?.[1] ?? '').toUpperCase();
  const base = { statement: trimmed, verb };

  if (!masked.trim()) return { ...base, kind: 'blocked', reason: 'Query kosong.' };
  if (masked.includes(';')) {
    return { ...base, kind: 'blocked', reason: 'Hanya satu statement per query yang diizinkan.' };
  }
  const upper = masked.toUpperCase();

  if (READ_VERBS.has(verb)) {
    if (DDL_INSIDE.test(upper)) {
      return {
        ...base,
        kind: 'blocked',
        reason: 'Query baca tidak boleh berisi perintah DDL/eksekusi.',
      };
    }
    // CTE yang memodifikasi data, SELECT ... INTO, atau penguncian baris diperlakukan sebagai tulis.
    if (
      DML_INSIDE.test(upper) ||
      /\bINTO\b/.test(upper) ||
      /\bFOR\s+(UPDATE|SHARE)\b/.test(upper)
    ) {
      if (verb === 'EXPLAIN' && !/\bANALY[SZ]E\b/.test(upper)) return { ...base, kind: 'read' };
      return { ...base, kind: 'write' };
    }
    return { ...base, kind: 'read' };
  }
  if (WRITE_VERBS.has(verb)) {
    if (DDL_INSIDE.test(upper)) {
      return {
        ...base,
        kind: 'blocked',
        reason: 'Query tulis tidak boleh berisi perintah DDL/eksekusi.',
      };
    }
    return { ...base, kind: 'write' };
  }
  return {
    ...base,
    kind: 'blocked',
    reason: `Perintah ${verb || 'ini'} tidak diizinkan. Hanya SELECT (baca) atau INSERT/UPDATE/DELETE/MERGE (tulis, dengan persetujuan).`,
  };
}

const IDENT = String.raw`(?:"[^"]+"|\`[^\`]+\`|\[[^\]]+\]|[A-Za-z_][\w$#]*)`;
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT}){0,2}`;
const TABLE_REF = new RegExp(
  String.raw`\b(?:FROM|JOIN|INTO|UPDATE|TABLE|USING|DESCRIBE|DESC)\s+(${QUALIFIED})`,
  'gi',
);

function unquote(part: string): string {
  return part.replace(/^["`[]|["`\]]$/g, '').toLowerCase();
}

/**
 * Nama tabel yang dirujuk (heuristik): `schema.table` atau `table`, huruf kecil, tanpa kutip.
 * Nama CTE (WITH x AS ...) dan fungsi tabel di-skip.
 */
export function referencedTables(sql: string): string[] {
  const masked = maskSql(sql);
  const ctes = new Set(
    [
      ...masked.matchAll(
        new RegExp(String.raw`(?:WITH|,)\s*(?:RECURSIVE\s+)?(${IDENT})\s+AS\s*\(`, 'gi'),
      ),
    ].map((m) => unquote(m[1]!)),
  );
  const found = new Set<string>();
  for (const match of masked.matchAll(TABLE_REF)) {
    const keyword = match[0].trimStart().split(/\s+/)[0]!.toUpperCase();
    const after = masked.slice((match.index ?? 0) + match[0].length).trimStart();
    const name = match[1]!
      .split('.')
      .map((part) => unquote(part.trim()))
      .join('.');
    if (/^(select|lateral|unnest|dual)$/.test(name) || ctes.has(name)) continue;
    // `FROM fungsi(...)`: fungsi tabel dicatat dengan akhiran () agar allowlist menolaknya
    // kecuali didaftarkan eksplisit. `INSERT INTO t (kolom)` tetap dianggap tabel.
    if (after.startsWith('(') && keyword !== 'INTO') {
      found.add(`${name}()`);
      continue;
    }
    found.add(name);
  }
  return [...found];
}

/**
 * Semua tabel yang dirujuk harus ada di allowlist. Entri allowlist boleh `table` atau
 * `schema.table`; pencocokan tidak peka huruf besar/kecil.
 */
export function tablesAllowed(
  sql: string,
  allowlist: string[] | null | undefined,
): { ok: boolean; denied: string[] } {
  if (!allowlist || allowlist.length === 0) return { ok: true, denied: [] };
  const allowed = new Set(allowlist.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const denied = referencedTables(sql).filter((name) => {
    if (allowed.has(name)) return false;
    const short = name.split('.').pop()!;
    return !allowed.has(short);
  });
  return { ok: denied.length === 0, denied };
}
