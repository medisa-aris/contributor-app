import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, loadEncryptionKey } from '../../src/common/utils/secret-box';

describe('secret-box', () => {
  const key = randomBytes(32);

  it('mengenkripsi lalu mendekripsi kembali nilai aslinya', () => {
    const encrypted = encryptSecret('token-rahasia', key);
    expect(encrypted).not.toContain('token-rahasia');
    expect(decryptSecret(encrypted, key)).toBe('token-rahasia');
  });

  it('menghasilkan ciphertext berbeda untuk input sama (IV acak)', () => {
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key));
  });

  it('menolak kunci yang salah', () => {
    const encrypted = encryptSecret('x', key);
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow();
  });

  it('loadEncryptionKey hanya menerima base64 32 byte', () => {
    expect(loadEncryptionKey(undefined)).toBeNull();
    expect(loadEncryptionKey('pendek')).toBeNull();
    expect(loadEncryptionKey(key.toString('base64'))).toHaveLength(32);
  });
});
