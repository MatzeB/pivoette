import { describe, expect, it } from 'vitest';
import { fromRows } from '../data/import';
import { computeView } from './engine';
import type { ViewResult } from './result';
import type { PivotSpec, TableSpec } from './spec';

/** Find a leaf index whose colPath equals the given path. */
function leafAt(result: ViewResult, path: string[]): number {
  return result.leaves.findIndex(
    (l) =>
      l.colPath.length === path.length &&
      l.colPath.every((s, i) => s === path[i]),
  );
}

function rowByPath(result: ViewResult, path: unknown[]) {
  return result.rows.find(
    (r) =>
      r.path.length === path.length && r.path.every((v, i) => v === path[i]),
  )!;
}

describe('computePivot — multi-level columns & measures', () => {
  const frame = fromRows([
    { r: 'A', c: 'x', v: 1 },
    { r: 'A', c: 'x', v: 3 },
    { r: 'A', c: 'y', v: 10 },
    { r: 'B', c: 'x', v: 5 },
  ]);
  const spec: PivotSpec = {
    rows: ['r'],
    columns: ['c'],
    values: [
      { id: 'sum', field: 'v', agg: 'sum', label: 'sum' },
      { id: 'mean', field: 'v', agg: 'mean', label: 'mean' },
    ],
  };

  it('builds a 2-level column header and correct cells', () => {
    const res = computeView(frame, spec);
    expect(res.columnHeaderDepth).toBe(2);
    const A = rowByPath(res, ['A']);
    expect(A.cells[leafAt(res, ['x', 'sum'])]!.value).toBe(4);
    expect(A.cells[leafAt(res, ['x', 'mean'])]!.value).toBe(2);
    expect(A.cells[leafAt(res, ['y', 'sum'])]!.value).toBe(10);
    const B = rowByPath(res, ['B']);
    expect(B.cells[leafAt(res, ['y', 'sum'])]!.value).toBeNull(); // empty group
  });

  it('places measures on rows when configured', () => {
    const res = computeView(frame, {
      ...spec,
      valuePlacement: { axis: 'rows' },
    });
    expect(res.rowLevels).toEqual(['r', 'Measure']);
    // leaves are just the column keys now
    expect(res.leaves.map((l) => l.colPath[0])).toEqual(['x', 'y']);
    const aSum = rowByPath(res, ['A', 'sum']);
    expect(aSum.cells[leafAt(res, ['x'])]!.value).toBe(4);
    expect(aSum.cells[leafAt(res, ['y'])]!.value).toBe(10);
  });
});

describe('summary footer is computed from source', () => {
  it('grand-total mean ≠ mean of group means for unequal group sizes', () => {
    const frame = fromRows([
      { r: 'A', c: 'x', v: 1 },
      { r: 'A', c: 'x', v: 3 },
      { r: 'B', c: 'x', v: 9 },
    ]);
    const res = computeView(frame, {
      rows: ['r'],
      columns: ['c'],
      values: [{ id: 'mean', field: 'v', agg: 'mean', label: 'mean' }],
      showSummary: true,
    });
    // group means: A/x = 2, B/x = 9 -> naive average 5.5
    // correct grand mean over [1,3,9] = 4.333...
    const cell = res.summary![leafAt(res, ['x'])]!;
    expect(cell.value).toBeCloseTo(13 / 3, 10);
    expect(cell.value).not.toBeCloseTo(5.5, 5);
  });
});

describe('flat mode — computed columns & composite sort', () => {
  const frame = fromRows([
    { img: 'i1', desc: 'Charlie', price: 12, base: 10 },
    { img: 'i2', desc: 'Alpha', price: 8, base: 10 },
    { img: 'i3', desc: 'Bravo', price: 15, base: 10 },
  ]);
  const spec: TableSpec = {
    mode: 'flat',
    columns: [
      {
        id: 'asset',
        composite: { fields: ['img', 'desc'], sortKey: 'desc' },
      },
      { id: 'pl', compute: 'price - base' },
    ],
    sort: [{ field: 'asset', direction: 'asc' }],
  };

  it('computes column values and sorts by the composite sort key', () => {
    const res = computeView(frame, spec);
    // sorted by description: Alpha, Bravo, Charlie
    expect(res.rows.map((r) => r.cells[0]!.inputs!.text)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    // pl for Alpha row = 8 - 10 = -2
    expect(res.rows[0]!.cells[1]!.value).toBe(-2);
    // composite cell carries its sort-key as the (sortable) value
    expect(res.rows[0]!.cells[0]!.value).toBe('Alpha');
  });
});

describe('per-group derived columns (before/after Δ%)', () => {
  const frame = fromRows([
    { app: 'P1', platform: 'Intel', revision: 'before', t: 100 },
    { app: 'P1', platform: 'Intel', revision: 'after', t: 80 },
    { app: 'P1', platform: 'AMD', revision: 'before', t: 200 },
    { app: 'P1', platform: 'AMD', revision: 'after', t: 220 },
  ]);
  const spec: PivotSpec = {
    rows: ['app'],
    columns: ['platform', 'revision'],
    values: [{ id: 'mean', field: 't', agg: 'mean', label: 'mean' }],
    computed: [
      {
        id: 'delta',
        label: 'Δ%',
        repeatPer: ['platform'],
        inputs: {
          before: { colPath: ['before'], value: 'mean' },
          after: { colPath: ['after'], value: 'mean' },
        },
        compute: 'before ? (after - before) / before : null',
        place: { after: 'after' },
      },
    ],
  };

  it('inserts a Δ% per platform referencing that platform’s own cells', () => {
    const res = computeView(frame, spec);
    expect(res.leaves.map((l) => l.colPath.join('/'))).toEqual([
      'Intel/before',
      'Intel/after',
      'Intel/Δ%',
      'AMD/before',
      'AMD/after',
      'AMD/Δ%',
    ]);
    const row = res.rows[0]!;
    expect(row.cells[leafAt(res, ['Intel', 'Δ%'])]!.value).toBeCloseTo(
      -0.2,
      10,
    );
    expect(row.cells[leafAt(res, ['AMD', 'Δ%'])]!.value).toBeCloseTo(0.1, 10);
  });
});

describe('row/column sorting', () => {
  const frame = fromRows([
    { r: 'B', c: 'y', v: 1 },
    { r: 'A', c: 'x', v: 2 },
    { r: 'B', c: 'x', v: 3 },
    { r: 'A', c: 'y', v: 4 },
  ]);
  const base: PivotSpec = {
    rows: ['r'],
    columns: ['c'],
    values: [{ id: 'sum', field: 'v', agg: 'sum', label: 'sum' }],
  };

  it('defaults to first-seen order', () => {
    const res = computeView(frame, base);
    expect(res.rows.map((r) => r.path[0])).toEqual(['B', 'A']);
    expect(res.leaves.map((l) => l.colPath[0])).toEqual(['y', 'x']);
  });

  it('applies rowSort and columnSort', () => {
    const res = computeView(frame, {
      ...base,
      rowSort: [{ field: 'r', direction: 'asc' }],
      columnSort: [{ field: 'c', direction: 'asc' }],
    });
    expect(res.rows.map((r) => r.path[0])).toEqual(['A', 'B']);
    expect(res.leaves.map((l) => l.colPath[0])).toEqual(['x', 'y']);
  });

  it('honors descending direction', () => {
    const res = computeView(frame, {
      ...base,
      rowSort: [{ field: 'r', direction: 'desc' }],
    });
    expect(res.rows.map((r) => r.path[0])).toEqual(['B', 'A']);
  });
});

describe('custom aggregation expression', () => {
  it('evaluates the expression over the group values array', () => {
    const frame = fromRows([
      { r: 'A', v: 1 },
      { r: 'A', v: 5 },
      { r: 'A', v: 3 },
    ]);
    const res = computeView(frame, {
      rows: ['r'],
      columns: [],
      values: [
        {
          id: 'range',
          field: 'v',
          agg: 'custom', // ignored when expression is present
          label: 'range',
          expression: 'Math.max(...values) - Math.min(...values)',
        },
      ],
    });
    expect(res.rows[0]!.cells[0]!.value).toBe(4);
  });
});

describe('includeMeasure header toggle', () => {
  const frame = fromRows([
    { r: 'A', c: 'x', v: 1 },
    { r: 'A', c: 'y', v: 2 },
  ]);

  it('single measure omits the measure level (depth 1)', () => {
    const res = computeView(frame, {
      rows: ['r'],
      columns: ['c'],
      values: [{ id: 'sum', field: 'v', agg: 'sum', label: 'sum' }],
    });
    expect(res.columnHeaderDepth).toBe(1);
    expect(res.leaves.every((l) => l.colPath.length === 1)).toBe(true);
  });

  it('multiple measures add the measure level (depth 2)', () => {
    const res = computeView(frame, {
      rows: ['r'],
      columns: ['c'],
      values: [
        { id: 'sum', field: 'v', agg: 'sum', label: 'sum' },
        { id: 'max', field: 'v', agg: 'max', label: 'max' },
      ],
    });
    expect(res.columnHeaderDepth).toBe(2);
    expect(res.leaves.every((l) => l.colPath.length === 2)).toBe(true);
  });
});

describe('derived column placement', () => {
  it('appends a global derived column at the end (place: append)', () => {
    const frame = fromRows([{ t: 'x', a: 2, b: 3 }]);
    const res = computeView(frame, {
      rows: ['t'],
      columns: [],
      values: [
        { id: 'a', field: 'a', agg: 'sum', label: 'A' },
        { id: 'b', field: 'b', agg: 'sum', label: 'B' },
      ],
      computed: [
        {
          id: 'total',
          label: 'Sum',
          inputs: {
            a: { colPath: [], value: 'a' },
            b: { colPath: [], value: 'b' },
          },
          compute: 'a + b',
          place: 'append',
        },
      ],
    });
    expect(res.leaves.map((l) => l.column.label)).toEqual(['A', 'B', 'Sum']);
    expect(res.rows[0]!.cells[leafAt(res, ['Sum'])]!.value).toBe(5);
  });

  it('repeatPer without place appends within each group', () => {
    const frame = fromRows([
      { app: 'P1', platform: 'Intel', revision: 'before', t: 100 },
      { app: 'P1', platform: 'Intel', revision: 'after', t: 50 },
      { app: 'P1', platform: 'AMD', revision: 'before', t: 200 },
      { app: 'P1', platform: 'AMD', revision: 'after', t: 100 },
    ]);
    const res = computeView(frame, {
      rows: ['app'],
      columns: ['platform', 'revision'],
      values: [{ id: 'mean', field: 't', agg: 'mean', label: 'mean' }],
      computed: [
        {
          id: 'delta',
          label: 'Δ%',
          repeatPer: ['platform'],
          inputs: {
            before: { colPath: ['before'], value: 'mean' },
            after: { colPath: ['after'], value: 'mean' },
          },
          compute: 'before ? (after - before) / before : null',
          // no `place` — falls back to appending after the group's last leaf
        },
      ],
    });
    expect(res.leaves.map((l) => l.colPath.join('/'))).toEqual([
      'Intel/before',
      'Intel/after',
      'Intel/Δ%',
      'AMD/before',
      'AMD/after',
      'AMD/Δ%',
    ]);
    expect(res.rows[0]!.cells[leafAt(res, ['AMD', 'Δ%'])]!.value).toBeCloseTo(
      -0.5,
      10,
    );
  });
});

describe('column metadata wiring', () => {
  const rows = [
    { host: 'a', image: 'a.png', desc: 'Alpha', latency: 1.5 },
    { host: 'b', image: 'b.png', desc: 'Beta', latency: 2.5 },
  ];
  const meta = {
    host: { displayName: 'Host' },
    latency: {
      displayName: 'Latency',
      siUnit: 'second',
      siScale: 'milli',
    },
  };

  it('exposes source metadata on flat leaves, incl. composite sources', () => {
    const frame = fromRows(rows, meta);
    const res = computeView(frame, {
      mode: 'flat',
      columns: [
        {
          id: 'asset',
          composite: { fields: ['image', 'desc'], sortKey: 'desc' },
        },
        { id: 'latency', source: 'latency' },
        { id: 'double', compute: 'latency * 2' },
      ],
    } satisfies TableSpec);

    const [asset, latency, double] = res.leaves;
    expect(latency!.column.meta!.displayName).toBe('Latency');
    expect(latency!.column.meta!.siUnitShort).toEqual(['s']);
    expect(asset!.column.sources!.map((m) => m.dataName)).toEqual([
      'image',
      'desc',
    ]);
    // A computed column has no source field, so no metadata.
    expect(double!.column.meta).toBeUndefined();
  });

  it('falls back to displayName for flat headers, letting labels win', () => {
    const frame = fromRows(rows, meta);
    const res = computeView(frame, {
      mode: 'flat',
      labels: { latency: 'Explicit' },
      columns: [
        { id: 'host', source: 'host' },
        { id: 'latency', source: 'latency' },
      ],
    } satisfies TableSpec);
    expect(res.leaves.map((l) => l.column.label)).toEqual(['Host', 'Explicit']);
  });

  it('exposes the aggregated field metadata on pivot measure leaves', () => {
    const frame = fromRows(rows, meta);
    const res = computeView(frame, {
      rows: ['host'],
      columns: [],
      values: [{ id: 'mean', field: 'latency', agg: 'mean', label: 'mean' }],
    } satisfies PivotSpec);
    expect(res.leaves[0]!.column.meta!.dataName).toBe('latency');
    // Row-level headers pick up displayName too.
    expect(res.rowLevels).toEqual(['Host']);
  });
});
