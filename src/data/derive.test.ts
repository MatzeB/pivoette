import { describe, expect, it } from 'vitest';
import { fromDataset, fromRows } from './import';
import { deriveColumns } from './derive';
import { computeView } from '../pivot/engine';
import type { PivotSpec } from '../pivot/spec';

const rows = [
  { at: '2026-03-14T23:00:00Z', who: 'a', n: 1 }, // Sat UTC / Sun Tokyo
  { at: '2026-03-16T09:00:00Z', who: 'a', n: 2 }, // Mon
  { at: '2026-03-16T10:00:00Z', who: 'b', n: 4 }, // Mon
];
const dataset = { meta: { at: { encoding: 'rfc3339' } }, rows };

describe('deriveColumns', () => {
  it('adds a typed column with normalized metadata', () => {
    const f = deriveColumns(
      fromDataset(dataset),
      { wd: { compute: 'weekday(at)', meta: { kind: ['weekday'] } } },
      'en-US',
      'UTC',
    );
    const col = f.columnByName.get('wd')!;
    expect(col.type).toBe('int');
    expect(col.values).toEqual([6, 1, 1]); // Sat, Mon, Mon (Sunday-first)
    expect(col.meta.kind).toEqual(['weekday']);
    expect(col.meta.dataName).toBe('wd');
  });

  it('decodes a declared timestamp once, so the helper gets millis', () => {
    const f = deriveColumns(
      fromDataset(dataset),
      { ms: { compute: 'at' } }, // the raw field, as the expression sees it
      'en-US',
      'UTC',
    );
    expect(f.columnByName.get('ms')!.values[0]).toBe(
      Date.parse('2026-03-14T23:00:00Z'),
    );
  });

  it('leaves an undeclared column as its raw value', () => {
    const f = deriveColumns(fromRows(rows), { ms: { compute: 'at' } });
    expect(f.columnByName.get('ms')!.values[0]).toBe('2026-03-14T23:00:00Z');
  });

  it('evaluates in declaration order', () => {
    const f = deriveColumns(
      fromDataset(dataset),
      {
        wd: { compute: 'weekday(at)' },
        twice: { compute: 'wd * 2' },
      },
      'en-US',
      'UTC',
    );
    expect(f.columnByName.get('twice')!.values).toEqual([12, 2, 2]);
  });

  it('lets a source field shadow a helper of the same name', () => {
    const f = deriveColumns(
      fromRows([{ weekday: 42 }]),
      { copy: { compute: 'weekday' } },
      'en-US',
      'UTC',
    );
    // The column wins; `new Function` is not handed a duplicate parameter.
    expect(f.columnByName.get('copy')!.values).toEqual([42]);
  });
});

describe('computeView prepares its own frame', () => {
  const spec: PivotSpec = {
    derive: { wd: { compute: 'weekday(at)', meta: { kind: ['weekday'] } } },
    timeZone: 'UTC',
    locale: 'en-US',
    rows: ['who'],
    columns: ['wd'],
    columnSort: [{ field: 'wd', direction: 'asc' }],
    values: [{ id: 's', field: 'n', agg: 'sum', label: 'n' }],
  };

  it('applies derive and meta without the component', () => {
    const res = computeView(fromDataset(dataset), spec);
    // Weekday members render as names, in calendar order.
    expect(res.leaves.map((l) => l.colPath[0])).toEqual(['Mon', 'Sat']);
  });

  it('re-groups when the zone moves an instant to another day', () => {
    const utc = computeView(fromDataset(dataset), spec);
    const tokyo = computeView(fromDataset(dataset), {
      ...spec,
      timeZone: 'Asia/Tokyo',
    });
    expect(utc.leaves.map((l) => l.colPath[0])).toEqual(['Mon', 'Sat']);
    expect(tokyo.leaves.map((l) => l.colPath[0])).toEqual(['Sun', 'Mon']);
  });

  it('renames and re-orders members with the locale', () => {
    const de = computeView(fromDataset(dataset), { ...spec, locale: 'de-DE' });
    expect(de.leaves.map((l) => l.colPath[0])).toEqual(['Mo', 'Sa']);
  });

  it('formats row members too, and leaves plain fields alone', () => {
    const res = computeView(fromDataset(dataset), {
      ...spec,
      rows: ['wd'],
      columns: [],
    });
    expect(res.rowMemberFormats[0]!(1)).toBe('Mon');
    // `who` has no deduced format, so it stays as-is.
    const plain = computeView(fromDataset(dataset), spec);
    expect(plain.rowMemberFormats[0]!('a')).toBe('a');
  });
});
