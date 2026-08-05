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
  removeFooterRow,
  setColumnAgg,
} from './ops';
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
