import type { ViewSpec } from '../../../src';

// light-dark() adapts to the table's color-scheme automatically.
const green = 'light-dark(#137333, #30d158)';
const red = 'light-dark(#c5221f, #ff453a)';

const money = { kind: ['price'], siUnit: ['dollar'] };

/**
 * Flat detail table: composite asset column, computed P/L, sign coloring.
 *
 * `data.json` here is a plain row array — the typical case, where the data
 * comes from somewhere that knows nothing about presentation — so the column
 * metadata is declared in the view instead and layered on at load. From it the
 * headers and the 2-decimal money format are both deduced; the `$` itself comes
 * from the unit placement, which is why no column names `currency`.
 *
 * Columns with neither `compute` nor `composite` omit `source`: it defaults to
 * the column id.
 */
export const view: ViewSpec = {
  mode: 'flat',
  meta: {
    symbol: { displayName: 'Symbol' },
    description: { displayName: 'Asset' },
    price: { displayName: 'Price', ...money },
    basePrice: { displayName: 'Base', ...money },
  },
  columns: [
    {
      id: 'asset',
      label: 'Asset',
      // Composite: image + description in one cell, sorted by description.
      composite: { fields: ['image', 'description'], sortKey: 'description' },
    },
    {
      id: 'symbol',
      style: {
        name: 'static',
        options: {
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          letterSpacing: '0.02em',
        },
      },
    },
    { id: 'price' },
    { id: 'basePrice' },
    {
      id: 'plChange',
      // No '$' in the label — the unit comes from the metadata.
      label: 'P/L',
      compute: 'price - basePrice',
      // A computed column has no source field, so it declares its own unit.
      meta: money,
      format: {
        name: 'number',
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
      // A ratio, not a stored percentage: `percent` scales it by 100 and prints
      // its own sign, so this one keeps an explicit self-contained format.
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
