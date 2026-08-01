import type { ViewSpec } from '../../../src';

// light-dark() adapts to the table's color-scheme automatically.
const green = 'light-dark(#137333, #30d158)';
const red = 'light-dark(#c5221f, #ff453a)';

/**
 * Pivot with a per-platform derived Δ% column. Δ% references its own platform's
 * before/after cells (relative colPath); coloring is domain-inverted — faster
 * (negative) is green, a regression (positive) is red.
 */
export const view: ViewSpec = {
  rows: ['app'],
  columns: ['platform', 'revision'],
  labels: { app: 'Application' },
  values: [
    {
      id: 'mean',
      field: 'timeNs',
      agg: 'mean',
      label: 'mean',
      format: { name: 'duration' },
    },
  ],
  computed: [
    {
      id: 'delta',
      label: 'Δ%',
      repeatPer: ['platform'],
      inputs: {
        before: { colPath: ['before'], value: 'mean' },
        after: { colPath: ['after'], value: 'mean' },
      },
      compute: 'before ? (after - before) / before : null',
      place: { after: 'after' },
      format: {
        name: 'percent',
        options: { decimals: 1, signDisplay: 'exceptZero' },
      },
      style: {
        name: 'signColors',
        options: { negative: green, positive: red },
      },
    },
  ],
};
