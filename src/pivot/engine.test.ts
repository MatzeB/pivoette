import { describe, expect, it } from 'vitest';
import { fromRows } from '../data/import';
import { withMeta } from '../data/frame';
import { unitLabels } from '../data/meta';
import { computeView } from './engine';
import type { ViewResult } from './result';
import { isFlat, normalizeView } from './spec';
import type { ViewSpec } from './spec';

describe('flat and pivot are the same spec', () => {
  const frame = fromRows([
    { r: 'A', v: 1 },
    { r: 'A', v: 3 },
    { r: 'B', v: 5 },
  ]);

  it('reads flat as "no grouping and no aggregation"', () => {
    expect(isFlat({ columns: [{ id: 'r' }, { id: 'v' }] })).toBe(true);
    // An axis is enough on its own, even an empty one — it was declared.
    expect(isFlat({ pivotRows: [], columns: [{ id: 'r' }] })).toBe(false);
    expect(
      isFlat({
        pivotRows: [{ field: 'r' }],
        columns: [{ id: 'v', agg: 'sum' }],
      }),
    ).toBe(false);
    // No axes, but an aggregation: a single grand-total row is still a pivot.
    expect(isFlat({ columns: [{ id: 'v', agg: 'sum' }] })).toBe(false);
  });

  it('aggregates to one row when a spec has no axes at all', () => {
    const res = computeView(frame, { columns: [{ id: 'v', agg: 'sum' }] });
    expect(res.mode).toBe('pivot');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.cells[0]!.value).toBe(9);
  });

  it('projects one row per source row when nothing aggregates', () => {
    const res = computeView(frame, { columns: [{ id: 'r' }, { id: 'v' }] });
    expect(res.mode).toBe('flat');
    expect(res.rows).toHaveLength(3);
    expect(res.rowLevels).toEqual([]);
  });

  it('splits the one columns list by what each entry declares', () => {
    const norm = normalizeView({
      pivotRows: [{ field: 'r' }],
      columns: [
        { id: 'sum', source: 'v', agg: 'sum' },
        { id: 'twice', compute: 'sum * 2' },
        { id: 'mean', source: 'v', agg: 'mean' },
      ],
    });
    // Order within each kind is spec order, which is what the engine relies on.
    expect(norm.measures.map((m) => m.id)).toEqual(['sum', 'mean']);
    expect(norm.derived.map((d) => d.id)).toEqual(['twice']);
    expect(norm.pivotColumns).toEqual([]);
  });

  it('defaults a measure source to its id', () => {
    const res = computeView(frame, {
      pivotRows: [{ field: 'r' }],
      columns: [{ id: 'v', agg: 'sum' }],
    });
    expect(res.rows.map((row) => row.cells[0]!.value)).toEqual([4, 5]);
  });
});

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
  const spec: ViewSpec = {
    pivotRows: [{ field: 'r' }],
    pivotColumns: [{ field: 'c' }],
    columns: [
      { id: 'sum', source: 'v', agg: 'sum', label: 'sum' },
      { id: 'mean', source: 'v', agg: 'mean', label: 'mean' },
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
      columnAxis: 'pivotRows',
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
      pivotRows: [{ field: 'r' }],
      pivotColumns: [{ field: 'c' }],
      columns: [{ id: 'mean', source: 'v', agg: 'mean', label: 'mean' }],
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
  const spec: ViewSpec = {
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
  const spec: ViewSpec = {
    pivotRows: [{ field: 'app' }],
    pivotColumns: [
      { field: 'platform' },
      {
        field: 'revision',
        computed: [
          {
            id: 'delta',
            label: 'Δ%',
            inputs: {
              before: { member: 'before' },
              after: { member: 'after' },
            },
            compute: 'before ? (after - before) / before : null',
            place: { after: 'after' },
          },
        ],
      },
    ],
    columns: [{ id: 'mean', source: 't', agg: 'mean', label: 'mean' }],
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

  it('survives moving the outer level to the row axis', () => {
    // The whole reason the member lives on the axis: how often it repeats is
    // read off the levels outside it, so dropping one leaves a single Δ% per
    // row instead of a dangling reference. Nothing about `delta` changes.
    const res = computeView(frame, {
      ...spec,
      pivotRows: [{ field: 'app' }, { field: 'platform' }],
      pivotColumns: [spec.pivotColumns![1]!],
    });
    expect(res.leaves.map((l) => l.colPath.join('/'))).toEqual([
      'before',
      'after',
      'Δ%',
    ]);
    // Intel: 100 -> 80, AMD: 200 -> 220.
    expect(res.rows[0]!.cells[leafAt(res, ['Δ%'])]!.value).toBeCloseTo(
      -0.2,
      10,
    );
    expect(res.rows[1]!.cells[leafAt(res, ['Δ%'])]!.value).toBeCloseTo(0.1, 10);
  });

  it('yields one Δ% per measure, from the one expression', () => {
    // `inputs` name no `column`, so each Δ% reads the measure it sits under —
    // the member spans the measures sublevel as a real member does.
    const res = computeView(frame, {
      ...spec,
      columns: [
        { id: 'mean', source: 't', agg: 'mean', label: 'mean' },
        { id: 'max', source: 't', agg: 'max', label: 'max' },
      ],
    });
    expect(res.leaves.map((l) => l.colPath.join('/'))).toEqual([
      'Intel/before/mean',
      'Intel/before/max',
      'Intel/after/mean',
      'Intel/after/max',
      'Intel/Δ%/mean',
      'Intel/Δ%/max',
      'AMD/before/mean',
      'AMD/before/max',
      'AMD/after/mean',
      'AMD/after/max',
      'AMD/Δ%/mean',
      'AMD/Δ%/max',
    ]);
    const row = res.rows[0]!;
    expect(row.cells[leafAt(res, ['Intel', 'Δ%', 'mean'])]!.value).toBeCloseTo(
      -0.2,
      10,
    );
    expect(row.cells[leafAt(res, ['AMD', 'Δ%', 'max'])]!.value).toBeCloseTo(
      0.1,
      10,
    );
  });
});

describe('row/column sorting', () => {
  const frame = fromRows([
    { r: 'B', c: 'y', v: 1 },
    { r: 'A', c: 'x', v: 2 },
    { r: 'B', c: 'x', v: 3 },
    { r: 'A', c: 'y', v: 4 },
  ]);
  const base: ViewSpec = {
    pivotRows: [{ field: 'r' }],
    pivotColumns: [{ field: 'c' }],
    columns: [{ id: 'sum', source: 'v', agg: 'sum', label: 'sum' }],
  };

  it('defaults to first-seen order', () => {
    const res = computeView(frame, base);
    expect(res.rows.map((r) => r.path[0])).toEqual(['B', 'A']);
    expect(res.leaves.map((l) => l.colPath[0])).toEqual(['y', 'x']);
  });

  it('applies a sort on either axis', () => {
    const res = computeView(frame, {
      ...base,
      pivotRows: [{ field: 'r', sort: 'asc' }],
      pivotColumns: [{ field: 'c', sort: 'asc' }],
    });
    expect(res.rows.map((r) => r.path[0])).toEqual(['A', 'B']);
    expect(res.leaves.map((l) => l.colPath[0])).toEqual(['x', 'y']);
  });

  it('honors descending direction', () => {
    const res = computeView(frame, {
      ...base,
      pivotRows: [{ field: 'r', sort: 'desc' }],
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
      pivotRows: [{ field: 'r' }],
      columns: [
        {
          id: 'range',
          source: 'v',
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
      pivotRows: [{ field: 'r' }],
      pivotColumns: [{ field: 'c' }],
      columns: [{ id: 'sum', source: 'v', agg: 'sum', label: 'sum' }],
    });
    expect(res.columnHeaderDepth).toBe(1);
    expect(res.leaves.every((l) => l.colPath.length === 1)).toBe(true);
  });

  it('multiple measures add the measure level (depth 2)', () => {
    const res = computeView(frame, {
      pivotRows: [{ field: 'r' }],
      pivotColumns: [{ field: 'c' }],
      columns: [
        { id: 'sum', source: 'v', agg: 'sum', label: 'sum' },
        { id: 'max', source: 'v', agg: 'max', label: 'max' },
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
      pivotRows: [{ field: 't' }],
      columns: [
        { id: 'a', source: 'a', agg: 'sum', label: 'A' },
        { id: 'b', source: 'b', agg: 'sum', label: 'B' },
        {
          id: 'total',
          label: 'Sum',
          inputs: {
            a: { colPath: [], column: 'a' },
            b: { colPath: [], column: 'b' },
          },
          compute: 'a + b',
          place: 'append',
        },
      ],
    });
    expect(res.leaves.map((l) => l.column.label)).toEqual(['A', 'B', 'Sum']);
    expect(res.rows[0]!.cells[leafAt(res, ['Sum'])]!.value).toBe(5);
  });

  it('a computed member without place appends within each group', () => {
    const frame = fromRows([
      { app: 'P1', platform: 'Intel', revision: 'before', t: 100 },
      { app: 'P1', platform: 'Intel', revision: 'after', t: 50 },
      { app: 'P1', platform: 'AMD', revision: 'before', t: 200 },
      { app: 'P1', platform: 'AMD', revision: 'after', t: 100 },
    ]);
    const res = computeView(frame, {
      pivotRows: [{ field: 'app' }],
      pivotColumns: [
        { field: 'platform' },
        {
          field: 'revision',
          computed: [
            {
              id: 'delta',
              label: 'Δ%',
              inputs: {
                before: { member: 'before' },
                after: { member: 'after' },
              },
              compute: 'before ? (after - before) / before : null',
              // no `place` — falls back to appending after the group's last leaf
            },
          ],
        },
      ],
      columns: [{ id: 'mean', source: 't', agg: 'mean', label: 'mean' }],
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
      unit: 'second',
      scale: 'milli',
    },
  };

  it('exposes source metadata on flat leaves, incl. composite sources', () => {
    const frame = fromRows(rows, meta);
    const res = computeView(frame, {
      columns: [
        {
          id: 'asset',
          composite: { fields: ['image', 'desc'], sortKey: 'desc' },
        },
        { id: 'latency', source: 'latency' },
        { id: 'double', compute: 'latency * 2' },
      ],
    } satisfies ViewSpec);

    const [asset, latency, double] = res.leaves;
    expect(latency!.column.meta!.displayName).toBe('Latency');
    expect(latency!.column.meta!.unitShort).toEqual(['s']);
    expect(asset!.column.sources!.map((m) => m.dataName)).toEqual([
      'image',
      'desc',
    ]);
    // A computed column has no source field, so no metadata.
    expect(double!.column.meta).toBeUndefined();
  });

  it('falls back to displayName for flat headers, letting `label` win', () => {
    const frame = fromRows(rows, meta);
    const res = computeView(frame, {
      columns: [
        { id: 'host', source: 'host' },
        { id: 'latency', source: 'latency', label: 'Explicit' },
      ],
    } satisfies ViewSpec);
    expect(res.leaves.map((l) => l.column.label)).toEqual(['Host', 'Explicit']);
  });

  it('exposes the aggregated field metadata on pivot measure leaves', () => {
    const frame = fromRows(rows, meta);
    const res = computeView(frame, {
      pivotRows: [{ field: 'host' }],
      columns: [{ id: 'mean', source: 'latency', agg: 'mean', label: 'mean' }],
    } satisfies ViewSpec);
    expect(res.leaves[0]!.column.meta!.dataName).toBe('latency');
    // Row-level headers pick up displayName too.
    expect(res.rowLevels).toEqual(['Host']);
  });

  it('lets an axis entry label and re-describe its level', () => {
    const frame = fromRows(rows, meta);
    const res = computeView(frame, {
      // `label` beats the field's displayName; `meta` layers over the frame's.
      pivotRows: [
        { field: 'host', label: 'Machine', meta: { unit: ['byte'] } },
      ],
      columns: [{ id: 'mean', source: 'latency', agg: 'mean', label: 'mean' }],
    } satisfies ViewSpec);
    expect(res.rowLevels).toEqual(['Machine']);
    expect(frame.columnByName.get('host')!.meta.unit).toBeUndefined();
    expect(res.frame.columnByName.get('host')!.meta.unit).toEqual(['byte']);
  });

  it('lets a measure carry its own metadata', () => {
    const frame = fromRows(rows, meta);
    const res = computeView(frame, {
      pivotRows: [{ field: 'host' }],
      columns: [
        {
          id: 'mean',
          source: 'latency',
          agg: 'mean',
          meta: { unit: ['second'], scale: ['milli'] },
        },
      ],
    } satisfies ViewSpec);
    // The source field's metadata, with the column's own layered over it.
    expect(res.leaves[0]!.column.meta!.dataName).toBe('latency');
    expect(res.leaves[0]!.column.meta!.unit).toEqual(['second']);
  });
});

describe('view metadata and defaults', () => {
  const rows = [
    { symbol: 'AAA', price: 12.5, basePrice: 10 },
    { symbol: 'BBB', price: 8, basePrice: 10 },
  ];

  /** Plain rows + view-declared metadata, as a caller would wire it up. */
  function build(spec: ViewSpec) {
    return computeView(withMeta(fromRows(rows), spec.meta), spec);
  }

  it('defaults `source` to the column id for a plain projection', () => {
    const res = build({
      columns: [{ id: 'symbol' }, { id: 'price' }],
    });
    expect(res.rows[0]!.cells.map((c) => c.value)).toEqual(['AAA', 12.5]);
  });

  it('does not default `source` for computed or composite columns', () => {
    const res = build({
      columns: [
        { id: 'price', compute: 'basePrice * 2' },
        { id: 'sym', composite: { fields: ['symbol'], sortKey: 'symbol' } },
      ],
    });
    // `price` took its compute, not the same-named field.
    expect(res.rows[0]!.cells[0]!.value).toBe(20);
    expect(res.rows[0]!.cells[1]!.value).toBe('AAA');
  });

  it('layers view metadata over the frame and deduces the format', () => {
    const res = build({
      meta: {
        price: { displayName: 'Price', kind: ['price'], unit: ['dollar'] },
      },
      columns: [{ id: 'price' }],
    });
    const leaf = res.leaves[0]!;
    expect(leaf.column.label).toBe('Price');
    expect(unitLabels(leaf.column.meta).full).toBe('$');
    // kind `price` implies a 2-decimal number (the $ comes from placement).
    expect(leaf.format({ value: 12.5 } as never)).toBe('12.50');
  });

  it('lets a computed column declare its own metadata', () => {
    const res = build({
      columns: [
        {
          id: 'delta',
          compute: 'price - basePrice',
          meta: { kind: ['price'], unit: ['dollar'] },
        },
      ],
    });
    const leaf = res.leaves[0]!;
    expect(unitLabels(leaf.column.meta).prefix).toBe(true);
    expect(leaf.format({ value: 2.5 } as never)).toBe('2.50');
  });

  it('keeps an explicit format over the deduced one', () => {
    const res = build({
      meta: { price: { kind: ['price'], unit: ['dollar'] } },
      columns: [
        { id: 'price', format: { fnName: 'number', options: { decimals: 0 } } },
      ],
    });
    expect(res.leaves[0]!.format({ value: 12.5 } as never)).toBe('13');
  });
});

describe('inheritUnitFormat', () => {
  const rows = [{ ratio: 5.25 }];
  const meta = { ratio: { kind: ['percentage'], scale: ['percent'] } };

  function leafFormat(def: Parameters<typeof computeView>[1]) {
    const spec = def as ViewSpec;
    const res = computeView(withMeta(fromRows(rows), spec.meta), spec);
    return res.leaves[0]!.format({ value: 5.25 } as never);
  }

  it('inherits the deduced decimals by default', () => {
    expect(
      leafFormat({
        meta,
        columns: [
          {
            id: 'ratio',
            format: {
              fnName: 'number',
              options: { signDisplay: 'exceptZero' },
            },
          },
        ],
      }),
    ).toBe('+5.3');
  });

  it('uses the format verbatim when inheritUnitFormat is false', () => {
    expect(
      leafFormat({
        meta,
        columns: [
          {
            id: 'ratio',
            inheritUnitFormat: false,
            format: {
              fnName: 'number',
              options: { signDisplay: 'exceptZero' },
            },
          },
        ],
      }),
    ).toBe('+5.25');
  });

  it('opts out of deduction with no format at all', () => {
    expect(
      leafFormat({
        meta,
        columns: [{ id: 'ratio', inheritUnitFormat: false }],
      }),
    ).toBe('5.25');
  });
});

describe('factor', () => {
  const rows = [
    { g: 'A', rate: 0.1 },
    { g: 'A', rate: 0.2 },
    { g: 'B', rate: 0.6 },
  ];

  it('scales a pivot measure and its summary alike', () => {
    const res = computeView(fromRows(rows), {
      pivotRows: [{ field: 'g' }],
      showSummary: true,
      columns: [
        { id: 'm', source: 'rate', agg: 'mean', label: 'mean', factor: 100 },
      ],
    } satisfies ViewSpec);
    const [a, b] = res.rows.map((r) => r.cells[0]!.value as number);
    expect(a).toBeCloseTo(15, 10); // float: ((0.1+0.2)/2)*100
    expect(b).toBeCloseTo(60, 10);
    // The summary re-aggregates from source, and is scaled the same way — the
    // hole that made `expression`-based scaling unusable.
    expect(res.summary![0]!.value).toBeCloseTo(30, 10);
  });

  it('scales a flat column before formatting and styling', () => {
    const res = computeView(fromRows(rows), {
      columns: [{ id: 'rate', factor: 100 }],
    } satisfies ViewSpec);
    expect(res.rows.map((r) => r.cells[0]!.value)).toEqual([10, 20, 60]);
  });

  it('leaves nulls and non-numbers alone', () => {
    const res = computeView(fromRows([{ a: null, b: 'x' }]), {
      columns: [
        { id: 'a', factor: 100 },
        { id: 'b', factor: 100 },
      ],
    } satisfies ViewSpec);
    expect(res.rows[0]!.cells.map((c) => c.value)).toEqual([null, 'x']);
  });

  it('reaches formats that could not honour an option', () => {
    const res = computeView(fromRows(rows), {
      columns: [
        // An inline fn has no `options` at all — a format-level factor could
        // never have applied here.
        { id: 'rate', factor: 100, format: { fn: (ctx) => `<${ctx.value}>` } },
      ],
    } satisfies ViewSpec);
    const leaf = res.leaves[0]!;
    expect(leaf.format({ value: res.rows[0]!.cells[0]!.value } as never)).toBe(
      '<10>',
    );
  });
});

describe('factor and compute inputs', () => {
  it('a derived column sees a referenced measure in display units', () => {
    const res = computeView(fromRows([{ g: 'A', c: 'x', v: 0.5 }]), {
      pivotRows: [{ field: 'g' }],
      pivotColumns: [{ field: 'c' }],
      columns: [
        { id: 'm', source: 'v', agg: 'sum', label: 'm', factor: 100 },
        {
          id: 'd',
          label: 'D',
          inputs: { m: { colPath: ['x'], column: 'm' } },
          compute: 'm',
        },
      ],
    } satisfies ViewSpec);
    const cells = res.rows[0]!.cells;
    expect(cells[0]!.value).toBe(50);
    // Not 0.5: the measure was factored when its own cell was built.
    expect(cells[1]!.inputs?.m).toBe(50);
  });

  it("a column's own factor applies after its compute runs", () => {
    const res = computeView(fromRows([{ a: 2 }]), {
      columns: [{ id: 'd', compute: 'a * 3', factor: 10 }],
    } satisfies ViewSpec);
    expect(res.rows[0]!.cells[0]!.value).toBe(60);
  });
});

describe('multi-level index nesting', () => {
  /** Deliberately un-grouped input: no two adjacent rows share a team. */
  const scrambled = [
    { team: 'A', project: 'p1', n: 1 },
    { team: 'B', project: 'p3', n: 2 },
    { team: 'A', project: 'p2', n: 4 },
    { team: 'B', project: 'p4', n: 8 },
    { team: 'A', project: 'p1', n: 16 },
  ];
  const spec: ViewSpec = {
    pivotRows: [{ field: 'team' }, { field: 'project' }],
    columns: [{ id: 's', source: 'n', agg: 'sum', label: 'n' }],
  };

  /** Merged index cells assume keys sharing a prefix are adjacent. */
  function outerBlocks(paths: unknown[][]) {
    let n = paths.length > 0 ? 1 : 0;
    for (let i = 1; i < paths.length; i++) {
      if (paths[i]![0] !== paths[i - 1]![0]) n++;
    }
    return n;
  }

  it('groups by the outer level even when the source rows do not', () => {
    const res = computeView(fromRows(scrambled), spec);
    const paths = res.rows.map((r) => r.path);
    expect(paths.map((p) => p[0])).toEqual(['A', 'A', 'B', 'B']);
    // One block per team, not one per row.
    expect(outerBlocks(paths)).toBe(2);
  });

  it('keeps encounter order within each level', () => {
    const res = computeView(fromRows(scrambled), spec);
    expect(res.rows.map((r) => r.path.join('>'))).toEqual([
      'A>p1',
      'A>p2',
      'B>p3',
      'B>p4',
    ]);
  });

  it('still nests when only an inner level is sorted', () => {
    const res = computeView(fromRows(scrambled), {
      ...spec,
      pivotRows: [{ field: 'team' }, { field: 'project', sort: 'desc' }],
    });
    const paths = res.rows.map((r) => r.path);
    // The outer level is untouched but must still block together.
    expect(outerBlocks(paths)).toBe(2);
    expect(res.rows.map((r) => r.path.join('>'))).toEqual([
      'A>p2',
      'A>p1',
      'B>p4',
      'B>p3',
    ]);
  });

  it('honors an explicit outer sort', () => {
    const res = computeView(fromRows(scrambled), {
      ...spec,
      pivotRows: [{ field: 'team', sort: 'desc' }, { field: 'project' }],
    });
    expect(res.rows.map((r) => r.path[0])).toEqual(['B', 'B', 'A', 'A']);
  });
});

describe('auto-scaled columns', () => {
  const rows = [
    { app: 'A', t: 4_000 },
    { app: 'A', t: 4_680 },
    { app: 'B', t: 5_000 },
  ];
  /** Nanoseconds, declared by the view the way a CSV-fed spec must. */
  const nanos = {
    t: { kind: ['duration'], unit: ['second'], scale: ['nano'] },
  };

  /** The text a leaf renders for a row. */
  function text(res: ViewResult, li: number, row = res.rows[0]!): string {
    const leaf = res.leaves[li]!;
    return leaf.format({
      value: row.cells[li]!.value,
      inputs: row.cells[li]!.inputs ?? {},
      rowPath: row.path,
      colPath: leaf.colPath,
      column: leaf.column,
      frame: res.frame,
    });
  }

  function build(columns: ViewSpec['columns']) {
    return computeView(fromRows(rows), {
      meta: nanos,
      pivotRows: [{ field: 'app' }],
      columns,
    });
  }

  it('shows nanoseconds as microseconds, and says so in the metadata', () => {
    const res = build([
      { id: 'mean', source: 't', agg: 'mean', autoScale: true },
    ]);
    expect(text(res, 0)).toBe('4.34');
    expect(res.leaves[0]!.column.meta!.scale).toEqual(['micro']);
    expect(res.leaves[0]!.displayFactor).toBeCloseTo(1e-3, 12);
  });

  it('leaves Cell.value in stored units', () => {
    // The property the whole design rests on: sorting, styles and any
    // expression over the value keep meaning nanoseconds.
    const res = build([
      { id: 'mean', source: 't', agg: 'mean', autoScale: true },
    ]);
    expect(res.rows[0]!.cells[0]!.value).toBeCloseTo(4340, 10);
    const plain = build([{ id: 'mean', source: 't', agg: 'mean' }]);
    expect(res.rows.map((r) => r.cells[0]!.value)).toEqual(
      plain.rows.map((r) => r.cells[0]!.value),
    );
  });

  it('scales the summary row with the body', () => {
    const res = computeView(fromRows(rows), {
      meta: nanos,
      pivotRows: [{ field: 'app' }],
      columns: [{ id: 'mean', source: 't', agg: 'mean', autoScale: true }],
      showSummary: true,
    });
    const leaf = res.leaves[0]!;
    const cell = res.summary![0]!;
    const shown = leaf.format({
      value: cell.value,
      inputs: {},
      rowPath: [],
      colPath: leaf.colPath,
      column: leaf.column,
      frame: res.frame,
    });
    // Mean of 4000/4680/5000 = 4560 ns, in the column's chosen µs.
    expect(shown).toBe('4.56');
  });

  it('is off unless the column asks', () => {
    const res = build([{ id: 'mean', source: 't', agg: 'mean' }]);
    expect(res.leaves[0]!.displayFactor).toBeUndefined();
    expect(res.leaves[0]!.column.meta!.scale).toEqual(['nano']);
  });

  it('declines a column whose unit has no magnitude', () => {
    const res = computeView(fromRows(rows), {
      meta: { t: { unit: ['token', '1/second'] } },
      pivotRows: [{ field: 'app' }],
      columns: [{ id: 'mean', source: 't', agg: 'mean', autoScale: true }],
    });
    expect(res.leaves[0]!.displayFactor).toBeUndefined();
  });

  it('honours an explicit precision instead of overriding it', () => {
    const res = build([
      {
        id: 'mean',
        source: 't',
        agg: 'mean',
        autoScale: true,
        format: { options: { decimals: 1 } },
      },
    ]);
    expect(text(res, 0)).toBe('4.3');
  });
});

describe('scale pools', () => {
  // `small` and `big` are three orders of magnitude apart, so left alone they
  // land on different rungs.
  const rows = [{ g: 'x', small: 900, big: 900_000 }];
  const nanos = {
    small: { kind: ['duration'], unit: ['second'], scale: ['nano'] },
    big: { kind: ['duration'], unit: ['second'], scale: ['nano'] },
  };

  function build(pool?: string) {
    return computeView(fromRows(rows), {
      meta: nanos,
      pivotRows: [{ field: 'g' }],
      columns: [
        { id: 'small', agg: 'sum', autoScale: true, scalePool: pool },
        { id: 'big', agg: 'sum', autoScale: true, scalePool: pool },
      ],
    });
  }

  it('lets unpooled columns choose independently', () => {
    const res = build();
    expect(res.leaves.map((l) => l.column.meta!.scale?.[0])).toEqual([
      'nano',
      'micro',
    ]);
  });

  it('makes pooled columns agree on one scale', () => {
    const res = build('times');
    const scales = res.leaves.map((l) => l.column.meta!.scale?.[0]);
    expect(scales[0]).toBe(scales[1]);
    expect(res.leaves[0]!.displayFactor).toBe(res.leaves[1]!.displayFactor);
  });

  it('holds one scale across a pivot’s column groups', () => {
    // The same measure repeated per column group must not split: a row is only
    // comparable across the page if every group reads in the same unit.
    const res = computeView(
      fromRows([
        { g: 'x', size: 'tiny', t: 100 },
        { g: 'x', size: 'huge', t: 90_000 },
      ]),
      {
        meta: { t: { kind: ['duration'], unit: ['second'], scale: ['nano'] } },
        pivotRows: [{ field: 'g' }],
        pivotColumns: [{ field: 'size' }],
        columns: [{ id: 't', agg: 'mean', autoScale: true }],
      },
    );
    expect(res.leaves).toHaveLength(2);
    expect(res.leaves[0]!.displayFactor).toBe(res.leaves[1]!.displayFactor);
  });
});

describe('per-value scale (what Format.Duration used to do)', () => {
  /** One row per value, so each cell picks its own rung. */
  function render(value: number): string {
    const res = computeView(fromRows([{ g: 'x', t: value }]), {
      meta: { t: { kind: ['duration'], unit: ['second'], scale: ['nano'] } },
      pivotRows: [{ field: 'g' }],
      columns: [{ id: 't', agg: 'sum', autoScale: { per: 'value' } }],
    });
    const leaf = res.leaves[0]!;
    return leaf.format({
      value: res.rows[0]!.cells[0]!.value,
      inputs: {},
      rowPath: [],
      colPath: leaf.colPath,
      column: leaf.column,
      frame: res.frame,
    });
  }

  it('reproduces the cases the removed formatter was pinned to', () => {
    expect(render(999)).toBe('999 ns');
    expect(render(1_000)).toBe('1.00 µs');
    expect(render(1_500_000)).toBe('1.50 ms');
    expect(render(2_000_000_000)).toBe('2.00 s');
    // The one difference: minute is `min`, not the old `m`, which collided
    // with metre.
    expect(render(90_000_000_000)).toBe('1.50 min');
    expect(render(3_600_000_000_000)).toBe('1.00 h');
  });

  it('carries no column-wide factor, since each cell chose its own', () => {
    const res = computeView(fromRows([{ g: 'x', t: 5 }]), {
      meta: { t: { kind: ['duration'], unit: ['second'], scale: ['nano'] } },
      pivotRows: [{ field: 'g' }],
      columns: [{ id: 't', agg: 'sum', autoScale: { per: 'value' } }],
    });
    expect(res.leaves[0]!.displayFactor).toBeUndefined();
  });
});

describe('a scalePool spanning unlike stored magnitudes', () => {
  const frame = withMeta(
    fromRows([
      { r: 'A', ns: 5_000_000, ms: 5 },
      { r: 'A', ns: 8_000_000, ms: 8 },
    ]),
    {
      ns: { kind: ['duration'], unit: ['second'], scale: ['nano'] },
      ms: { kind: ['duration'], unit: ['second'], scale: ['milli'] },
    },
  );
  const spec: ViewSpec = {
    pivotRows: [{ field: 'r' }],
    columns: [
      { id: 'ns', agg: 'mean', autoScale: true, scalePool: 'p' },
      { id: 'ms', agg: 'mean', autoScale: true, scalePool: 'p' },
    ],
  };

  it('converts each column from where it is actually stored', () => {
    // Both hold the same duration. A pool agrees on the *displayed* scale, so
    // each column has its own distance to travel to reach it — sharing one
    // factor left them a million apart under a single label.
    const res = computeView(frame, spec);
    const shown = (i: number) =>
      res.leaves[i]!.format({
        value: res.rows[0]!.cells[i]!.value,
        inputs: {},
        rowPath: [],
        colPath: [],
        column: res.leaves[i]!.column,
        frame,
      });
    expect(shown(0)).toBe(shown(1));
    expect(unitLabels(res.leaves[0]!.column.meta).full).toBe('ms');
    expect(unitLabels(res.leaves[1]!.column.meta).full).toBe('ms');
  });
});

describe('a computed member under a formatted level', () => {
  it('takes the level’s own member format, as the measures do', () => {
    const frame = withMeta(
      fromRows([
        { app: 'P1', dow: 0, revision: 'before', t: 100 },
        { app: 'P1', dow: 0, revision: 'after', t: 80 },
      ]),
      { dow: { kind: ['weekday'] } },
    );
    const res = computeView(frame, {
      pivotRows: [{ field: 'app' }],
      pivotColumns: [
        { field: 'dow' },
        {
          field: 'revision',
          computed: [
            {
              id: 'delta',
              label: 'Δ',
              inputs: {
                before: { member: 'before' },
                after: { member: 'after' },
              },
              compute: 'before ? (after - before) / before : null',
            },
          ],
        },
      ],
      columns: [{ id: 'mean', source: 't', agg: 'mean', label: 'mean' }],
    });
    // A raw String(0) here would hang the Δ under a second "0" group beside
    // the formatted "Sun" one, splitting the header in two.
    expect(res.leaves.map((l) => l.colPath.join('/'))).toEqual([
      'Sun/before',
      'Sun/after',
      'Sun/Δ',
    ]);
    expect(res.columnHeader.map((h) => h.label)).toEqual(['Sun']);
  });

  it('renders nothing rather than throwing when no column aggregates', () => {
    // The validator rejects this, but an unvalidated spec reaching the engine
    // should not take the page down with it.
    const frame = fromRows([{ app: 'P1', revision: 'before', t: 100 }]);
    expect(() =>
      computeView(frame, {
        pivotRows: [{ field: 'app' }],
        pivotColumns: [
          {
            field: 'revision',
            computed: [{ id: 'd', compute: '1', inputs: {} }],
          },
        ],
        columns: [{ id: 'x', compute: '1' }],
      }),
    ).not.toThrow();
  });
});

describe('timestamp measures', () => {
  const frame = fromRows([
    { pkg: 'a', publishedAt: '2024-04-26T16:42:26Z' },
    { pkg: 'a', publishedAt: '2026-09-09T17:21:30Z' },
    { pkg: 'b', publishedAt: '2021-02-20T15:42:16Z' },
  ]);
  const view: ViewSpec = {
    meta: { publishedAt: { kind: ['timestamp'], encoding: 'rfc3339' } },
    pivotRows: [{ field: 'pkg' }],
    columns: [
      { id: 'newest', source: 'publishedAt', agg: 'max' },
      { id: 'oldest', source: 'publishedAt', agg: 'min' },
    ],
    showSummary: true,
  };

  it('aggregates decoded instants rather than skipping the text', () => {
    const res = computeView(frame, view);
    expect(res.rows[0]!.cells.map((c) => c.value)).toEqual([
      Date.parse('2026-09-09T17:21:30Z'),
      Date.parse('2024-04-26T16:42:26Z'),
    ]);
    expect(res.summary!.map((c) => c.value)).toEqual([
      Date.parse('2026-09-09T17:21:30Z'),
      Date.parse('2021-02-20T15:42:16Z'),
    ]);
  });

  it('leaves an undeclared date column as text', () => {
    const res = computeView(frame, { ...view, meta: undefined });
    expect(res.rows[0]!.cells[0]!.value).toBeNull();
  });
});

describe('measure headers', () => {
  const frame = fromRows([
    { pkg: 'a', dl: 3 },
    { pkg: 'b', dl: 5 },
  ]);
  const labels = (view: ViewSpec) =>
    computeView(frame, view).leaves.map((l) => l.column.label);

  it("names a measure by its field's display name, as a flat column is", () => {
    const meta = { dl: { displayName: 'Downloads' } };
    expect(
      labels({
        meta,
        pivotRows: [{ field: 'pkg' }],
        columns: [{ id: 'total', source: 'dl', agg: 'sum' }],
      }),
    ).toEqual(['Downloads']);
    expect(labels({ meta, columns: [{ id: 'dl' }] })).toEqual(['Downloads']);
  });

  it('keeps the ids of measures that share a field', () => {
    expect(
      labels({
        meta: { dl: { displayName: 'Downloads' } },
        pivotRows: [{ field: 'pkg' }],
        columns: [
          { id: 'mean', source: 'dl', agg: 'mean' },
          { id: 'max', source: 'dl', agg: 'max', label: 'Peak' },
        ],
      }),
    ).toEqual(['mean', 'Peak']);
  });
});

describe('factor', () => {
  it('adds no floating-point noise of its own', () => {
    const res = computeView(fromRows([{ dl: 38791051 }]), {
      columns: [{ id: 'dl', factor: 1e-6 }],
    });
    expect(res.rows[0]!.cells[0]!.value).toBe(38.791051);
  });
});
