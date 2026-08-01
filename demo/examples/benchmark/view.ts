import type { ViewSpec } from '../../../src';

/** Aggregated pivot: 3-level columns, four measures, duration formatting. */
export const view: ViewSpec = {
  rows: ['benchmark'],
  columns: ['dataSize', 'architecture'],
  labels: { benchmark: 'Benchmark', dataSize: 'Size', architecture: 'Arch' },
  values: [
    {
      id: 'mean',
      field: 'timeNs',
      agg: 'mean',
      label: 'mean',
      format: { name: 'duration' },
    },
    {
      id: 'min',
      field: 'timeNs',
      agg: 'min',
      label: 'min',
      format: { name: 'duration' },
    },
    {
      id: 'max',
      field: 'timeNs',
      agg: 'max',
      label: 'max',
      format: { name: 'duration' },
    },
    {
      id: 'variance',
      field: 'timeNs',
      agg: 'variance',
      label: '± var',
      // Variance is in ns² — deliberately NOT duration-scaled.
      format: { name: 'number', options: { decimals: 0, prefix: '± ' } },
    },
  ],
};
