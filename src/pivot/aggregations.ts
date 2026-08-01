/**
 * Aggregation registry. Each reducer applies its own null policy (skipna by
 * default, matching pandas). Numeric reducers ignore non-numeric values.
 */
import type { CellValue } from '../data/types';

export type Reducer = (values: CellValue[]) => CellValue;

export interface Aggregation {
  id: string;
  label: string;
  reduce: Reducer;
}

/** Non-null values (any type), preserving order. */
function nonNull(values: CellValue[]): CellValue[] {
  return values.filter((v) => v !== null && v !== undefined);
}

/** Finite numbers only (nulls and non-numeric values dropped). */
function numbers(values: CellValue[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function sum(ns: number[]): number {
  let s = 0;
  for (const n of ns) s += n;
  return s;
}

function mean(ns: number[]): number | null {
  return ns.length === 0 ? null : sum(ns) / ns.length;
}

/** Population variance (divide by n). */
function variance(ns: number[]): number | null {
  if (ns.length === 0) return null;
  const m = sum(ns) / ns.length;
  let acc = 0;
  for (const n of ns) acc += (n - m) * (n - m);
  return acc / ns.length;
}

/** Linear-interpolated quantile over a sorted array. */
function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0]!;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - pos) + sorted[hi]! * (pos - lo);
}

function percentile(q: number): Reducer {
  return (values) => {
    const ns = numbers(values);
    if (ns.length === 0) return null;
    ns.sort((a, b) => a - b);
    return quantileSorted(ns, q);
  };
}

const registry = new Map<string, Aggregation>();

function register(id: string, label: string, reduce: Reducer): void {
  registry.set(id, { id, label, reduce });
}

register('sum', 'Sum', (v) => sum(numbers(v)));
register('count', 'Count', (v) => nonNull(v).length);
register('countDistinct', 'Distinct', (v) => new Set(nonNull(v)).size);
register('min', 'Min', (v) => {
  const ns = numbers(v);
  return ns.length === 0 ? null : Math.min(...ns);
});
register('max', 'Max', (v) => {
  const ns = numbers(v);
  return ns.length === 0 ? null : Math.max(...ns);
});
register('mean', 'Mean', (v) => mean(numbers(v)));
register('variance', 'Variance', (v) => variance(numbers(v)));
register('std', 'Std dev', (v) => {
  const va = variance(numbers(v));
  return va === null ? null : Math.sqrt(va);
});
register('median', 'Median', percentile(0.5));
register('p25', 'P25', percentile(0.25));
register('p50', 'P50', percentile(0.5));
register('p75', 'P75', percentile(0.75));
register('first', 'First', (v) => {
  const nn = nonNull(v);
  return nn.length === 0 ? null : nn[0]!;
});
register('last', 'Last', (v) => {
  const nn = nonNull(v);
  return nn.length === 0 ? null : nn[nn.length - 1]!;
});

// `avg` is an alias for `mean`.
registry.set('avg', { ...registry.get('mean')!, id: 'avg' });

export function getAggregation(id: string): Aggregation {
  const agg = registry.get(id);
  if (!agg) {
    throw new Error(
      `Unknown aggregation "${id}". Known: ${[...registry.keys()].join(', ')}`,
    );
  }
  return agg;
}

export function registerAggregation(
  id: string,
  label: string,
  reduce: Reducer,
): void {
  register(id, label, reduce);
}

export function aggregationIds(): string[] {
  return [...registry.keys()];
}
