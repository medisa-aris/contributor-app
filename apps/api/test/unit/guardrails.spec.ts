import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GUARDRAIL_CATEGORY_IDS } from '@bara/shared';
import { clampToolResult } from '../../src/modules/ai/gateway.service';
import { categoryForLabel, Detector } from '../../src/modules/ai/guardrails/detectors';
import { GuardedProvider } from '../../src/modules/ai/guardrails/guarded-provider';
import { GuardrailsService } from '../../src/modules/ai/guardrails/guardrails.service';
import {
  isToken,
  MaskSession,
  StreamUnmasker,
  tokenPrefix,
} from '../../src/modules/ai/guardrails/masker';
import type {
  AiProviderAdapter,
  ChatRequestOptions,
  ChatResult,
} from '../../src/modules/ai/providers/types';

const hmacKey = Buffer.alloc(32, 7);
const session = () => new MaskSession(hmacKey);
const all = new Set(GUARDRAIL_CATEGORY_IDS);

function detect(text: string, terms: { value: string; category: string }[] = []) {
  const s = session();
  const d = new Detector(s, all, terms);
  return { output: d.apply(d.structured(text)), session: s, detector: d };
}

describe('format token', () => {
  it('huruf pertama tetap lalu 3 karakter digeser', () => {
    expect(tokenPrefix('Medisa Aris Ginanjar')).toBe('MNFE');
    expect(tokenPrefix('gmail.com')).toBe('GHNB');
    expect(tokenPrefix('081234567890')).toBe('0192');
  });

  it('Z dan 9 tidak berputar, nilai pendek diberi pengisi', () => {
    expect(tokenPrefix('Zzz')).toBe('ZZZZ');
    expect(tokenPrefix('999')).toBe('9999');
    expect(tokenPrefix('Al')).toBe('ABMY');
  });

  it('nama menjadi satu token dan email memakai .com', () => {
    const s = session();
    expect(s.mask('Medisa Aris Ginanjar', 'full_name')).toMatch(/^MNFE[0-9a-f]{12}$/);
    expect(s.mask('medisa@gmail.co.id', 'email')).toMatch(
      /^MNFE[0-9a-f]{12}@GHNB[0-9a-f]{12}\.com$/,
    );
  });

  it('tetap antar-sesi dan hash bergantung kunci', () => {
    const value = 'Medisa Aris Ginanjar';
    expect(session().mask(value, 'x')).toBe(session().mask(value, 'x'));
    expect(new MaskSession(Buffer.alloc(32, 9)).mask(value, 'x')).not.toBe(session().mask(value, 'x'));
  });

  it('token selalu memuat huruf hex, jadi NIK tidak pernah terbaca sebagai token', () => {
    expect(isToken('3171011201900001')).toBe(false);
    const s = session();
    for (let i = 0; i < 2000; i += 1) {
      expect(isToken(s.mask(`0812${i}`, 'phone'))).toBe(true);
    }
  });

  it('urutan 3 huruf pertama terjaga', () => {
    const names = ['Ani', 'Budi', 'Citra', 'Yani', 'Zara'];
    const s = session();
    const sorted = names.map((n) => s.mask(n, 'x')).sort();
    expect(sorted.map((t) => s.unmask(t))).toEqual(names);
  });
});

describe('unmask', () => {
  it('mengembalikan nama, email, dan token huruf kecil', () => {
    const s = session();
    const name = s.mask('Medisa Aris', 'full_name');
    const email = s.mask('medisa@gmail.co.id', 'email');
    expect(s.unmask(`Halo ${name}, kirim ke ${email}.`)).toBe(
      'Halo Medisa Aris, kirim ke medisa@gmail.co.id.',
    );
    expect(s.unmask(name.toLowerCase())).toBe('Medisa Aris');
  });

  it('token tak dikenal dibiarkan dan dihitung', () => {
    const s = session();
    s.mask('Budi', 'full_name');
    expect(s.unmask('ABCD1234567890ab')).toBe('ABCD1234567890ab');
    expect(s.unresolved).toBe(1);
  });

  it('round-trip 1 juta nilai', () => {
    const s = session();
    const parts: string[] = [];
    for (let i = 0; i < 1_000_000; i += 1) parts.push(s.mask(`Pelanggan Nomor ${i}`, 'full_name'));
    const restored = s.unmask(parts.join('\n')).split('\n');
    expect(restored).toHaveLength(1_000_000);
    expect(restored[0]).toBe('Pelanggan Nomor 0');
    expect(restored[999_999]).toBe('Pelanggan Nomor 999999');
    expect(s.unresolved).toBe(0);
  }, 120_000);
});

describe('stream', () => {
  it('token terpotong di setiap posisi tetap pulih', () => {
    const s = session();
    const email = s.mask('medisa@gmail.com', 'email');
    const name = s.mask('Medisa Aris', 'full_name');
    const masked = `Halo ${name}, email ${email}. Selesai`;
    const expected = 'Halo Medisa Aris, email medisa@gmail.com. Selesai';
    for (let cut = 1; cut < masked.length; cut += 1) {
      const unmasker = new StreamUnmasker(s);
      const out = unmasker.push(masked.slice(0, cut)) + unmasker.push(masked.slice(cut)) + unmasker.flush();
      expect(out).toBe(expected);
    }
    const unmasker = new StreamUnmasker(s);
    let out = '';
    for (const char of masked) out += unmasker.push(char);
    expect(out + unmasker.flush()).toBe(expected);
  });
});

describe('detektor', () => {
  it('mengenali nama kolom tanpa menyentuh yang bukan orang', () => {
    expect(categoryForLabel('Nama Lengkap')).toBe('full_name');
    expect(categoryForLabel('nama_karyawan')).toBe('full_name');
    expect(categoryForLabel('nama_ibu_kandung')).toBe('mother_name');
    expect(categoryForLabel('alamat_email')).toBe('email');
    expect(categoryForLabel('No. HP')).toBe('phone');
    expect(categoryForLabel('nama_produk')).toBeNull();
    expect(categoryForLabel('anak_perusahaan')).toBeNull();
    expect(categoryForLabel('harga')).toBeNull();
  });

  it('tabel Markdown: kolom sensitif dimasking, kolom lain utuh', () => {
    const { output, session: s } = detect(
      '| Nama | Email | Kota |\n|---|---|---|\n| Medisa Aris | medisa@gmail.com | Bandung |',
    );
    expect(output).not.toContain('Medisa');
    expect(output).not.toContain('gmail');
    expect(output).toContain('Bandung');
    expect(s.unmask(output)).toContain('| Medisa Aris | medisa@gmail.com | Bandung |');
  });

  it('CSV, TSV, dan kutip', () => {
    expect(detect('nama,agama\n"Sari, S.T.",Islam\n').output).not.toMatch(/Sari|Islam/);
    expect(detect('nama\tgaji\nBudi\t5000000').output).not.toMatch(/Budi|5000000/);
  });

  it('JSON: string, angka, dan nilai terpotong', () => {
    const { output, session: s } = detect('{"name":"Budi Santoso","gaji":5000000,"kota":"Solo"}');
    expect(output).not.toMatch(/Budi|5000000/);
    expect(output).toContain('Solo');
    expect(s.unmask(output)).toContain('"name":"Budi Santoso"');
    expect(detect('[{"nama":"Rina Wati').output).not.toContain('Rina');
  });

  it('kunci: nilai, termasuk beberapa pasangan satu baris', () => {
    const { output } = detect('**Nama:** Medisa\nAgama: Islam, Telp: 02199\nAlamat: Jl. Mawar 5, Bandung');
    expect(output).not.toMatch(/Medisa|Islam|02199|Mawar|Bandung/);
  });

  it('kosong dan bukan data tidak dimasking', () => {
    expect(detect('nama: -').output).toBe('nama: -');
    expect(detect('Pukul 10:30 di https://contoh.id').output).toBe('Pukul 10:30 di https://contoh.id');
  });

  it('pola tetap', () => {
    const text =
      'mail a.b@yahoo.co.id, hp +62 812-3456-7890, kantor 021-7997973, NIK 3171011201900001, kartu 4111 1111 1111 1111, NPWP 12.345.678.9-012.345, rekening: 1234567890';
    const { output, session: s } = detect(text);
    for (const raw of ['a.b@', '812-3456', '7997973', '3171011201900001', '4111', '12.345.678', '1234567890']) {
      expect(output).not.toContain(raw);
    }
    expect(s.unmask(output)).toBe(text);
  });

  it('angka 16 digit yang bukan NIK dan bukan kartu dibiarkan', () => {
    expect(detect('kode 0000000000000001').output).toBe('kode 0000000000000001');
  });

  it('nama dari kata pemicu menyebar ke seluruh teks, tanpa frasa umum', () => {
    expect(detect('Laporan Pak Hendra Wijaya. Hendra setuju.').output).not.toContain('Hendra');
    expect(detect('Ibu Kota pindah.').output).toBe('Ibu Kota pindah.');
  });

  it('kamus: cocok seluruh nama dan potongannya, potongan butuh huruf besar', () => {
    const terms = [{ value: 'Indah Permata', category: 'full_name' }];
    expect(detect('INDAH PERMATA hadir', terms).output).not.toContain('INDAH');
    expect(detect('Indah hadir', terms).output).not.toContain('Indah');
    expect(detect('pemandangan indah', terms).output).toBe('pemandangan indah');
  });

  it('nama dari tabel menutup kalimat di teks lain', () => {
    const s = session();
    const d = new Detector(s, all, []);
    d.structured('nama,email\nMedisa Aris,m@x.io');
    expect(d.apply('Medisa Aris sudah setuju')).not.toContain('Medisa');
    expect(d.discovered.has('Medisa Aris')).toBe(true);
  });

  it('kategori nonaktif diabaikan', () => {
    const s = session();
    const d = new Detector(s, new Set(['full_name']), []);
    expect(d.apply(d.structured('email a@b.co dan agama: Islam'))).toBe('email a@b.co dan agama: Islam');
  });

  it('idempoten: teks bertoken tidak berubah saat dimasking lagi', () => {
    const first = detect(
      'nama,email,nik\nMedisa,m@gmail.com,3171011201900001\nTelp 081234567890, nama: Budi',
    ).output;
    const second = detect(first).output;
    expect(second).toBe(first);
  });
});

describe('clampToolResult', () => {
  it('memotong di batas baris bila dekat', () => {
    const out = clampToolResult('a'.repeat(95) + '\n' + 'b'.repeat(50), 100);
    expect(out).not.toContain('b');
    expect(out).toContain('dipotong: 51');
  });
});

function makeService(settings: Record<string, unknown>, secret: string | null = randomBytes(32).toString('base64')) {
  const stored: unknown[][] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM app_config')) {
        return Object.entries(settings).map(([key, value]) => ({ key, value }));
      }
      if (sql.includes('FROM users')) return [{ display_name: 'Hendra Wijaya' }];
      if (sql.includes('INSERT INTO guardrail_terms')) stored.push(params);
      return [];
    }),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const config = { get: () => secret };
  return {
    service: new GuardrailsService(dataSource as never, config as never, audit as never),
    audit,
    stored,
  };
}

const ON = { 'ai.guardrails_enabled': true };

function request(extra: Partial<ChatRequestOptions> = {}): ChatRequestOptions {
  return {
    model: 'm',
    systemPrompt: 'Konteks:\nnama,email\nMedisa Aris,medisa@gmail.com',
    messages: [{ role: 'user', content: 'Hubungi medisa@gmail.com, Hendra tahu.' }],
    maxTokens: 10,
    ...extra,
  };
}

function fakeAdapter(reply: (sent: ChatRequestOptions) => ChatResult, chunks?: (r: ChatResult) => string[]) {
  const sent: ChatRequestOptions[] = [];
  const adapter: AiProviderAdapter = {
    id: 'fake',
    async chat(options) {
      sent.push(options);
      return reply(options);
    },
    async *stream(options) {
      sent.push(options);
      const result = reply(options);
      for (const chunk of chunks?.(result) ?? [result.content]) yield chunk;
      return result;
    },
  };
  return { adapter, sent };
}

const tokenIn = (text: string) => /[A-Z0-9]{4}[0-9a-f]{12}@[A-Z0-9]{4}[0-9a-f]{12}\.com/.exec(text)![0];
const base = { model: 'm', tokensIn: 1, tokensOut: 1 };

describe('GuardedProvider', () => {
  it('nonaktif: permintaan diteruskan apa adanya', async () => {
    const { service } = makeService({});
    const { adapter, sent } = fakeAdapter(() => ({ ...base, content: 'ok' }));
    const options = request();
    await new GuardedProvider(adapter, service).chat(options);
    expect(sent[0]).toBe(options);
  });

  it('aktif: penyedia hanya melihat token, pemanggil melihat asli', async () => {
    const { service, audit, stored } = makeService(ON);
    const { adapter, sent } = fakeAdapter((o) => ({
      ...base,
      content: `Sudah ke ${tokenIn(o.messages[0]!.content)}`,
    }));
    const result = await new GuardedProvider(adapter, service).chat(
      request({ guard: { userId: 'u', conversationId: 'c' } }),
    );
    const payload = JSON.stringify(sent[0]);
    expect(payload).not.toMatch(/Medisa|medisa|gmail|Hendra/);
    expect(result.content).toBe('Sudah ke medisa@gmail.com');
    expect(result.guardrails).toMatchObject({ email: expect.any(Number) });
    expect(JSON.stringify(result.guardrails)).not.toContain('Medisa');
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored[0])).not.toContain('Medisa');
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/Medisa|medisa@/);
  });

  it('stream: delta dan hasil akhir dipulihkan', async () => {
    const { service } = makeService(ON);
    const { adapter } = fakeAdapter(
      (o) => ({ ...base, content: `Ke ${tokenIn(o.messages[0]!.content)} ya` }),
      (r) => [r.content.slice(0, 10), r.content.slice(10)],
    );
    const generator = new GuardedProvider(adapter, service).stream(request());
    let text = '';
    for (;;) {
      const step = await generator.next();
      if (step.done) {
        expect(step.value.content).toBe('Ke medisa@gmail.com ya');
        break;
      }
      text += step.value;
    }
    expect(text).toBe('Ke medisa@gmail.com ya');
  });

  it('argumen tool di-unmask, kecuali tool keepMasked', async () => {
    const { service } = makeService(ON);
    const { adapter } = fakeAdapter((o) => {
      const token = tokenIn(o.messages[0]!.content);
      return {
        ...base,
        content: '',
        toolCalls: [
          { id: '1', name: 'db', input: { to: token } },
          { id: '2', name: 'web_search', input: { query: token } },
        ],
      };
    });
    const result = await new GuardedProvider(adapter, service).chat(
      request({
        tools: [
          { name: 'db', description: '', inputSchema: {} },
          { name: 'web_search', description: '', inputSchema: {}, keepMasked: true },
        ],
      }),
    );
    expect(result.toolCalls![0]!.input.to).toBe('medisa@gmail.com');
    expect(String(result.toolCalls![1]!.input.query)).not.toContain('gmail');
  });

  it('hasil tool dan argumen riwayat ikut dimasking', async () => {
    const { service } = makeService(ON);
    const { adapter, sent } = fakeAdapter(() => ({ ...base, content: 'ok' }));
    await new GuardedProvider(adapter, service).chat(
      request({
        messages: [
          { role: 'user', content: 'cek' },
          { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'db', input: { email: 'x@y.co', nested: [{ nama: 'Rina' }] } }] },
          { role: 'tool', toolCallId: '1', content: '{"nama":"Rina Wati"}' },
        ],
      }),
    );
    expect(JSON.stringify(sent[0])).not.toMatch(/x@y\.co|Rina/);
  });

  const images = [{ name: 'a', mimeType: 'image/png', dataBase64: 'AA' }];

  it('gambar diblokir saat opsinya aktif', async () => {
    const { service } = makeService(ON);
    const { adapter, sent } = fakeAdapter(() => ({ ...base, content: 'ok' }));
    await expect(new GuardedProvider(adapter, service).chat(request({ images }))).rejects.toThrow(/gambar/i);
    expect(sent).toHaveLength(0);
  });

  it('gambar diteruskan bila opsi blokir dimatikan', async () => {
    const { service } = makeService({ ...ON, 'ai.guardrails_block_images': false });
    const { adapter, sent } = fakeAdapter(() => ({ ...base, content: 'ok' }));
    await new GuardedProvider(adapter, service).chat(request({ images }));
    expect(sent[0]!.images).toEqual(images);
  });

  it('gagal tertutup: tanpa kunci tidak ada yang terkirim', async () => {
    const { service } = makeService(ON, null);
    const { adapter, sent } = fakeAdapter(() => ({ ...base, content: 'ok' }));
    await expect(new GuardedProvider(adapter, service).chat(request())).rejects.toThrow(/Guardrails/);
    expect(sent).toHaveLength(0);
  });

  it('tidak bisa diaktifkan tanpa kunci', async () => {
    const { service } = makeService({}, null);
    await expect(
      service.updateSettings({ enabled: true, blockImages: true, categories: [], terms: [] }, 'u'),
    ).rejects.toThrow(/GUARDRAILS_SECRET_KEY/);
  });
});

describe('arsitektur', () => {
  it('adapter penyedia hanya dibuat di gateway', () => {
    const root = join(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (
          path.endsWith('.ts') &&
          !path.endsWith('gateway.service.ts') &&
          /new (AnthropicProvider|OpenAiCompatibleProvider)\(/.test(readFileSync(path, 'utf8'))
        ) {
          offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
