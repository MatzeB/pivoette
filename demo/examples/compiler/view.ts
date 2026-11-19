import type {
  ColumnDef,
  DataTableDisplay,
  FlagSpec,
  ViewSpec,
} from '../../../src';

/**
 * A field's geomean — the bar — and the five numbers of its box plot: min,
 * the quartiles, the median, and max.
 */
function measured(field: string, name: string): ColumnDef[] {
  const format = { options: { decimals: 2 } };
  const spread = (suffix: string, agg: string, what: string): ColumnDef => ({
    id: `${field}${suffix}`,
    source: field,
    agg,
    label: `${name} ${what}`,
    format,
  });
  return [
    { id: field, agg: 'geomean', label: name, format },
    spread('Min', 'min', 'min'),
    spread('P25', 'p25', 'p25'),
    spread('Median', 'median', 'median'),
    spread('P75', 'p75', 'p75'),
    spread('Max', 'max', 'max'),
  ];
}

/** The spread measures, which only a box plot draws. */
const SPREAD = ['Min', 'P25', 'Median', 'P75', 'Max'];

/**
 * FooCC and BarCC, each built three ways, against BarCC at -O2: a pivot view
 * drawn as bars.
 *
 * The view is an ordinary pivot, the same one a table would be computed from:
 * suites down the rows, compilers and their builds across the columns, and
 * six measures each of two per-benchmark speedups in every cell: in
 * instructions retired (`ir`) and in cycles. Switch the display to a table in the
 * editor and that is exactly what it shows.
 *
 * - `geomean` is each suite's average speedup — the right average for ratios,
 *   where 2× and 0.5× come out at 1×. It is drawn as the bar.
 * - `min`, `p25`, `median`, `p75` and `max` are the five numbers of a box
 *   plot: the slowest and fastest benchmark in the suite, and the quartiles
 *   and median between them. The bar chart only reads them out on hover; the
 *   box plot draws them, so a suite whose average hides a regression shows
 *   it.
 */
export const view: ViewSpec = {
  pivotRows: [{ field: 'suite', label: 'Suite' }],
  pivotColumns: [
    { field: 'compiler', label: 'Compiler' },
    { field: 'variant', label: 'Build' },
  ],
  // Each field measured six ways. Two fields under bars split the chart
  // into a panel each, side by side; the spread goes with its own field's
  // bar.
  columns: [...measured('ir', 'Instructions'), ...measured('cycles', 'Cycles')],
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
    // As bars, the spread is only read out on hover. `plot: 'boxes'` draws
    // it, and the demo's box plot checkbox sets that and drops these.
    marks: Object.fromEntries(
      ['ir', 'cycles'].flatMap((f) => SPREAD.map((s) => [f + s, 'none'])),
    ),
  },
  frameless: true,
  zebra: true,
};

/**
 * The benchmarks behind each bar: one row per benchmark and build, FooCC only,
 * flat rather than pivoted — nothing is aggregated, so every number is one
 * measurement.
 *
 * Two cell renderers do the work a chart would:
 *
 * - `Render.Bar` draws each speedup's mini-bar beside it, growing from a tick
 *   at 1.0: right and green for faster than BarCC -O2, left and orange for
 *   slower, full at ±25%. The number keeps the ink colour inside ±2%, where a
 *   difference is real but not worth shouting about.
 * - `Render.Flags` is a column of chips, one per condition the row meets. A
 *   flag is data — a label, a condition over the row's fields, a tone, and a
 *   tooltip saying why — so hovering a chip says what raised it.
 */
const bar = {
  fnName: 'bar',
  options: { center: 1, span: 0.25, threshold: 0.02 },
};
const pct = (field: string) => `((${field} - 1) * 100).toFixed(1) + '%'`;

/**
 * What the Flags column raises, in the order its chips appear. Each `when` is
 * an expression over the row's fields; `detail` adds the row's own numbers to
 * the chip's tooltip.
 */
const flags: FlagSpec[] = [
  {
    label: 'slower',
    when: 'cycles < 0.98',
    tone: 'bad',
    title: 'More than 2% slower in cycles than BarCC -O2',
    detail: `'cycles ' + ${pct('cycles')}`,
  },
  {
    label: 'opposite signs',
    when: '(cycles - 1) * (ir - 1) < 0 && Math.abs(cycles - 1) > 0.003 && Math.abs(ir - 1) > 0.003',
    tone: 'accent',
    title: 'Cycles and instructions moved in opposite directions',
    detail: `'cycles ' + ${pct('cycles')} + ', instructions ' + ${pct('ir')}`,
  },
  {
    label: 'layout win',
    when: 'cycles / ir > 1.12',
    tone: 'info',
    title:
      'Cycles improved 12% more than instructions: the gain is in layout or latency, not less work',
    detail: `'cycles ' + ${pct('cycles')} + ', instructions ' + ${pct('ir')}`,
  },
  {
    label: 'provisional',
    when: 'runs < 5',
    tone: 'warn',
    title: 'Not every run completed, so the timing is provisional',
    detail: "runs + ' of 5 runs'",
  },
];

export const detailView: ViewSpec = {
  // Left in the order the rows arrive — suite, then benchmark, then build —
  // so each benchmark's three builds sit together. Click Cycles to put the
  // slowest on top.
  filter: { compiler: { exclude: ['BarCC'] } },
  columns: [
    { id: 'suite', label: 'Suite' },
    { id: 'benchmark', label: 'Benchmark' },
    { id: 'variant', label: 'Build' },
    {
      id: 'cycles',
      label: 'Cycles',
      format: { options: { decimals: 3 } },
      render: bar,
    },
    {
      id: 'ir',
      label: 'Instructions',
      format: { options: { decimals: 3 } },
      render: bar,
    },
    {
      id: 'flags',
      label: 'Flags',
      // No field of its own, so it computes one: how many flags the row
      // raises. That is what clicking the header sorts by.
      compute: flags.map((f) => `(${f.when} ? 1 : 0)`).join(' + '),
      render: {
        fnName: 'flags',
        options: {
          flags,
        },
      },
    },
  ],
};

/**
 * Suite, benchmark and build are the index: a suite or benchmark
 * the row above already named is left blank, as a pivot's row index would.
 *
 * No zebra stripes: the row under the pointer is highlighted instead, which
 * does the striping's job — keeping a row's cells together — where the reader
 * is actually looking. And a plain header: the most minimal style among the
 * demos, to compare against the others.
 */
export const detailDisplay: DataTableDisplay = {
  indexColumns: 3,
  frameless: true,
  // No shaded header band either: air, and one rule under the value columns.
  header: 'plain',
};
