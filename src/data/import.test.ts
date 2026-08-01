import { describe, expect, it } from 'vitest';
import { fromRows } from './import';

describe('fromRows', () => {
  it('unions keys in first-seen order and fills missing with null', () => {
    const f = fromRows([
      { a: 1, b: 'x' },
      { b: 'y', c: true },
    ]);
    expect(f.columns.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    expect(f.length).toBe(2);
    expect(f.columnByName.get('a')!.values).toEqual([1, null]);
    expect(f.columnByName.get('c')!.values).toEqual([null, true]);
  });

  it('infers int / float / string / json', () => {
    const f = fromRows([
      { i: 1, fl: 1.5, s: 'a', j: { k: 1 } },
      { i: 2, fl: 2, s: 'b', j: [1, 2] },
    ]);
    expect(f.columnByName.get('i')!.type).toBe('int');
    expect(f.columnByName.get('fl')!.type).toBe('float');
    expect(f.columnByName.get('s')!.type).toBe('string');
    expect(f.columnByName.get('j')!.type).toBe('json');
  });

  it('treats an all-null column as string and ignores nulls in inference', () => {
    const f = fromRows([{ x: null, y: 3 }, { y: null }]);
    expect(f.columnByName.get('x')!.type).toBe('string');
    expect(f.columnByName.get('y')!.type).toBe('int');
    expect(f.columnByName.get('y')!.values).toEqual([3, null]);
  });
});
