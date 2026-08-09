import { describe, expect, it } from 'vitest';
import { areaPath, barPath, linePath, runs } from './shape';

/** How many separate subpaths a `d` string contains. */
const moves = (d: string) => (d.match(/M/g) ?? []).length;

describe('runs', () => {
  it('splits on every hole', () => {
    const r = runs([
      { x: 0, y: 1 },
      { x: 1, y: null },
      { x: 2, y: 3 },
      { x: 3, y: 4 },
    ]);
    expect(r.map((run) => run.length)).toEqual([1, 2]);
  });

  it('is empty when nothing can be drawn', () => {
    expect(runs([{ x: 0, y: null }])).toEqual([]);
    expect(runs([])).toEqual([]);
  });
});

describe('linePath', () => {
  it('draws one subpath through contiguous points', () => {
    const d = linePath([
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: 5 },
    ]);
    expect(d).toBe('M0,10L10,20L20,5');
    expect(moves(d)).toBe(1);
  });

  it('breaks rather than interpolating across a hole', () => {
    const d = linePath([
      { x: 0, y: 10 },
      { x: 10, y: null },
      { x: 20, y: 5 },
      { x: 30, y: 6 },
    ]);
    expect(moves(d)).toBe(2);
    expect(d).toBe('M0,10L0,10M20,5L30,6');
  });

  it('keeps a lone point visible', () => {
    expect(linePath([{ x: 4, y: 8 }])).toBe('M4,8L4,8');
  });

  it('rounds to two decimals', () => {
    expect(
      linePath([
        { x: 1 / 3, y: 2 / 3 },
        { x: 1, y: 2 },
      ]),
    ).toBe('M0.33,0.67L1,2');
  });

  it('is empty when every point is a hole', () => {
    expect(linePath([{ x: 0, y: null }])).toBe('');
  });
});

describe('areaPath', () => {
  it('closes each run down to the baseline', () => {
    const d = areaPath(
      [
        { x: 0, y: 10 },
        { x: 10, y: 20 },
      ],
      100,
    );
    expect(d).toBe('M0,100L0,10L10,20L10,100Z');
  });

  it('drops a run too short to read as area', () => {
    const d = areaPath(
      [
        { x: 0, y: 10 },
        { x: 10, y: null },
        { x: 20, y: 5 },
        { x: 30, y: 6 },
      ],
      100,
    );
    expect(moves(d)).toBe(1);
    expect(d.startsWith('M20,100')).toBe(true);
  });
});

describe('barPath', () => {
  it('rounds the top of a bar that grows up', () => {
    // SVG y grows downwards, so a value above the baseline is a smaller y.
    const d = barPath(0, 300, 100, 20, 4);
    expect(d).toBe(
      'M0,300L0,104A4,4 0 0 1 4,100L16,100A4,4 0 0 1 20,104L20,300Z',
    );
  });

  it('rounds the bottom of a bar that grows down', () => {
    // The rounded corner is always the one the data reached.
    const d = barPath(0, 100, 300, 20, 4);
    expect(d).toBe(
      'M0,100L0,296A4,4 0 0 0 4,300L16,300A4,4 0 0 0 20,296L20,100Z',
    );
  });

  it('clamps the radius on a bar shorter than it', () => {
    // Unclamped, the two arcs would overshoot and cross into a bow tie.
    const d = barPath(0, 300, 298, 20, 4);
    expect(d).toContain('A2,2');
    expect(d).not.toContain('A4,4');
  });

  it('clamps the radius on a bar narrower than twice it', () => {
    const d = barPath(0, 300, 100, 5, 4);
    expect(d).toContain('A2.5,2.5');
  });

  it('degrades to a line when there is nothing to draw', () => {
    expect(barPath(0, 300, 300, 20, 4)).toBe('M0,300L20,300');
    expect(barPath(0, 300, 100, 0, 4)).toBe('M0,300L0,300');
  });
});
