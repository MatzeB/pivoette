import { Style } from '../../../src';
import type { ViewSpec } from '../../../src';

// light-dark() adapts to the table's color-scheme automatically.
const green = 'light-dark(#137333, #30d158)';
const red = 'light-dark(#c5221f, #ff453a)';

const dollar = { kind: ['price'], unit: ['dollar'] };

/**
 * Flat detail table: composite asset column, computed P/L, sign coloring.
 *
 * `data.json` here is a plain row array — the typical case, where the data
 * comes from somewhere that knows nothing about presentation — so the column
 * metadata is declared in the view instead and layered on at load. From it the
 * headers and the 2-decimal dollar format are both deduced; the `$` itself comes
 * from the unit placement rather than from any currency formatter.
 *
 * Columns with neither `compute` nor `composite` omit `source`: it defaults to
 * the column id.
 */
export const view: ViewSpec = {
  mode: 'flat',
  meta: {
    symbol: { displayName: 'Symbol' },
    description: { displayName: 'Asset' },
    price: { displayName: 'Price', ...dollar },
    basePrice: { displayName: 'Base', ...dollar },
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
        fnName: Style.Static,
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
      meta: dollar,
      // Only the sign is overridden; the built-in and its 2 decimals both
      // come from kind `price`.
      format: { options: { signDisplay: 'exceptZero' } },
      style: {
        fnName: Style.SignColors,
        options: { positive: green, negative: red },
      },
    },
    {
      id: 'plPercent',
      label: 'Return',
      // The *compute* yields percentage points (5.23, not 0.0523) — scale
      // metadata is a label and never transforms a number, so a `%` on a ratio
      // would read "0.05%". With the value already in points, `scale: percent`
      // is pure annotation and the toggle can move it, exactly like the
      // metrics example's `cpu` column.
      compute: 'basePrice ? ((price - basePrice) / basePrice) * 100 : null',
      // Unitless: the `%` scale is the whole unit.
      meta: { scale: ['percent'] },
      // Likewise: 1 decimal is deduced from kind `percentage`.
      format: { options: { signDisplay: 'exceptZero' } },
      style: {
        fnName: Style.SignColors,
        options: { positive: green, negative: red },
      },
    },
  ],
  sort: [{ field: 'asset', direction: 'asc' }],
};
