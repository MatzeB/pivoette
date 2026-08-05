import { Format } from '../../../src';
import type { ViewSpec } from '../../../src';

/** Multi-level rows (team > project > model), compact tokens, summary footer. */
export const view: ViewSpec = {
  pivotRows: [
    { field: 'team', label: 'Team' },
    { field: 'project', label: 'Project' },
    { field: 'model', label: 'Model' },
  ],
  // The money column takes its 2 decimals from kind `price`; the `$` itself
  // comes from the unit placement. The token counts declare their unit too, so
  // `tok` follows the same placement — the short form is deduced.
  meta: {
    costUsd: { kind: ['price'], unit: ['dollar'] },
    inputTokens: { unit: ['token'] },
    outputTokens: { unit: ['token'] },
    cachedTokens: { unit: ['token'] },
  },
  columns: [
    {
      id: 'input',
      source: 'inputTokens',
      agg: 'sum',
      label: 'Input',
      format: { fnName: Format.Number, options: { compact: true } },
    },
    {
      id: 'output',
      source: 'outputTokens',
      agg: 'sum',
      label: 'Output',
      format: { fnName: Format.Number, options: { compact: true } },
    },
    {
      id: 'cached',
      source: 'cachedTokens',
      agg: 'sum',
      label: 'Cached',
      format: { fnName: Format.Number, options: { compact: true } },
    },
    {
      id: 'price',
      source: 'costUsd',
      agg: 'sum',
      label: 'Price',
    },
    {
      id: 'total',
      label: 'Total',
      inputs: {
        input: { colPath: [], column: 'input' },
        output: { colPath: [], column: 'output' },
        cached: { colPath: [], column: 'cached' },
      },
      compute: 'input + output + cached',
      meta: { unit: ['token'] },
      format: { fnName: Format.Number, options: { compact: true } },
    },
  ],
  showSummary: true,
};
