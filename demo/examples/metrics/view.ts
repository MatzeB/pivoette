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
    { id: 'memory', source: 'memory', format: { name: 'number' } },
    {
      id: 'latency',
      source: 'latency',
      format: { name: 'number', options: { decimals: 2 } },
    },
    {
      id: 'cpu',
      source: 'cpu',
      format: { name: 'number', options: { decimals: 1 } },
    },
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
