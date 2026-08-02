import { describe, expect, it } from 'vitest';
import {
  addField,
  addFooterRow,
  addValue,
  moveField,
  moveValue,
  removeField,
  removeFooterRow,
  removeValue,
  setValueAgg,
} from './ops';
import type { PivotSpec, TableSpec, ViewSpec } from '../pivot/spec';

const base: PivotSpec = {
  rows: ['team', 'author'],
  columns: ['weekday'],
  values: [
    { id: 'added', field: 'linesAdded', agg: 'sum', label: '+' },
    { id: 'removed', field: 'linesRemoved', agg: 'sum', label: '−' },
  ],
};

/** Narrow back to a pivot for assertions. */
const p = (spec: ViewSpec) => spec as PivotSpec;

describe('grouping fields', () => {
  it('appends to the named axis', () => {
    expect(p(addField(base, 'columns', 'month')).columns).toEqual([
      'weekday',
      'month',
    ]);
    expect(p(addField(base, 'rows', 'month')).rows).toEqual([
      'team',
      'author',
      'month',
    ]);
  });

  it('ignores a field already placed on either axis', () => {
    expect(addField(base, 'columns', 'author')).toBe(base);
    expect(addField(base, 'rows', 'weekday')).toBe(base);
  });

  it('removes by position', () => {
    expect(p(removeField(base, 'rows', 0)).rows).toEqual(['author']);
    expect(removeField(base, 'rows', 5)).toBe(base);
  });

  it('prunes a sort entry whose field left the axis', () => {
    const sorted: PivotSpec = {
      ...base,
      rowSort: [{ field: 'team' }, { field: 'author' }],
    };
    expect(p(removeField(sorted, 'rows', 0)).rowSort).toEqual([
      { field: 'author' },
    ]);
  });

  it('reorders within an axis', () => {
    const moved = moveField(
      base,
      { zone: 'rows', index: 1 },
      { zone: 'rows', index: 0 },
    );
    expect(p(moved).rows).toEqual(['author', 'team']);
  });

  it('clamps a drop past the end', () => {
    const moved = moveField(
      base,
      { zone: 'rows', index: 0 },
      { zone: 'rows', index: 9 },
    );
    expect(p(moved).rows).toEqual(['author', 'team']);
  });

  it('pivots a field from one axis to the other', () => {
    const moved = p(
      moveField(
        base,
        { zone: 'rows', index: 1 },
        { zone: 'columns', index: 0 },
      ),
    );
    expect(moved.rows).toEqual(['team']);
    expect(moved.columns).toEqual(['author', 'weekday']);
  });

  it('prunes the source axis sort when a field pivots away', () => {
    const sorted: PivotSpec = { ...base, rowSort: [{ field: 'author' }] };
    const moved = p(
      moveField(
        sorted,
        { zone: 'rows', index: 1 },
        { zone: 'columns', index: 0 },
      ),
    );
    expect(moved.rowSort).toEqual([]);
  });

  it('is a no-op for an empty position', () => {
    expect(
      moveField(
        base,
        { zone: 'columns', index: 4 },
        { zone: 'rows', index: 0 },
      ),
    ).toBe(base);
  });
});

describe('measures', () => {
  it('derives an id from the aggregation and field', () => {
    const next = p(addValue(base, 'linesAdded', 'mean'));
    expect(next.values.at(-1)).toMatchObject({
      id: 'mean_linesAdded',
      field: 'linesAdded',
      agg: 'mean',
    });
  });

  it('keeps the derived id unique', () => {
    const once = addValue(base, 'linesAdded', 'mean');
    const twice = p(addValue(once, 'linesAdded', 'mean'));
    expect(twice.values.map((v) => v.id)).toContain('mean_linesAdded');
    expect(twice.values.map((v) => v.id)).toContain('mean_linesAdded_2');
  });

  it('removes by position but never empties the list', () => {
    expect(p(removeValue(base, 0)).values.map((v) => v.id)).toEqual([
      'removed',
    ]);
    const one = p(removeValue(base, 0));
    // Nothing left to aggregate, so the last one stays.
    expect(removeValue(one, 0)).toBe(one);
  });

  it('changes an aggregation without touching the rest', () => {
    const next = p(setValueAgg(base, 0, 'mean'));
    expect(next.values[0]).toEqual({ ...base.values[0], agg: 'mean' });
    expect(next.values[1]).toBe(base.values[1]);
  });

  it('reorders', () => {
    expect(p(moveValue(base, 1, 0)).values.map((v) => v.id)).toEqual([
      'removed',
      'added',
    ]);
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
  const flat: TableSpec = { mode: 'flat', columns: [{ id: 'a' }] };

  it('are left alone by the pivot-only operations', () => {
    expect(addField(flat, 'rows', 'x')).toBe(flat);
    expect(removeField(flat, 'rows', 0)).toBe(flat);
    expect(addValue(flat, 'x', 'sum')).toBe(flat);
    expect(
      moveField(
        flat,
        { zone: 'rows', index: 0 },
        { zone: 'columns', index: 0 },
      ),
    ).toBe(flat);
  });
});

describe('serializability', () => {
  it('survives every operation', () => {
    let spec: ViewSpec = base;
    spec = addField(spec, 'columns', 'month');
    spec = moveField(
      spec,
      { zone: 'rows', index: 0 },
      { zone: 'columns', index: 0 },
    );
    spec = addValue(spec, 'linesAdded', 'mean');
    spec = setValueAgg(spec, 0, 'max');
    spec = removeValue(spec, 1);
    // The property the editor exists to preserve.
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });

  it('never mutates the input', () => {
    const before = JSON.parse(JSON.stringify(base)) as PivotSpec;
    addField(base, 'rows', 'month');
    moveField(base, { zone: 'rows', index: 0 }, { zone: 'columns', index: 0 });
    removeValue(base, 0);
    expect(base).toEqual(before);
  });
});

describe('inserting a field at a position', () => {
  it('places it where asked', () => {
    expect(p(addField(base, 'rows', 'month', 0)).rows).toEqual([
      'month',
      'team',
      'author',
    ]);
    expect(p(addField(base, 'rows', 'month', 1)).rows).toEqual([
      'team',
      'month',
      'author',
    ]);
  });

  it('appends without a position, and clamps a silly one', () => {
    expect(p(addField(base, 'rows', 'month')).rows.at(-1)).toBe('month');
    expect(p(addField(base, 'rows', 'month', 99)).rows.at(-1)).toBe('month');
    expect(p(addField(base, 'rows', 'month', -3)).rows[0]).toBe('month');
  });
});
