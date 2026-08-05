import { Format } from '../../../src';
import type { ViewSpec } from '../../../src';

/**
 * Flat detail table driven by column metadata. No `label` is set on any column
 * — the headers come from each field's `displayName` — and no unit text is
 * baked into the formats: the `MB` / `ms` / `%` / `ktok/s` / `MB/s` / `m²`
 * labels are composed from the metadata and placed by the demo's unit toggles.
 */
export const view: ViewSpec = {
  // No axes and no `agg`: this is a flat table, one row per source row.
  columns: [
    { id: 'host' },
    { id: 'region' },
    // MiB values run to five digits — no fraction needed.
    { id: 'memory', format: { fnName: Format.Integer } },
    {
      id: 'latency',
      format: { fnName: Format.Number, options: { decimals: 2 } },
    },
    // No format: kind `percentage` implies 1 decimal.
    { id: 'cpu' },
    {
      id: 'throughput',
      format: { fnName: Format.Number, options: { decimals: 2 } },
    },
    {
      id: 'bandwidth',
      format: { fnName: Format.Number, options: { decimals: 1 } },
    },
    {
      id: 'floorArea',
      format: { fnName: Format.Number, options: { decimals: 2 } },
    },
  ],
  sort: [{ field: 'host', direction: 'asc' }],
};
