import { describe, expect, it } from 'vitest';
import {
  bandScale,
  linearScale,
  niceDomain,
  tickDecimals,
  tickStep,
} from './scale';

describe('tickStep', () => {
  it('lands on 1, 2, 5 times a power of ten', () => {
    expect(tickStep(1000, 5)).toBe(200);
    expect(tickStep(100, 5)).toBe(20);
    expect(tickStep(50, 5)).toBe(10);
    expect(tickStep(0.07, 5)).toBe(0.01);
    expect(tickStep(0.08, 5)).toBe(0.02);
  });

  it('picks the multiplier by ratio, not by arithmetic distance', () => {
    // A rough step of 3 is equidistant from 2 and 5 on a number line, but
    // proportionally closer to 5 — the geometric midpoint is √10 ≈ 3.16.
    expect(tickStep(3 * 5, 5)).toBe(2);
    expect(tickStep(3.5 * 5, 5)).toBe(5);
    expect(tickStep(7.5 * 5, 5)).toBe(10);
    expect(tickStep(1.5 * 5, 5)).toBe(2);
    expect(tickStep(1.3 * 5, 5)).toBe(1);
  });

  it('answers something usable for a degenerate span', () => {
    expect(tickStep(0, 5)).toBe(1);
    expect(tickStep(-10, 5)).toBe(1);
    expect(tickStep(NaN, 5)).toBe(1);
    expect(tickStep(Infinity, 5)).toBe(1);
    expect(tickStep(100, 0)).toBe(1);
  });
});

describe('tickDecimals', () => {
  it('counts what the step needs', () => {
    expect(tickDecimals(200)).toBe(0);
    expect(tickDecimals(1)).toBe(0);
    expect(tickDecimals(0.5)).toBe(1);
    expect(tickDecimals(0.02)).toBe(2);
    expect(tickDecimals(0)).toBe(0);
  });
});

describe('niceDomain', () => {
  it('rounds out to whole steps', () => {
    expect(niceDomain([3, 97], 5)).toEqual([0, 100]);
    expect(niceDomain([0.3, 4.2], 5)).toEqual([0, 5]);
  });

  it('gives a flat series an axis to sit in', () => {
    expect(niceDomain([0, 0], 5)).toEqual([-1, 1]);
    // 42 widens to [21, 63], which nices out to [20, 70].
    const [lo, hi] = niceDomain([42, 42], 5);
    expect(lo).toBeLessThan(42);
    expect(hi).toBeGreaterThan(42);
  });

  it('swaps a reversed domain', () => {
    expect(niceDomain([97, 3], 5)).toEqual(niceDomain([3, 97], 5));
  });

  it('falls back for a domain with nothing finite in it', () => {
    expect(niceDomain([NaN, NaN], 5)).toEqual([0, 1]);
    expect(niceDomain([Infinity, -Infinity], 5)).toEqual([0, 1]);
  });

  it('straddles zero when the data does', () => {
    // The mortgage case: a negative series pulls the axis below the baseline.
    const [lo, hi] = niceDomain([-180_000, 640_000], 5);
    expect(lo).toBeLessThanOrEqual(-180_000);
    expect(hi).toBeGreaterThanOrEqual(640_000);
    expect(lo).toBeLessThan(0);
  });
});

describe('linearScale', () => {
  const s = linearScale({ domain: [0, 100], range: [0, 400] });

  it('maps the domain across the range', () => {
    expect(s.at(0)).toBe(0);
    expect(s.at(50)).toBe(200);
    expect(s.at(100)).toBe(400);
  });

  it('round-trips through invert', () => {
    for (const v of [0, 12.5, 33, 100]) {
      expect(s.invert(s.at(v))).toBeCloseTo(v, 10);
    }
  });

  it('handles an inverted range, which is how a value axis points up', () => {
    const y = linearScale({ domain: [0, 100], range: [300, 0] });
    expect(y.at(0)).toBe(300);
    expect(y.at(100)).toBe(0);
    expect(y.invert(300)).toBeCloseTo(0, 10);
  });

  it('produces ticks with no float noise in them', () => {
    const t = linearScale({ domain: [0, 1], range: [0, 100] }).ticks(5);
    expect(t.ticks.map((x) => x.value)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(t.decimals).toBe(1);
  });

  it('positions each tick through its own mapping', () => {
    const t = linearScale({ domain: [0, 100], range: [0, 400] }).ticks(5);
    expect(t.ticks[0]).toEqual({ value: 0, pos: 0 });
    expect(t.ticks.at(-1)).toEqual({ value: 100, pos: 400 });
  });

  it('survives a domain of nothing', () => {
    const flat = linearScale({ domain: [7, 7], range: [0, 100] });
    expect(Number.isFinite(flat.at(7))).toBe(true);
    expect(flat.ticks(5).ticks.length).toBeGreaterThan(0);
  });

  it('leaves the domain alone when asked not to nice it', () => {
    const raw = linearScale({ domain: [3, 97], range: [0, 100], nice: false });
    expect(raw.domain).toEqual([3, 97]);
  });
});

describe('bandScale', () => {
  const n = 4;

  it('divides the range evenly and leaves the padding as air', () => {
    const b = bandScale({ count: n, range: [0, 400], padding: 0.2 });
    expect(b.step()).toBe(100);
    expect(b.bandwidth()).toBe(80);
    expect(b.start(0)).toBe(10);
    expect(b.at(0)).toBe(50);
    expect(b.at(3)).toBe(350);
  });

  it('fills the step when there is no padding', () => {
    const b = bandScale({ count: n, range: [0, 400], padding: 0 });
    expect(b.bandwidth()).toBe(100);
    expect(b.start(0)).toBe(0);
    expect(b.at(0)).toBe(50);
  });

  it('collapses to centred points for a line mark', () => {
    const b = bandScale({ count: n, range: [0, 400], point: true });
    expect(b.bandwidth()).toBe(0);
    expect(b.at(0)).toBe(50);
    expect(b.at(3)).toBe(350);
  });

  it('inverts to a fractional index that rounds to the right band', () => {
    const b = bandScale({ count: n, range: [0, 400] });
    expect(Math.round(b.invert(50))).toBe(0);
    expect(Math.round(b.invert(99))).toBe(0);
    expect(Math.round(b.invert(101))).toBe(1);
    expect(Math.round(b.invert(350))).toBe(3);
  });

  it('does not divide by zero when there is nothing to show', () => {
    const b = bandScale({ count: 0, range: [0, 400] });
    expect(b.step()).toBe(0);
    expect(b.at(0)).toBe(0);
    expect(b.invert(200)).toBe(0);
    expect(b.ticks().ticks).toEqual([]);
  });

  it('ticks once per band', () => {
    const t = bandScale({ count: n, range: [0, 400] }).ticks();
    expect(t.ticks.map((x) => x.value)).toEqual([0, 1, 2, 3]);
    expect(t.decimals).toBe(0);
  });
});
