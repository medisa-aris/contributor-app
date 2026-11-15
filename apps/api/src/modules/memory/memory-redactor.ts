import { randomBytes } from 'node:crypto';
import { GUARDRAIL_CATEGORY_IDS } from '@bara/shared';
import { Detector } from '../ai/guardrails/detectors';
import { MaskSession } from '../ai/guardrails/masker';

/** Label pengganti permanen per kategori; catatan memori tidak pernah bisa dipulihkan ke nilai asli. */
const LABELS: Record<string, string> = {
  nik: '[NIK]',
  phone: '[nomor telepon]',
  email: '[email]',
  address: '[alamat]',
  birth_date: '[tanggal lahir]',
  financial: '[data keuangan]',
  password: '[kata sandi]',
  mother_name: '[nama ibu kandung]',
  full_name: '[nama]',
};

/** Sesi masking yang tidak bisa di-unmask: nilai diganti label kategori. */
class RedactingSession extends MaskSession {
  constructor() {
    super(randomBytes(32));
  }

  override mask(_value: string, category: string): string {
    return LABELS[category] ?? '[data pribadi]';
  }
}

/**
 * Hapus data pribadi dari teks sebelum diekstrak atau disimpan ke memori, tidak bergantung
 * pada pengaturan Guardrails. Nama orang dibiarkan secara bawaan karena catatan seperti
 * "Dina menyetujui…" bergantung padanya; `names: true` juga menutup nama dari direktori.
 */
export function redactForMemory(
  text: string,
  options: { names?: boolean; directory?: readonly string[]; terms?: readonly string[] } = {},
): string {
  if (!text) return text;
  const categories = new Set(
    GUARDRAIL_CATEGORY_IDS.filter((id) => options.names || id !== 'full_name'),
  );
  const detector = new Detector(new RedactingSession(), categories, [
    ...(options.names ? (options.directory ?? []).map((value) => ({ value, category: 'full_name' })) : []),
    ...(options.terms ?? []).map((value) => ({ value, category: 'custom' })),
  ]);
  return detector
    .apply(detector.structured(text))
    .replace(ACCOUNT_NUMBER, (_match, label: string) => `${label} [nomor rekening]`);
}

/** Nomor rekening tanpa tanda titik dua ("Rekening BCA 1234567890") tidak tertangkap detektor kunci-nilai. */
const ACCOUNT_NUMBER =
  /\b((?:no\.?\s*)?rek(?:ening)?(?:\s+[A-Z]{2,10})?|account(?:\s+number)?|norek)[\s.:#-]*\d[\d\s.-]{5,}\d/gi;
