import type { ViewSpec } from '../../../src';

// light-dark() adapts to the table's color-scheme automatically.
const green = 'light-dark(#137333, #30d158)';
const red = 'light-dark(#c5221f, #ff453a)';

/** Flat detail table: composite asset column, computed P/L, sign coloring. */
export const view: ViewSpec = {
  mode: 'flat',
  columns: [
    {
      id: 'asset',
      label: 'Asset',
      // Composite: image + description in one cell, sorted by description.
      composite: { fields: ['image', 'description'], sortKey: 'description' },
    },
    { id: 'symbol', label: 'Symbol', source: 'symbol' },
    {
      id: 'price',
      label: 'Price',
      source: 'price',
      format: { name: 'currency', options: { decimals: 2 } },
    },
    {
      id: 'basePrice',
      label: 'Base',
      source: 'basePrice',
      format: { name: 'currency', options: { decimals: 2 } },
    },
    {
      id: 'plChange',
      label: 'P/L $',
      compute: 'price - basePrice',
      format: {
        name: 'currency',
        options: { decimals: 2, signDisplay: 'exceptZero' },
      },
      style: {
        name: 'signColors',
        options: { positive: green, negative: red },
      },
    },
    {
      id: 'plPercent',
      label: 'P/L %',
      compute: 'basePrice ? (price - basePrice) / basePrice : null',
      format: {
        name: 'percent',
        options: { decimals: 2, signDisplay: 'exceptZero' },
      },
      style: {
        name: 'signColors',
        options: { positive: green, negative: red },
      },
    },
  ],
  sort: [{ field: 'asset', direction: 'asc' }],
};
