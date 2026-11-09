/**
 * Tata letak kartu di panggung three.js (kamera ortografis, 1 unit = 1 px).
 * Posisi disimpan ternormalisasi terhadap ukuran panggung (-0.5..0.5, titik pusat kartu)
 * agar tetap proporsional saat panggung berubah ukuran.
 */

export interface StageSize {
  width: number;
  height: number;
}

export interface CardSize {
  width: number;
  height: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface GridOptions {
  gap: number;
  padding: number;
}

/** Posisi awal: grid rata tengah dari atas, baris setinggi kartu tertinggi. */
export function gridLayout(
  stage: StageSize,
  cards: CardSize[],
  { gap, padding }: GridOptions,
): NormalizedPoint[] {
  if (cards.length === 0) return [];
  const cardWidth = Math.max(...cards.map((c) => c.width));
  const rowHeight = Math.max(...cards.map((c) => c.height));
  const usable = Math.max(stage.width - padding * 2, cardWidth);
  const columns = Math.max(
    1,
    Math.min(cards.length, Math.floor((usable + gap) / (cardWidth + gap))),
  );
  const rowWidth = columns * cardWidth + (columns - 1) * gap;
  const startLeft = (stage.width - rowWidth) / 2;

  return cards.map((card, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = startLeft + column * (cardWidth + gap);
    const top = padding + row * (rowHeight + gap);
    const centerX = left + cardWidth / 2 - stage.width / 2;
    const centerY = stage.height / 2 - (top + card.height / 2);
    return { x: centerX / stage.width, y: centerY / stage.height };
  });
}

/** Tinggi panggung minimal agar seluruh baris grid muat. */
export function gridHeight(
  stageWidth: number,
  cards: CardSize[],
  { gap, padding }: GridOptions,
): number {
  if (cards.length === 0) return padding * 2;
  const cardWidth = Math.max(...cards.map((c) => c.width));
  const rowHeight = Math.max(...cards.map((c) => c.height));
  const usable = Math.max(stageWidth - padding * 2, cardWidth);
  const columns = Math.max(
    1,
    Math.min(cards.length, Math.floor((usable + gap) / (cardWidth + gap))),
  );
  const rows = Math.ceil(cards.length / columns);
  return padding * 2 + rows * rowHeight + (rows - 1) * gap;
}

/** Ubah posisi ternormalisasi menjadi piksel dan jaga kartu tetap di dalam panggung. */
export function clampToStage(
  point: NormalizedPoint,
  stage: StageSize,
  card: CardSize,
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(0, stage.width / 2 - card.width / 2 - margin);
  const maxY = Math.max(0, stage.height / 2 - card.height / 2 - margin);
  return {
    x: Math.min(maxX, Math.max(-maxX, point.x * stage.width)),
    y: Math.min(maxY, Math.max(-maxY, point.y * stage.height)),
  };
}
