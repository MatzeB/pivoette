import { Format } from '../../../src';
import type { ViewSpec } from '../../../src';

/** Multi-level rows (team > project > model), compact tokens, summary footer. */
export const view: ViewSpec = {
  rows: ['team', 'project', 'model'],
  columns: [],
  labels: { team: 'Team', project: 'Project', model: 'Model' },
  values: [
    {
      id: 'input',
      field: 'inputTokens',
      agg: 'sum',
      label: 'Input',
      format: { fnName: Format.Number, options: { compact: true } },
    },
    {
      id: 'output',
      field: 'outputTokens',
      agg: 'sum',
      label: 'Output',
      format: { fnName: Format.Number, options: { compact: true } },
    },
    {
      id: 'cached',
      field: 'cachedTokens',
      agg: 'sum',
      label: 'Cached',
      format: { fnName: Format.Number, options: { compact: true } },
    },
    {
      id: 'price',
      field: 'costUsd',
      agg: 'sum',
      label: 'Price',
      format: { fnName: Format.Currency, options: { decimals: 2 } },
    },
  ],
  computed: [
    {
      id: 'total',
      label: 'Total',
      inputs: {
        input: { colPath: [], value: 'input' },
        output: { colPath: [], value: 'output' },
        cached: { colPath: [], value: 'cached' },
      },
      compute: 'input + output + cached',
      format: { fnName: Format.Number, options: { compact: true } },
    },
  ],
  showSummary: true,
};
