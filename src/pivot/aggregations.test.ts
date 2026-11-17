import { describe, expect, it } from 'vitest';
import { SEVERAL, getAggregation } from './aggregations';

const reduce = (id: string, values: unknown[]) =>
  getAggregation(id).reduce(values as never);

describe('aggregations', () => {
  it('skips nulls (skipna) for numeric reducers', () => {
    const v = [1, null, 3, null, 5];
    expect(reduce('sum', v)).toBe(9);
    expect(reduce('mean', v)).toBe(3);
    expect(reduce('min', v)).toBe(1);
    expect(reduce('max', v)).toBe(5);
    expect(reduce('count', v)).toBe(3);
  });

  it('avg is an alias of mean', () => {
    expect(reduce('avg', [2, 4])).toBe(reduce('mean', [2, 4]));
  });

  it('countDistinct counts unique non-null values', () => {
    expect(reduce('countDistinct', ['a', 'a', 'b', null, 'b', 'c'])).toBe(3);
  });

  it('median / percentiles interpolate', () => {
    expect(reduce('median', [1, 2, 3, 4])).toBe(2.5);
    expect(reduce('p25', [1, 2, 3, 4, 5])).toBe(2);
    expect(reduce('p75', [1, 2, 3, 4, 5])).toBe(4);
  });

  it('geomean averages ratios so opposite factors cancel', () => {
    expect(reduce('geomean', [2, 0.5])).toBeCloseTo(1, 12);
    expect(reduce('geomean', [1, 4, null, 'x'])).toBeCloseTo(2, 12);
    expect(reduce('geomean', [])).toBeNull();
    // Undefined for non-positive values, rather than quietly skipping them.
    expect(reduce('geomean', [1.1, 0])).toBeNull();
    expect(reduce('geomean', [1.1, -1])).toBeNull();
  });

  it('population variance and std', () => {
    // values 2,4,4,4,5,5,7,9 -> mean 5, variance 4, std 2
    const v = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(reduce('variance', v)).toBe(4);
    expect(reduce('std', v)).toBe(2);
  });

  it('first / last preserve value (and type)', () => {
    expect(reduce('first', ['x', 'y', 'z'])).toBe('x');
    expect(reduce('last', ['x', 'y', 'z'])).toBe('z');
    expect(reduce('first', [null, 'a'])).toBe('a');
  });

  it('returns null for empty numeric groups, 0 for counts', () => {
    expect(reduce('mean', [null, null])).toBeNull();
    expect(reduce('count', [null, null])).toBe(0);
  });
});

describe('only', () => {
  const only = getAggregation('only').reduce;
  it('passes one value through, and flags disagreement', () => {
    expect(only([3])).toBe(3);
    expect(only(['a', null, 'a'])).toBe('a');
    expect(only([])).toBeNull();
    expect(only([1, 2])).toBe(SEVERAL);
  });
});
