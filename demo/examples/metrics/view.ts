import type { ViewSpec } from '../../../src';

/**
 * Flat detail table driven by column metadata. No `label` is set on any column
 * — the headers come from each field's `displayName` — and no unit text is
 * baked into the formats: the `MB` / `ms` / `%` / `ktok/s` / `MB/s` / `m²`
 * labels are composed from the metadata and placed by the demo's unit toggles.
 */
export const view: ViewSpec = {
  mode: 'flat',
  columns: [
    { id: 'host', source: 'host' },
    { id: 'region', source: 'region' },
    // MiB values run to five digits — no fraction needed.
    { id: 'memory', source: 'memory', format: { name: 'integer' } },
    {
      id: 'latency',
      source: 'latency',
      format: { name: 'number', options: { decimals: 2 } },
    },
    // No format: kind `percentage` implies 1 decimal.
    { id: 'cpu' },
    {
      id: 'throughput',
      source: 'throughput',
      format: { name: 'number', options: { decimals: 2 } },
    },
    {
      id: 'bandwidth',
      source: 'bandwidth',
      format: { name: 'number', options: { decimals: 1 } },
    },
    {
      id: 'floorArea',
      source: 'floorArea',
      format: { name: 'number', options: { decimals: 2 } },
    },
  ],
  sort: [{ field: 'host', direction: 'asc' }],
};
