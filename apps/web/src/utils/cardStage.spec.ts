import { describe, expect, it } from 'vitest';
import { clampToStage, gridHeight, gridLayout } from './cardStage';

const GRID = { gap: 20, padding: 24 };
const card = { width: 300, height: 200 };

describe('cardStage', () => {
  it('menyusun kartu dalam grid rata tengah dengan lebar sama', () => {
    const stage = { width: 1000, height: 600 };
    const points = gridLayout(stage, [card, card, card, card, card], GRID);
    // 3 kolom muat di 1000px: baris pertama 3 kartu, baris kedua 2 kartu
    const px = points.map((p) => ({ x: p.x * stage.width, y: p.y * stage.height }));
    expect(px[0]!.x).toBeCloseTo(-320);
    expect(px[1]!.x).toBeCloseTo(0);
    expect(px[2]!.x).toBeCloseTo(320);
    expect(px[3]!.y).toBeLessThan(px[0]!.y);
    expect(px[0]!.y).toBeCloseTo(600 / 2 - (24 + 100));
  });

  it('menghitung tinggi panggung sesuai jumlah baris', () => {
    expect(gridHeight(1000, [card, card, card, card, card], GRID)).toBe(24 * 2 + 2 * 200 + 20);
    expect(gridHeight(400, [card, card], GRID)).toBe(24 * 2 + 2 * 200 + 20);
  });

  it('menjaga kartu tetap di dalam panggung', () => {
    const stage = { width: 1000, height: 600 };
    const px = clampToStage({ x: 2, y: -2 }, stage, card);
    expect(px.x).toBe(1000 / 2 - 150 - 8);
    expect(px.y).toBe(-(600 / 2 - 100 - 8));
  });

  it('mengembalikan daftar kosong tanpa kartu', () => {
    expect(gridLayout({ width: 800, height: 600 }, [], GRID)).toEqual([]);
  });
});
