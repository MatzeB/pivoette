import { describe, expect, it } from 'vitest';
import {
  addColumn,
  addField,
  addFooterRow,
  moveColumn,
  moveField,
  moveFooterRow,
  removeColumn,
  removeField,
  removeFilter,
  removeFooterRow,
  moveBar,
  setChart,
  setColumnAgg,
  setExcluded,
  setMark,
  setShowAs,
  toFlat,
  toPivot,
} from './ops';
import { computeView } from '../pivot/engine';
import { fromRows } from '../data/import';
import { validateBundle } from '../bundle';
import { SEVERAL } from '../pivot/aggregations';
import type { ViewSpec } from '../pivot/spec';

const base: ViewSpec = {
  pivotRows: [{ field: 'team' }, { field: 'author' }],
  pivotColumns: [{ field: 'weekday' }],
  columns: [
    { id: 'added', source: 'linesAdded', agg: 'sum', label: '+' },
    { id: 'removed', source: 'linesRemoved', agg: 'sum', label: '−' },
  ],
};

/** The field names on an axis, which is what most assertions are about. */
const fields = (spec: ViewSpec, zone: 'pivotRows' | 'pivotColumns') =>
  (spec[zone] ?? []).map((a) => a.field);
const ids = (spec: ViewSpec) => spec.columns.map((c) => c.id);

describe('grouping fields', () => {
  it('appends to the named axis', () => {
    expect(
      fields(addField(base, 'pivotColumns', 'month'), 'pivotColumns'),
    ).toEqual(['weekday', 'month']);
    expect(fields(addField(base, 'pivotRows', 'month'), 'pivotRows')).toEqual([
      'team',
      'author',
      'month',
    ]);
  });

  it('ignores a field already placed on either axis', () => {
    expect(addField(base, 'pivotColumns', 'author')).toBe(base);
    expect(addField(base, 'pivotRows', 'weekday')).toBe(base);
  });

  it('removes by position', () => {
    expect(fields(removeField(base, 'pivotRows', 0), 'pivotRows')).toEqual([
      'author',
    ]);
    expect(removeField(base, 'pivotRows', 5)).toBe(base);
  });

  it('reorders within an axis', () => {
    const moved = moveField(
      base,
      { zone: 'pivotRows', index: 1 },
      { zone: 'pivotRows', index: 0 },
    );
    expect(fields(moved, 'pivotRows')).toEqual(['author', 'team']);
  });

  it('clamps a drop past the end', () => {
    const moved = moveField(
      base,
      { zone: 'pivotRows', index: 0 },
      { zone: 'pivotRows', index: 9 },
    );
    expect(fields(moved, 'pivotRows')).toEqual(['author', 'team']);
  });

  it('pivots a field from one axis to the other', () => {
    const moved = moveField(
      base,
      { zone: 'pivotRows', index: 1 },
      { zone: 'pivotColumns', index: 0 },
    );
    expect(fields(moved, 'pivotRows')).toEqual(['team']);
    expect(fields(moved, 'pivotColumns')).toEqual(['author', 'weekday']);
  });

  it("carries the level's label and sort across a pivot", () => {
    const sorted: ViewSpec = {
      ...base,
      pivotRows: [
        { field: 'team' },
        { field: 'author', sort: 'desc', label: 'Who' },
      ],
    };
    const moved = moveField(
      sorted,
      { zone: 'pivotRows', index: 1 },
      { zone: 'pivotColumns', index: 0 },
    );
    // The whole entry moves, so nothing has to be pruned or reattached.
    expect(moved.pivotColumns?.[0]).toEqual({
      field: 'author',
      sort: 'desc',
      label: 'Who',
    });
    expect(moved.pivotRows).toEqual([{ field: 'team' }]);
  });

  it('handles an axis the spec never declared', () => {
    const rowsOnly: ViewSpec = {
      pivotRows: [{ field: 'team' }],
      columns: [{ id: 'n', source: 'v', agg: 'sum' }],
    };
    expect(
      fields(addField(rowsOnly, 'pivotColumns', 'weekday'), 'pivotColumns'),
    ).toEqual(['weekday']);
    expect(removeField(rowsOnly, 'pivotColumns', 0)).toBe(rowsOnly);
  });

  it('is a no-op for an empty position', () => {
    expect(
      moveField(
        base,
        { zone: 'pivotColumns', index: 4 },
        { zone: 'pivotRows', index: 0 },
      ),
    ).toBe(base);
  });
});

describe('columns', () => {
  it('derives an id from the aggregation and field', () => {
    const next = addColumn(base, 'linesAdded', 'mean');
    expect(next.columns.at(-1)).toMatchObject({
      id: 'mean_linesAdded',
      source: 'linesAdded',
      agg: 'mean',
    });
  });

  it('keeps the derived id unique', () => {
    const once = addColumn(base, 'linesAdded', 'mean');
    const twice = addColumn(once, 'linesAdded', 'mean');
    expect(ids(twice)).toContain('mean_linesAdded');
    expect(ids(twice)).toContain('mean_linesAdded_2');
  });

  it('removes by position but never drops the last measure', () => {
    expect(ids(removeColumn(base, 0))).toEqual(['removed']);
    const one = removeColumn(base, 0);
    // Nothing left to aggregate, so the last one stays.
    expect(removeColumn(one, 0)).toBe(one);
  });

  it('removes a derived column even when one measure remains', () => {
    const withDerived: ViewSpec = {
      ...base,
      columns: [base.columns[0]!, { id: 'net', compute: 'added - removed' }],
    };
    expect(ids(removeColumn(withDerived, 1))).toEqual(['added']);
  });

  it('changes an aggregation without touching the rest', () => {
    const next = setColumnAgg(base, 0, 'mean');
    expect(next.columns[0]).toEqual({ ...base.columns[0], agg: 'mean' });
    expect(next.columns[1]).toBe(base.columns[1]);
  });

  it('reorders', () => {
    expect(ids(moveColumn(base, 1, 0))).toEqual(['removed', 'added']);
  });
});

describe('footer rows', () => {
  it('adds and removes', () => {
    const one = addFooterRow({}, 'mean');
    expect(one.footer).toEqual([{ label: 'mean', agg: 'mean' }]);
    const two = addFooterRow(one, 'sum');
    expect(two.footer).toHaveLength(2);
    expect(removeFooterRow(two, 0).footer).toEqual([
      { label: 'sum', agg: 'sum' },
    ]);
    expect(removeFooterRow(two, 7)).toBe(two);
  });
});

describe('flat specs', () => {
  const flat: ViewSpec = { columns: [{ id: 'a' }] };

  it('are left alone by the pivot-only operations', () => {
    expect(addField(flat, 'pivotRows', 'x')).toBe(flat);
    expect(removeField(flat, 'pivotRows', 0)).toBe(flat);
    expect(addColumn(flat, 'x', 'sum')).toBe(flat);
    expect(removeColumn(flat, 0)).toBe(flat);
    expect(
      moveField(
        flat,
        { zone: 'pivotRows', index: 0 },
        { zone: 'pivotColumns', index: 0 },
      ),
    ).toBe(flat);
  });
});

describe('serializability', () => {
  it('survives every operation', () => {
    let spec: ViewSpec = base;
    spec = addField(spec, 'pivotColumns', 'month');
    spec = moveField(
      spec,
      { zone: 'pivotRows', index: 0 },
      { zone: 'pivotColumns', index: 0 },
    );
    spec = addColumn(spec, 'linesAdded', 'mean');
    spec = setColumnAgg(spec, 0, 'max');
    spec = removeColumn(spec, 1);
    // The property the editor exists to preserve.
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });

  it('never mutates the input', () => {
    const before = JSON.parse(JSON.stringify(base)) as ViewSpec;
    addField(base, 'pivotRows', 'month');
    moveField(
      base,
      { zone: 'pivotRows', index: 0 },
      { zone: 'pivotColumns', index: 0 },
    );
    removeColumn(base, 0);
    expect(base).toEqual(before);
  });
});

describe('inserting a field at a position', () => {
  const at = (i?: number) =>
    fields(addField(base, 'pivotRows', 'month', i), 'pivotRows');

  it('places it where asked', () => {
    expect(at(0)).toEqual(['month', 'team', 'author']);
    expect(at(1)).toEqual(['team', 'month', 'author']);
  });

  it('appends without a position, and clamps a silly one', () => {
    expect(at().at(-1)).toBe('month');
    expect(at(99).at(-1)).toBe('month');
    expect(at(-3)[0]).toBe('month');
  });
});

describe('reordering footer rows', () => {
  const display = {
    footer: [
      { label: 'avg', agg: 'mean' },
      { label: 'median', agg: 'median' },
      { label: 'sum', agg: 'sum' },
    ],
  };

  it('moves a row and clamps out-of-range targets', () => {
    expect(moveFooterRow(display, 2, 0).footer?.map((f) => f.agg)).toEqual([
      'sum',
      'mean',
      'median',
    ]);
    expect(moveFooterRow(display, 0, 9).footer?.map((f) => f.agg)).toEqual([
      'median',
      'sum',
      'mean',
    ]);
  });

  it('is a no-op for a position that is not there', () => {
    expect(moveFooterRow(display, 7, 0)).toBe(display);
    expect(moveFooterRow({}, 0, 1)).toEqual({});
  });
});

describe('filters', () => {
  const flat: ViewSpec = { columns: [{ id: 'x' }] };

  it('sets and drops a field filter, flat or not', () => {
    const one = setExcluded(flat, 'p', ['GPU']);
    expect(one.filter).toEqual({ p: { exclude: ['GPU'] } });
    const two = setExcluded(one, 'q', []);
    expect(two.filter).toEqual({ p: { exclude: ['GPU'] }, q: { exclude: [] } });
    expect(removeFilter(two, 'q').filter).toEqual({ p: { exclude: ['GPU'] } });
    // The last one takes the key with it, leaving the spec as it was.
    expect(removeFilter(one, 'p')).toEqual(flat);
    expect(removeFilter(flat, 'p')).toBe(flat);
    expect(flat.filter).toBeUndefined();
  });
});

describe('chart display', () => {
  it('switches between table and chart, leaving table as the absence', () => {
    const chart = setShowAs({ zebra: true }, 'chart');
    expect(chart).toEqual({ zebra: true, as: 'chart' });
    expect(setShowAs(chart, 'table')).toEqual({ zebra: true });
  });

  it('merges settings and drops the ones cleared', () => {
    const one = setChart({}, { baseline: 1, symmetric: true });
    expect(one.chart).toEqual({ baseline: 1, symmetric: true });
    expect(setChart(one, { baseline: undefined }).chart).toEqual({
      symmetric: true,
    });
  });

  it('sets one measure’s mark without touching the others', () => {
    const one = setMark({}, 'lo', 'range');
    expect(setMark(one, 'hi', 'dot').chart!.marks).toEqual({
      lo: 'range',
      hi: 'dot',
    });
  });

  it('moves a bar and stores the whole order', () => {
    const next = moveBar({}, ['base', 'pgo', 'bolt'], 2, 0);
    expect(next.chart!.barOrder).toEqual(['bolt', 'base', 'pgo']);
    expect(moveBar({}, ['base'], 5, 0)).toEqual({});
  });
});

describe('toPivot / toFlat', () => {
  const rows = [
    { suite: 'A', bench: 'x', build: 'base', t: 1.1, runs: 5 },
    { suite: 'A', bench: 'x', build: 'pgo', t: 1.3, runs: 4 },
    { suite: 'A', bench: 'y', build: 'base', t: 0.9, runs: 5 },
    { suite: 'B', bench: 'z', build: 'base', t: 1.0, runs: 5 },
  ];
  const frame = fromRows(rows);
  const flat: ViewSpec = {
    filter: { suite: { exclude: ['C'] } },
    sort: [{ field: 'suite', direction: 'desc' }],
    columns: [
      { id: 'suite', label: 'Suite' },
      { id: 'bench' },
      { id: 'build' },
      { id: 't', label: 'Time', format: { options: { decimals: 2 } } },
      { id: 'slow', compute: 't < 1 || runs < 5' },
    ],
  };

  it('makes the index columns row levels and the rest `only` measures', () => {
    const next = toPivot(flat, 3, 'pivotRows', 'build');
    expect(next.pivotRows).toEqual([
      { field: 'suite', label: 'Suite', sort: 'desc' },
      { field: 'bench' },
      { field: 'build' },
    ]);
    expect(next.sort).toBeUndefined();
    expect(next.filter).toEqual(flat.filter);
    expect(next.derive).toEqual({ slow: { compute: 't < 1 || runs < 5' } });
    expect(next.columns).toEqual([
      {
        id: 't',
        label: 'Time',
        format: { options: { decimals: 2 } },
        agg: 'only',
      },
      { id: 'slow', source: 'slow', agg: 'only' },
    ]);
    expect(
      validateBundle({ data: { rows: [] }, view: next }, frame).problems,
    ).toEqual([]);
    // Each group is one source row, so the values are the flat table's.
    const res = computeView(frame, next);
    expect(res.rows.map((r) => r.cells.map((c) => c.value))).toEqual([
      [1.0, false],
      [1.1, false],
      [1.3, true],
      [0.9, true],
    ]);
  });

  it('pivots a field to the columns, out of the row levels', () => {
    const next = toPivot(flat, 3, 'pivotColumns', 'build');
    expect(next.pivotRows!.map((a) => a.field)).toEqual(['suite', 'bench']);
    expect(next.pivotColumns).toEqual([{ field: 'build' }]);
    const res = computeView(frame, next);
    // x has both builds; y only base.
    expect(res.rows).toHaveLength(3);
  });

  it('says so in the cell when a group is not one row', () => {
    const next = toPivot(flat, 1, 'pivotRows', 'suite');
    const res = computeView(frame, next);
    // bench and build are no index here, so they are `only` measures too.
    const a = res.rows.find((r) => r.path[0] === 'A')!;
    expect(a.cells.map((c) => c.value)).toEqual([
      SEVERAL,
      SEVERAL,
      SEVERAL,
      SEVERAL,
    ]);
    const b = res.rows.find((r) => r.path[0] === 'B')!;
    expect(b.cells.map((c) => c.value)).toEqual(['z', 'base', 1.0, false]);
  });

  it('gives a measure cell its group’s fields and measures to render with', () => {
    const next = toPivot(
      {
        ...flat,
        columns: flat.columns.map((c) =>
          c.id === 't' ? { ...c, render: { fnName: 'bar' } } : c,
        ),
      },
      3,
      'pivotRows',
      'build',
    );
    const res = computeView(frame, next);
    const cell = res.rows[0]!.cells[0]!;
    expect(cell.inputs).toMatchObject({ suite: 'B', runs: 5, t: 1.0 });
  });

  it('lists the source rows again, keeping the derived columns', () => {
    const pivot = toPivot(flat, 3, 'pivotColumns', 'build');
    const { view, indexColumns } = toFlat(pivot);
    expect(indexColumns).toBe(3);
    expect(view.pivotRows).toBeUndefined();
    expect(view.pivotColumns).toBeUndefined();
    expect(view.columns).toEqual([
      { id: 'suite', label: 'Suite' },
      { id: 'bench' },
      { id: 'build' },
      { id: 't', label: 'Time', format: { options: { decimals: 2 } } },
      { id: 'slow', source: 'slow' },
    ]);
    expect(view.sort).toEqual([{ field: 'suite', direction: 'desc' }]);
    expect(computeView(frame, view).rows).toHaveLength(4);
  });

  it('keeps one column per field when several measures read it', () => {
    const { view } = toFlat({
      pivotRows: [{ field: 'suite' }],
      showSummary: true,
      columns: [
        { id: 't', agg: 'mean' },
        { id: 'tMin', source: 't', agg: 'min' },
      ],
    });
    expect(view.columns).toEqual([{ id: 'suite' }, { id: 't' }]);
    expect(view.showSummary).toBeUndefined();
  });

  it('counts the rows when every column became a level', () => {
    const next = toPivot(
      { columns: [{ id: 'suite' }] },
      1,
      'pivotRows',
      'bench',
    );
    expect(next.columns).toEqual([
      { id: 'count', source: 'suite', agg: 'count', label: 'Rows' },
    ]);
  });
});
