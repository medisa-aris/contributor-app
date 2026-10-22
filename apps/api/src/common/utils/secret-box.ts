import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'v1';

/** Kunci 32 byte (base64) dari INTEGRATIONS_ENCRYPTION_KEY; null bila belum diatur atau tidak valid. */
export function loadEncryptionKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

/** Enkripsi AES-256-GCM; hasil `v1:iv:tag:ciphertext` (base64). */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [prefix, iv, tag, data] = payload.split(':');
  if (prefix !== PREFIX || !iv || !tag || !data) throw new Error('Format rahasia terenkripsi tidak dikenali.');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
