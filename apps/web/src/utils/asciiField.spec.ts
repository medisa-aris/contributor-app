import { describe, expect, it } from 'vitest';
import {
  ASCII_RAMP,
  RIPPLE_LIFETIME,
  RIPPLE_SPEED,
  baseIntensity,
  fieldIntensity,
  liveRipples,
  rampIndex,
  rippleIntensity,
} from './asciiField';

describe('asciiField', () => {
  it('intensitas dasar selalu di rentang 0..1', () => {
    for (let i = 0; i < 200; i += 1) {
      const v = baseIntensity(i * 13.7, i * 7.3, i * 0.1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('riak paling kuat di muka gelombang dan hilang setelah umurnya habis', () => {
    const ripple = { x: 0, y: 0, start: 0 };
    const t = 0.5;
    const front = RIPPLE_SPEED * t;
    expect(rippleIntensity(front, 0, t, ripple)).toBeGreaterThan(
      rippleIntensity(front + 200, 0, t, ripple),
    );
    expect(rippleIntensity(front, 0, RIPPLE_LIFETIME + 0.1, ripple)).toBe(0);
    expect(rippleIntensity(0, 0, -1, ripple)).toBe(0);
  });

  it('riak menambah intensitas medan', () => {
    const ripple = { x: 100, y: 100, start: 0 };
    const t = 0.2;
    const x = 100 + RIPPLE_SPEED * t;
    expect(fieldIntensity(x, 100, t, [ripple])).toBeGreaterThanOrEqual(baseIntensity(x, 100, t));
  });

  it('memetakan intensitas ke karakter dari kosong ke padat', () => {
    expect(ASCII_RAMP[rampIndex(0)]).toBe(' ');
    expect(ASCII_RAMP[rampIndex(1)]).toBe('X');
    expect(rampIndex(-5)).toBe(0);
    expect(rampIndex(5)).toBe(ASCII_RAMP.length - 1);
  });

  it('membuang riak yang kedaluwarsa', () => {
    const ripples = [
      { x: 0, y: 0, start: 0 },
      { x: 0, y: 0, start: 5 },
    ];
    expect(liveRipples(ripples, 5.5)).toEqual([{ x: 0, y: 0, start: 5 }]);
  });
});
