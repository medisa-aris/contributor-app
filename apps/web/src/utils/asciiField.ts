/**
 * Medan ASCII animasi untuk latar panggung kartu: pola "benua" yang bergerak pelan
 * ditambah riak air dari posisi kursor.
 */

/** Dari kosong ke padat; indeks 0 berarti sel tidak digambar. */
export const ASCII_RAMP = [' ', '.', ',', ':', ';', '+', '=', 'x', 'X'] as const;

export interface Ripple {
  x: number;
  y: number;
  /** Waktu mulai dalam detik (jam animasi yang sama dengan `t`). */
  start: number;
}

export const RIPPLE_SPEED = 240; // px per detik
export const RIPPLE_LIFETIME = 2.6; // detik
const RIPPLE_WIDTH = 46; // lebar cincin gelombang (px)
const RIPPLE_WAVELENGTH = 0.11; // frekuensi spasial osilasi di dalam cincin

/** Pola dasar yang bergerak pelan, 0..1. */
export function baseIntensity(x: number, y: number, t: number): number {
  const a = Math.sin(x * 0.012 + t * 0.22) * Math.cos(y * 0.017 - t * 0.17);
  const b = Math.sin((x + y) * 0.008 - t * 0.12) * 0.6;
  const c = Math.cos(x * 0.031 - y * 0.009 + t * 0.3) * 0.25;
  const v = (a + b + c) / 1.85; // kira-kira -1..1
  // Ambang agar sebagian area kosong seperti peta.
  return Math.max(0, Math.min(1, (v + 0.15) * 1.1));
}

/** Kontribusi satu riak di titik (x, y) pada waktu t, 0..1. */
export function rippleIntensity(x: number, y: number, t: number, ripple: Ripple): number {
  const age = t - ripple.start;
  if (age < 0 || age > RIPPLE_LIFETIME) return 0;
  const distance = Math.hypot(x - ripple.x, y - ripple.y);
  const radius = age * RIPPLE_SPEED;
  const offset = distance - radius;
  const ring = Math.exp(-(offset * offset) / (2 * RIPPLE_WIDTH * RIPPLE_WIDTH));
  const fade = Math.exp(-age * 1.4);
  return Math.abs(Math.cos(offset * RIPPLE_WAVELENGTH)) * ring * fade;
}

export function fieldIntensity(
  x: number,
  y: number,
  t: number,
  ripples: readonly Ripple[],
): number {
  let v = baseIntensity(x, y, t);
  for (const ripple of ripples) v += rippleIntensity(x, y, t, ripple) * 0.9;
  return Math.min(1, v);
}

/** Indeks karakter pada ASCII_RAMP untuk intensitas 0..1. */
export function rampIndex(v: number): number {
  const clamped = Math.max(0, Math.min(1, v));
  return Math.round(clamped * (ASCII_RAMP.length - 1));
}

/** Buang riak yang sudah habis umurnya. */
export function liveRipples(ripples: readonly Ripple[], t: number): Ripple[] {
  return ripples.filter((r) => t - r.start <= RIPPLE_LIFETIME);
}
