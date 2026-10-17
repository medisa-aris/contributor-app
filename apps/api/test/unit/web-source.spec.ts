import {
  decodeHtmlEntities,
  extractReadableText,
  isPublicAddress,
  normalizeWebUrl,
} from '../../src/modules/ai/web-source.service';

describe('web source: validasi URL', () => {
  it('menerima http/https dan membuang fragmen', () => {
    expect(normalizeWebUrl(' https://contoh.com/artikel#bagian ').toString()).toBe(
      'https://contoh.com/artikel',
    );
    expect(normalizeWebUrl('http://contoh.com').toString()).toBe('http://contoh.com/');
  });

  it('menolak skema selain http/https dan URL berkredensial', () => {
    expect(() => normalizeWebUrl('file:///etc/passwd')).toThrow(/http atau https/);
    expect(() => normalizeWebUrl('javascript:alert(1)')).toThrow(/http atau https/);
    expect(() => normalizeWebUrl('http://user:rahasia@contoh.com')).toThrow(/kredensial/);
    expect(() => normalizeWebUrl('')).toThrow(/tidak boleh kosong/);
    expect(() => normalizeWebUrl('bukan url')).toThrow(/tidak valid/);
  });
});

describe('web source: alamat IP', () => {
  it('memblokir alamat internal, loopback, metadata, dan privat', () => {
    for (const address of [
      '0.0.0.0',
      '10.10.10.10',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.62',
      '192.0.2.10',
      '198.51.100.20',
      '203.0.113.30',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'ff02::1',
      '2001:db8::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
  });

  it('mengizinkan alamat publik', () => {
    for (const address of [
      '8.8.8.8',
      '93.184.216.34',
      '172.32.0.1',
      '100.128.0.1',
      '2001:4860:4860::8888',
      '::ffff:8.8.8.8',
    ]) {
      expect(isPublicAddress(address)).toBe(true);
    }
  });
});

describe('web source: ekstraksi halaman', () => {
  it('mengambil judul dan teks bersih tanpa script, nav, atau footer', () => {
    const html = `<!doctype html>
      <html><head>
        <title>Kebijakan Cuti &amp; Izin</title>
        <meta property="og:title" content="Panduan Cuti Tahunan">
        <style>.tersembunyi { display: none; }</style>
        <script>alert('jangan diambil');</script>
      </head><body>
        <nav>Menu utama</nav>
        <h1>Panduan Cuti Tahunan</h1>
        <p>Karyawan memperoleh <strong>12 hari</strong> cuti tahunan.</p>
        <ul><li>Izin sakit</li><li>Cuti melahirkan</li></ul>
        <footer>Hak cipta perusahaan</footer>
      </body></html>`;

    const result = extractReadableText(html);
    expect(result.title).toBe('Panduan Cuti Tahunan');
    expect(result.text).toContain('12 hari');
    expect(result.text).toContain('- Izin sakit');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('Menu utama');
    expect(result.text).not.toContain('Hak cipta perusahaan');
  });

  it('men-decode entitas HTML bernama dan numerik', () => {
    expect(decodeHtmlEntities('Cuti &amp; izin&nbsp;12&ndash;14 hari &mdash; &#39;wajib&#39; &#x2705;')).toBe(
      'Cuti & izin 12–14 hari — \'wajib\' ✅',
    );
  });

  it('mengembalikan teks kosong untuk halaman tanpa konten', () => {
    const result = extractReadableText('<html><script>var x = 1;</script></html>');
    expect(result.title).toBe('');
    expect(result.text).toBe('');
  });
});
