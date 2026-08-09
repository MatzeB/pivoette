import { describe, expect, it } from 'vitest';
import { fromRows } from '../data/import';
import { unitLabels } from '../data/meta';
import type { ColumnMetaInput } from '../data/meta';
import { buildGraphData, nearestIndex } from './series';

type Row = Record<string, unknown>;

const frameOf = (rows: Row[], meta?: Record<string, ColumnMetaInput>) =>
  fromRows(rows, meta);

/** Two accounts over three months, one of them arriving late. */
const MONTHLY: Row[] = [
  { month: '2026-01-01T00:00:00Z', account: 'Checking', balance: 1000 },
  { month: '2026-02-01T00:00:00Z', account: 'Checking', balance: 1100 },
  { month: '2026-03-01T00:00:00Z', account: 'Checking', balance: 1200 },
  { month: '2026-02-01T00:00:00Z', account: 'Brokerage', balance: 5000 },
  { month: '2026-03-01T00:00:00Z', account: 'Brokerage', balance: 5300 },
];
const MONTHLY_META: Record<string, ColumnMetaInput> = {
  month: { encoding: 'rfc3339' },
  balance: { kind: 'price', unit: 'dollar', displayName: 'Balance' },
};

describe('field combinations', () => {
  it('rejects several y fields alongside a series field', () => {
    expect(() =>
      buildGraphData(frameOf(MONTHLY, MONTHLY_META), {
        x: 'month',
        y: ['balance', 'balance'],
        series: 'account',
      }),
    ).toThrow(/not both/);
  });

  it('accepts a single-element y array next to a series field', () => {
    const data = buildGraphData(frameOf(MONTHLY, MONTHLY_META), {
      x: 'month',
      y: ['balance'],
      series: 'account',
    });
    expect(data.series.map((s) => s.key)).toEqual(['Brokerage', 'Checking']);
  });

  it('gives one series per measure when there is no series field', () => {
    const rows: Row[] = [
      { m: 1, a: 10, b: 20 },
      { m: 2, a: 11, b: 21 },
    ];
    const data = buildGraphData(frameOf(rows), { x: 'm', y: ['a', 'b'] });
    expect(data.series.map((s) => s.key)).toEqual(['a', 'b']);
    expect(data.series[1]!.points.map((p) => p.y)).toEqual([20, 21]);
  });

  it('refuses an empty measure list', () => {
    expect(() =>
      buildGraphData(frameOf(MONTHLY), { x: 'month', y: [] }),
    ).toThrow(/at least one/);
  });
});

describe('x decoding', () => {
  it('reads a declared timestamp as epoch millis on a time axis', () => {
    const data = buildGraphData(frameOf(MONTHLY, MONTHLY_META), {
      x: 'month',
      y: 'balance',
      series: 'account',
    });
    expect(data.xKind).toBe('time');
    expect(data.xs).toEqual([
      Date.parse('2026-01-01T00:00:00Z'),
      Date.parse('2026-02-01T00:00:00Z'),
      Date.parse('2026-03-01T00:00:00Z'),
    ]);
  });

  it('reads a numeric column on a linear axis, ascending', () => {
    const rows: Row[] = [
      { m: 3, v: 1 },
      { m: 1, v: 2 },
      { m: 2, v: 3 },
    ];
    const data = buildGraphData(frameOf(rows), { x: 'm', y: 'v' });
    expect(data.xKind).toBe('linear');
    expect(data.xs).toEqual([1, 2, 3]);
  });

  it('reads anything else as sorted bands', () => {
    const rows: Row[] = [
      { g: 'c', v: 1 },
      { g: 'a', v: 2 },
      { g: 'b', v: 3 },
    ];
    const data = buildGraphData(frameOf(rows), { x: 'g', y: 'v' });
    expect(data.xKind).toBe('band');
    expect(data.categories).toEqual(['a', 'b', 'c']);
    expect(data.xs).toEqual([0, 1, 2]);
    // Values follow their category, not their row order.
    expect(data.series[0]!.points.map((p) => p.y)).toEqual([2, 3, 1]);
  });

  it('drops a row whose x cannot be placed', () => {
    const rows: Row[] = [
      { m: 1, v: 10 },
      { m: null, v: 999 },
      { m: 2, v: 20 },
    ];
    const data = buildGraphData(frameOf(rows), { x: 'm', y: 'v' });
    expect(data.xs).toEqual([1, 2]);
    expect(data.series[0]!.points.map((p) => p.y)).toEqual([10, 20]);
  });
});

describe('grouping and gaps', () => {
  const data = buildGraphData(frameOf(MONTHLY, MONTHLY_META), {
    x: 'month',
    y: 'balance',
    series: 'account',
  });

  it('aligns every series to the shared x index', () => {
    for (const s of data.series) {
      expect(s.points.map((p) => p.x)).toEqual(data.xs);
    }
  });

  it('leaves a hole where a series has no data', () => {
    // Values are in display units: these dollars chose the $k rung.
    const brokerage = data.series.find((s) => s.key === 'Brokerage')!;
    expect(brokerage.points.map((p) => p.y)).toEqual([null, 5, 5.3]);
  });

  it('aggregates the rows falling in one cell', () => {
    const rows: Row[] = [
      { g: 'a', v: 1 },
      { g: 'a', v: 2 },
      { g: 'b', v: 4 },
    ];
    expect(
      buildGraphData(frameOf(rows), {
        x: 'g',
        y: 'v',
        agg: 'sum',
      }).series[0]!.points.map((p) => p.y),
    ).toEqual([3, 4]);
    expect(
      buildGraphData(frameOf(rows), {
        x: 'g',
        y: 'v',
        agg: 'mean',
      }).series[0]!.points.map((p) => p.y),
    ).toEqual([1.5, 4]);
  });

  it('does not let sum turn a group of nulls into a zero', () => {
    // `sum([])` is 0, which would draw a line along the baseline where there
    // is in fact no data at all.
    const rows: Row[] = [
      { g: 'a', v: 5 },
      { g: 'b', v: null },
    ];
    const data = buildGraphData(frameOf(rows), { x: 'g', y: 'v', agg: 'sum' });
    expect(data.series[0]!.points.map((p) => p.y)).toEqual([5, null]);
  });

  it('carries the raw x through for readouts', () => {
    expect(data.series[0]!.points[0]!.raw).toBe('2026-01-01T00:00:00Z');
  });

  it('reports the extent in display units, matching the points', () => {
    expect(data.yExtent).toEqual([1, 5.3]);
  });
});

describe('the shared ladder step', () => {
  const big: Row[] = [
    { m: 1, assets: 120_000, debt: -40_000 },
    { m: 2, assets: 480_000, debt: -35_000 },
    { m: 3, assets: 910_000, debt: -30_000 },
  ];
  const money: ColumnMetaInput = { kind: 'price', unit: 'dollar' };

  it('puts both series on one rung and one factor', () => {
    const data = buildGraphData(frameOf(big, { assets: money, debt: money }), {
      x: 'm',
      y: ['assets', 'debt'],
    });
    expect(data.yMeta.scale).toEqual(['kilo']);
    expect(unitLabels(data.yMeta).full).toBe('$k');
    expect(data.yFactor).toBe(0.001);
    // Both series report the same unit, each keeping its own name.
    for (const s of data.series) expect(unitLabels(s.meta).full).toBe('$k');
  });

  it('converts the plotted values into the chosen unit', () => {
    const data = buildGraphData(frameOf(big, { assets: money, debt: money }), {
      x: 'm',
      y: ['assets', 'debt'],
    });
    expect(data.series[0]!.points.map((p) => p.y)).toEqual([120, 480, 910]);
    expect(data.yExtent).toEqual([-40, 910]);
  });

  it('leaves the axis alone when the measures disagree about their unit', () => {
    const data = buildGraphData(
      frameOf(big, { assets: money, debt: { kind: 'count' } }),
      { x: 'm', y: ['assets', 'debt'] },
    );
    expect(data.yFactor).toBe(1);
    // Unrescaled and unrelabelled: dollars are still dollars.
    expect(unitLabels(data.yMeta).full).toBe('$');
    expect(data.series[0]!.points.map((p) => p.y)).toEqual([
      120_000, 480_000, 910_000,
    ]);
  });

  it('chooses the rung from the aggregated values, not the raw column', () => {
    // Each row is a few hundred dollars; summed by month they are tens of
    // thousands, and only the sums are on screen.
    const rows: Row[] = [];
    for (let m = 1; m <= 3; m++) {
      for (let i = 0; i < 100; i++) rows.push({ m, v: 300 });
    }
    const data = buildGraphData(frameOf(rows, { v: money }), {
      x: 'm',
      y: 'v',
    });
    expect(data.yMeta.scale).toEqual(['kilo']);
    expect(data.series[0]!.points[0]!.y).toBe(30);
  });
});

describe('nearestIndex', () => {
  const xs = [0, 10, 20, 30];

  it('finds the nearest on either side', () => {
    expect(nearestIndex(xs, 11)).toBe(1);
    expect(nearestIndex(xs, 19)).toBe(2);
  });

  it('clamps past both ends', () => {
    expect(nearestIndex(xs, -100)).toBe(0);
    expect(nearestIndex(xs, 100)).toBe(3);
  });

  it('breaks an exact tie towards the lower index', () => {
    // So sweeping left and right across a midpoint agree about where it is.
    expect(nearestIndex(xs, 15)).toBe(1);
  });

  it('handles the degenerate lengths', () => {
    expect(nearestIndex([], 5)).toBe(-1);
    expect(nearestIndex([7], 5)).toBe(0);
    expect(nearestIndex(xs, 0)).toBe(0);
    expect(nearestIndex(xs, 30)).toBe(3);
  });
});
