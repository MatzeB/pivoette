import type { ColumnDef, DataTableDisplay, ViewSpec } from '../../../src';

/** A field's geomean — the bar — and its min and max, the whisker across it. */
function measured(field: string, name: string): ColumnDef[] {
  const format = { options: { decimals: 2 } };
  return [
    { id: field, agg: 'geomean', label: name, format },
    {
      id: `${field}Min`,
      source: field,
      agg: 'min',
      label: `${name} min`,
      format,
    },
    {
      id: `${field}Max`,
      source: field,
      agg: 'max',
      label: `${name} max`,
      format,
    },
  ];
}

/**
 * FooCC and BarCC, each built three ways, against BarCC at -O2: a pivot view
 * drawn as bars.
 *
 * The view is an ordinary pivot, the same one a table would be computed from:
 * suites down the rows, compilers and their builds across the columns, and
 * three measures each of two per-benchmark speedups in every cell: in
 * instructions retired (`ir`) and in cycles. Switch the display to a table in the
 * editor and that is exactly what it shows.
 *
 * - `geomean` is each suite's average speedup — the right average for ratios,
 *   where 2× and 0.5× come out at 1×. It is drawn as the bar.
 * - `min` and `max` are the slowest and fastest benchmark in the suite. As
 *   measures of spread they default to a whisker across the bar, so a suite
 *   whose average hides a regression shows it.
 */
export const view: ViewSpec = {
  pivotRows: [{ field: 'suite', label: 'Suite' }],
  pivotColumns: [
    { field: 'compiler', label: 'Compiler' },
    { field: 'variant', label: 'Build' },
  ],
  // Each field measured three ways. Two fields under bars split the chart
  // into a panel each, side by side; the min and max go with their own
  // field's bar as its whisker.
  columns: [...measured('ir', 'ir'), ...measured('cycles', 'cycles')],
};

/**
 * Drawn as a chart. Every value is a speedup over BarCC -O2, so the bars grow
 * from 1.0 — right for faster, left for slower — and `symmetric` keeps 1.0 in
 * the middle. BarCC's own base build is that reference, so its bar has no
 * length: it is the line the others are measured from.
 *
 * `nested` colours: the compiler picks the hue and the build its shade, pale
 * to full in the order the builds add their steps. That order is the one the
 * rows arrive in, which the pivot keeps; the Bar order list in the editor
 * changes it.
 */
export const display: DataTableDisplay = {
  as: 'chart',
  chart: {
    baseline: 1,
    symmetric: true,
    colors: 'nested',
  },
  frameless: true,
  zebra: true,
};
