<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  ASCII_RAMP,
  fieldIntensity,
  liveRipples,
  rampIndex,
  type Ripple,
} from '@/utils/asciiField';

/**
 * Latar animasi karakter ASCII abu-abu lembut; kursor yang bergerak di atas
 * elemen induk memunculkan riak seperti air. Kanvas tidak menerima klik.
 */

const CELL_W = 10;
const CELL_H = 15;
const FONT_SIZE = 12;
const MAX_RIPPLES = 14;
const SPAWN_INTERVAL = 0.09; // detik
const SPAWN_DISTANCE = 28; // px

const canvasRef = ref<HTMLCanvasElement | null>(null);

let ctx: CanvasRenderingContext2D | null = null;
let host: HTMLElement | null = null;
let frame = 0;
let width = 0;
let height = 0;
let ripples: Ripple[] = [];
let lastSpawn = { t: -1, x: 0, y: 0 };
let visible = true;
let reducedMotion = false;
let rgb = '128, 128, 128';
const startedAt = performance.now();

let resizeObserver: ResizeObserver | null = null;
let intersectionObserver: IntersectionObserver | null = null;
let themeObserver: MutationObserver | null = null;
let motionMedia: MediaQueryList | null = null;
let schemeMedia: MediaQueryList | null = null;

function now(): number {
  return (performance.now() - startedAt) / 1000;
}

/** Warna dasar dari token tema (--ca-fg-3), dipakai dengan alfa berbeda per tingkat. */
function readColor(): void {
  const probe = document.createElement('span');
  probe.style.color = 'var(--ca-fg-3)';
  probe.style.display = 'none';
  host?.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  const match = value.match(/\d+(\.\d+)?/g);
  if (match && match.length >= 3) rgb = `${match[0]}, ${match[1]}, ${match[2]}`;
}

function resize(): void {
  const canvas = canvasRef.value;
  if (!canvas || !host) return;
  const dpr = window.devicePixelRatio || 1;
  width = host.clientWidth;
  height = host.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(now());
}

function draw(t: number): void {
  if (!ctx || width === 0 || height === 0) return;
  ripples = liveRipples(ripples, t);
  ctx.clearRect(0, 0, width, height);
  ctx.font = `${FONT_SIZE}px ui-monospace, "Cascadia Code", Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Kelompokkan sel per tingkat agar fillStyle hanya diganti sekali per tingkat.
  const buckets: number[][] = ASCII_RAMP.map(() => []);
  const cols = Math.ceil(width / CELL_W);
  const rows = Math.ceil(height / CELL_H);
  for (let row = 0; row < rows; row += 1) {
    const y = row * CELL_H + CELL_H / 2;
    for (let col = 0; col < cols; col += 1) {
      const x = col * CELL_W + CELL_W / 2;
      const level = rampIndex(fieldIntensity(x, y, t, ripples));
      if (level > 0) buckets[level]!.push(x, y);
    }
  }
  for (let level = 1; level < ASCII_RAMP.length; level += 1) {
    const points = buckets[level]!;
    if (points.length === 0) continue;
    const alpha = 0.16 + (level / (ASCII_RAMP.length - 1)) * 0.5;
    ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
    const char = ASCII_RAMP[level]!;
    for (let i = 0; i < points.length; i += 2) ctx.fillText(char, points[i]!, points[i + 1]!);
  }
}

function loop(): void {
  frame = 0;
  if (!visible || document.hidden) return;
  draw(now());
  // Saat gerak dikurangi, tetap gambar riak sampai habis lalu berhenti.
  if (!reducedMotion || ripples.length > 0) frame = requestAnimationFrame(loop);
}

function start(): void {
  if (frame === 0) frame = requestAnimationFrame(loop);
}

function stop(): void {
  if (frame !== 0) cancelAnimationFrame(frame);
  frame = 0;
}

function onPointerMove(event: PointerEvent): void {
  if (!host) return;
  const rect = host.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const t = now();
  const moved = Math.hypot(x - lastSpawn.x, y - lastSpawn.y);
  if (t - lastSpawn.t < SPAWN_INTERVAL && moved < SPAWN_DISTANCE) return;
  lastSpawn = { t, x, y };
  ripples.push({ x, y, start: t });
  if (ripples.length > MAX_RIPPLES) ripples.shift();
  start();
}

function onVisibility(): void {
  if (document.hidden) stop();
  else start();
}

function onMotionChange(): void {
  reducedMotion = motionMedia?.matches ?? false;
  stop();
  if (reducedMotion) draw(now());
  else start();
}

onMounted(() => {
  host = canvasRef.value?.parentElement ?? null;
  if (!host) return;
  motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = motionMedia.matches;
  motionMedia.addEventListener('change', onMotionChange);
  schemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  schemeMedia.addEventListener('change', readColor);
  themeObserver = new MutationObserver(readColor);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  readColor();

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    if (visible) start();
    else stop();
  });
  intersectionObserver.observe(host);
  host.addEventListener('pointermove', onPointerMove);
  document.addEventListener('visibilitychange', onVisibility);
  resize();
  start();
});

onBeforeUnmount(() => {
  stop();
  host?.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('visibilitychange', onVisibility);
  motionMedia?.removeEventListener('change', onMotionChange);
  schemeMedia?.removeEventListener('change', readColor);
  themeObserver?.disconnect();
  resizeObserver?.disconnect();
  intersectionObserver?.disconnect();
});
</script>

<template>
  <canvas ref="canvasRef" class="ascii-ripple" aria-hidden="true" />
</template>

<style scoped>
.ascii-ripple {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
