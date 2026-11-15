import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PERMISSIONS } from '@bara/shared';
import { MemoryService } from '../../src/modules/memory/memory.service';
import type { ScopeSubject } from '../../src/modules/memory/memory-scope.service';

/**
 * Isolasi memori (R-ISO): isi `memory_entries` hanya boleh disentuh modul memori, dan setiap
 * pencarian untuk prompt wajib membawa filter cakupan (subjek sendiri, atau subjek lain hanya
 * catatan shareable dengan tipe yang dibuka pintunya).
 */
const SRC = join(__dirname, '../../src');
const ALLOWED = new Set([
  'database/memory-vector.ts',
  'database/migrations/1700000025000-central-memory.ts',
  'database/migrations/1700000030000-memory-phase2-3.ts',
  // Hanya memeriksa keberadaan kolom embedding di information_schema.
  'modules/health/health.controller.ts',
  'modules/memory/memory-embedding.service.ts',
  'modules/memory/memory-extraction.service.ts',
  'modules/memory/memory-insights.service.ts',
  'modules/memory/memory-scope.service.ts',
  'modules/memory/memory.service.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('isolasi memori', () => {
  it('memory_entries hanya diakses dari modul memori', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('memory_entries'))
      .map((file) => relative(SRC, file).split('\\').join('/'))
      .filter((file) => !ALLOWED.has(file));
    expect(offenders).toEqual([]);
  });

  it('setiap kueri pengambilan membawa filter cakupan', async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return [];
      }),
    };
    const subjects: ScopeSubject[] = [
      { subjectId: 'self', name: 'Saya', own: true, exposedTypes: [] },
      { subjectId: 'bawahan', name: 'Dimas', own: false, exposedTypes: ['fact', 'decision'] },
    ];
    const service = new MemoryService(
      dataSource as never,
      { resolve: jest.fn(async () => subjects) } as never,
      { embed: jest.fn(async () => null) } as never,
      { get: jest.fn(async () => ({ enabled: true, maxContextTokens: 1500 })) } as never,
      {} as never,
      {} as never,
    );

    await service.retrieve(
      'user-1',
      new Set([PERMISSIONS.memorySelfManage, PERMISSIONS.memoryDoorsOpen]),
      { kind: 'conversation', id: 'c1' },
      'rekap inspeksi APAR',
    );

    const reads = queries.filter((q) => /FROM memory_entries/.test(q.sql));
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.sql).toMatch(/e\.status = 'active' AND \(/);
      // Subjek orang lain hanya muncul bersama syarat shareable dan tipe yang dibuka.
      if (read.params.includes('bawahan')) {
        expect(read.sql).toContain("e.sensitivity = 'shareable'");
        expect(read.sql).toMatch(/e\.type = ANY\(\$\d+::memory_entry_type\[\]\)/);
      }
      // Tidak ada subjek di luar cakupan yang masuk parameter.
      const subjectParams = read.params.filter((p) => typeof p === 'string' && ['self', 'bawahan'].includes(p));
      expect(subjectParams.length).toBeGreaterThan(0);
    }
  });

  it('tanpa izin memori tidak ada kueri sama sekali', async () => {
    const dataSource = { query: jest.fn() };
    const service = new MemoryService(dataSource as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const result = await service.retrieve('user-1', new Set(), null, 'apa saja');
    expect(result).toEqual({ block: '', refs: [] });
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
