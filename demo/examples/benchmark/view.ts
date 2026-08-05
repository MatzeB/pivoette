import type { ViewSpec } from '../../../src';

/** Aggregated pivot: 3-level columns, four measures, duration formatting. */
export const view: ViewSpec = {
  // The rows carry no metadata, so the view says what the numbers are: `timeNs`
  // holds nanoseconds. That is the point the ladder scales *from*.
  meta: {
    timeNs: { kind: ['duration'], unit: ['second'], scale: ['nano'] },
  },
  pivotRows: [{ field: 'benchmark', label: 'Benchmark' }],
  pivotColumns: [
    { field: 'dataSize', label: 'Size' },
    { field: 'architecture', label: 'Arch' },
  ],
  columns: [
    // One scale across all three, so a row cannot end up half in ns and half
    // in µs — which is the whole reason `scalePool` exists.
    {
      id: 'mean',
      source: 'timeNs',
      agg: 'mean',
      label: 'mean',
      autoScale: true,
      scalePool: 'benchtimes',
    },
    {
      id: 'min',
      source: 'timeNs',
      agg: 'min',
      label: 'min',
      autoScale: true,
      scalePool: 'benchtimes',
    },
    {
      id: 'max',
      source: 'timeNs',
      agg: 'max',
      label: 'max',
      autoScale: true,
      scalePool: 'benchtimes',
    },
    {
      id: 'variance',
      source: 'timeNs',
      agg: 'variance',
      label: 'var',
      meta: {
        kind: ['duration', 'duration'],
        unit: ['second', 'second'],
        scale: ['nano', 'nano'],
      },
      // `±` qualifies the value rather than naming what it is measured in, so
      // it stays on the number while `ns²` follows the placement toggle.
      format: { options: { decimals: 0, prefix: '± ' } },
    },
  ],
};
