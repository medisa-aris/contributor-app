import {
  buildMemoryBlock,
  MAX_ENTRIES_PER_SUBJECT,
  rankCandidates,
  recency,
  rrf,
  type RankCandidate,
} from '../../src/modules/memory/memory-ranking';
import { parseOperations } from '../../src/modules/memory/memory-extraction.service';
import { cleanSummary, themeOf } from '../../src/modules/memory/memory-insights.service';
import { redactForMemory } from '../../src/modules/memory/memory-redactor';
import { toTsQuery } from '../../src/modules/memory/memory.service';

const NOW = new Date('2026-11-14T00:00:00Z');

function candidate(overrides: Partial<RankCandidate>): RankCandidate {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    subjectId: 's1',
    subjectName: 'Budi',
    own: false,
    type: 'fact',
    content: 'Catatan',
    importance: 3,
    createdAt: NOW,
    vectorRank: null,
    textRank: null,
    ...overrides,
  };
}

describe('memory ranking', () => {
  it('RRF menjumlahkan peringkat dari kedua pencarian', () => {
    expect(rrf(1, null)).toBeCloseTo(1 / 61);
    expect(rrf(1, 1)).toBeCloseTo(2 / 61);
    expect(rrf(null, null)).toBe(0);
  });

  it('keputusan meluruh lebih lambat daripada peristiwa', () => {
    const old = new Date('2026-05-14T00:00:00Z');
    expect(recency('decision', old, NOW)).toBeGreaterThan(recency('episode', old, NOW));
    expect(recency('fact', NOW, NOW)).toBe(1);
  });

  it('catatan yang muncul di kedua pencarian mengungguli yang hanya di satu', () => {
    const ranked = rankCandidates(
      [
        candidate({ id: 'text-only', textRank: 1 }),
        candidate({ id: 'both', textRank: 2, vectorRank: 2 }),
        candidate({ id: 'none' }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.id)).toEqual(['both', 'text-only']);
  });

  it('membatasi jumlah catatan per subjek', () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate({ id: `e${i}`, textRank: i + 1 }));
    expect(rankCandidates(many, NOW)).toHaveLength(MAX_ENTRIES_PER_SUBJECT);
  });

  it('blok prompt mengelompokkan per subjek, memori sendiri lebih dulu, dan patuh anggaran', () => {
    const ranked = rankCandidates(
      [
        candidate({ id: 'a', subjectId: 'other', subjectName: 'Budi', content: 'Budi memegang SOP klaim.', textRank: 1 }),
        candidate({ id: 'b', subjectId: 'me', subjectName: 'Saya', own: true, type: 'preference', content: 'Suka poin.', textRank: 2 }),
      ],
      NOW,
    );
    const { block, refs } = buildMemoryBlock(ranked, 1500);
    expect(block.indexOf('### Dari memori Anda')).toBeLessThan(block.indexOf('### Dari memori Budi'));
    expect(block).toContain('[m1] (fakta) Budi memegang SOP klaim.');
    expect(refs.map((r) => r.entryId)).toEqual(['a', 'b']);

    const tiny = buildMemoryBlock(ranked, 50);
    expect(tiny).toEqual({ block: '', refs: [] });
  });
});

describe('toTsQuery', () => {
  it('membuang kata umum, membuat OR, dan awalan untuk kata panjang', () => {
    expect(toTsQuery('Siapa yang mengurus klaim di HSE?')).toBe('mengurus:* | klaim:* | hse');
  });

  it('aman dari sintaks tsquery', () => {
    expect(toTsQuery("klaim' & !(drop) | :*")).toBe('klaim:* | drop:*');
    expect(toTsQuery('?? !!')).toBeNull();
  });
});

describe('parseOperations', () => {
  it('menerima label agent anggota grup dan menolak label lain', () => {
    const ops = parseOperations(
      JSON.stringify([
        { about: 'agent2', type: 'skill', content: 'Agent K3 memeriksa APAR per lantai', confidence: 0.8 },
        { about: 'admin', type: 'fact', content: 'Label asing', confidence: 0.8 },
      ]),
    );
    expect(ops.map((o) => o.about)).toEqual(['agent2', 'user']);
  });

  it('membaca JSON di dalam teks dan membuang operasi tidak valid', () => {
    const raw = `Berikut hasilnya:\n\`\`\`json\n${JSON.stringify({
      operations: [
        { op: 'add', about: 'user', type: 'fact', content: 'Fakta A', confidence: 0.9, importance: 9 },
        { op: 'add', type: 'unknown', content: 'X', confidence: 0.9 },
        { op: 'delete', type: 'fact', content: 'Y', confidence: 0.9 },
        { op: 'add', type: 'fact', content: 'Ragu', confidence: 0.3 },
        { op: 'supersede', targetId: 'abc', about: 'agent', type: 'decision', content: 'Z', confidence: 1, sensitivity: 'private' },
      ],
    })}\n\`\`\``;
    const ops = parseOperations(raw);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ op: 'add', about: 'user', importance: 5, sensitivity: 'shareable', targetId: null });
    expect(ops[1]).toMatchObject({ op: 'supersede', about: 'agent', targetId: 'abc', sensitivity: 'private' });
  });

  it('menerima array polos, satu objek, dan `entries` tanpa op (keluaran model kecil)', () => {
    const item = { about: 'user', type: 'preference', content: 'Suka tabel.', confidence: 1 };
    expect(parseOperations(JSON.stringify([{ op: 'update', targetId: '<id catatan lama atau null>', ...item }]))).toEqual([
      expect.objectContaining({ op: 'update', content: 'Suka tabel.' }),
    ]);
    expect(parseOperations(`Hasil: ${JSON.stringify({ op: 'add', ...item })}`)).toHaveLength(1);
    expect(parseOperations(JSON.stringify({ entries: [item] }))).toEqual([expect.objectContaining({ op: 'add' })]);
  });

  it('keluaran rusak menghasilkan daftar kosong', () => {
    expect(parseOperations('tidak ada json')).toEqual([]);
    expect(parseOperations('{"operations": "bukan array"}')).toEqual([]);
  });
});

describe('redactForMemory', () => {
  it('menutup data pribadi terstruktur tetapi mempertahankan nama', () => {
    const text = redactForMemory(
      'Dina menyetujui. HP 0812-3456-7890, email dina@contoh.co.id, NIK 3201012304890002, Rekening BCA 1234567890.',
    );
    expect(text).toContain('Dina menyetujui.');
    expect(text).toContain('[nomor telepon]');
    expect(text).toContain('[email]');
    expect(text).toContain('[NIK]');
    expect(text).toContain('[nomor rekening]');
    expect(text).not.toMatch(/\d{6,}/);
  });

  it('dapat menutup nama dari direktori bila diminta', () => {
    expect(redactForMemory('Dina Lestari menyetujui', { names: true, directory: ['Dina Lestari'] })).toBe(
      '[nama] menyetujui',
    );
  });
});

describe('ringkasan profil dan tema (P3)', () => {
  it('membuang awalan "Subjek:" dan judul yang ditulis model', () => {
    const raw = 'Subjek: Ratna (pengguna).\n\nRingkasan Profil:\nRatna bertanggung jawab atas inspeksi APAR.';
    expect(cleanSummary(raw)).toBe('Ratna bertanggung jawab atas inspeksi APAR.');
    expect(cleanSummary('## Ringkasan\n**Dina** memimpin tim klaim.')).toBe('Dina memimpin tim klaim.');
    expect(cleanSummary('Ringkasan profil: Dina memimpin tim klaim santunan sejak 2025.')).toBe(
      'Dina memimpin tim klaim santunan sejak 2025.',
    );
  });

  it('tema dihitung per catatan, tanpa nama subjek dan kata umum', () => {
    const theme = themeOf({ id: 's', kind: 'user', name: 'Dimas Aryo', department_name: 'HIRA' }, false, [
      { type: 'decision', content: 'Dimas menyepakati inspeksi APAR setiap 2 minggu.' },
      { type: 'fact', content: 'Inspeksi APAR dicatat di formulir IK-HSE-07 oleh Dimas.' },
      { type: 'fact', content: 'Formulir inspeksi disimpan di gudang.' },
    ]);
    expect(theme.counts).toEqual({ decision: 1, fact: 2 });
    expect(theme.themes[0]).toEqual({ term: 'inspeksi', weight: 3 });
    expect(theme.themes.map((t) => t.term)).not.toContain('dimas');
    expect(theme.themes.map((t) => t.term)).not.toContain('yang');
  });
});
