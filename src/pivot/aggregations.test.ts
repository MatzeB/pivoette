import { describe, expect, it } from 'vitest';
import { getAggregation } from './aggregations';

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
