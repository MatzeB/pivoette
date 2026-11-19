/**
 * A pivot view, drawn as bars.
 *
 * The same `ViewSpec` a table is computed from already says everything a
 * grouped bar chart needs: the row fields name the categories, the column
 * fields split each category into bars, and the measures say what each bar
 * shows. So a chart driven by a view runs the pivot engine as it is and only
 * *reads* its result here, rather than growing a second spec and a second
 * aggregation path — and the table and the chart stay two renderings of one
 * view, switchable without losing anything.
 *
 * What the view cannot say is how each measure is drawn. That is presentation,
 * so it lives in the display beside the table's own (`DataTableDisplay.chart`),
 * keyed by column id like the table's other per-column settings would be.
 *
 * Pure and React-free: `PivotChart` renders what this returns.
 */
import { unitLabels } from '../data/meta';
import type { ColumnMeta } from '../data/meta';
import type { ViewResult } from '../pivot/result';
import type { ColumnDef, ViewSpec } from '../pivot/spec';
import { asNumber } from '../util';
import type { GraphOrientation } from './context';
import type { GraphData, GraphPoint, PointExtra, Series } from './series';
import { MAX_SHADES, shade } from './shade';
import { SERIES_SLOTS } from './palette';

/**
 * How one measure is drawn.
 *
 * - `bar`: the bar's length. Two bar measures under one member draw two bars.
 * - `range`: a whisker from the lowest to the highest of a bar's range values
 *   — `min` with `max`, or `p25` with `p75`.
 * - `dot`: a marker on the bar's centre line, such as a median.
 * - `box`: in a box plot, an edge of the box — `p25` and `p75`, the
 *   interquartile range. In a bar chart it joins the range instead.
 * - `median`: in a box plot, the line across the box. In a bar chart it is a
 *   dot.
 * - `none`: not drawn, but listed in the hover readout.
 */
export type ChartMark = 'bar' | 'range' | 'box' | 'median' | 'dot' | 'none';

/**
 * How each bar position is drawn.
 *
 * - `bars`: a bar to the value, with any range as a whisker across it.
 * - `boxes`: a box plot (box and whiskers). The box spans the `box` values,
 *   a line across it marks the `median`, and the whisker runs out to the
 *   `range` values; the bar value itself becomes a diamond, so a geomean or
 *   mean still shows where it sits within the spread.
 */
export type ChartPlot = 'bars' | 'boxes';

export const CHART_PLOTS: readonly ChartPlot[] = ['bars', 'boxes'];

/**
 * What a bar's colour says.
 *
 * - `series`: which bar it is. Every bar its own hue, as any chart does.
 * - `shades`: where it sits in an ordered progression. One hue, palest first
 *   — for bars like `base → LTO+PGO → +Bolt`, where a separate hue each would
 *   say they are unrelated.
 * - `nested`: both, for two column fields. The outer field picks the hue and
 *   the inner one the shade, so `FooCC` is blues and `BarCC` oranges, each
 *   from pale to full across its builds.
 *
 * Shades claim an order, so they suit an inner field whose members have one,
 * and only a few of them: past `MAX_SHADES` they stop being told apart, and
 * the chart falls back to `series` with a note saying so.
 */
export type ChartColors = 'series' | 'shades' | 'nested';

export const CHART_COLORS: readonly ChartColors[] = [
  'series',
  'shades',
  'nested',
];

export const CHART_MARKS: readonly ChartMark[] = [
  'bar',
  'range',
  'box',
  'median',
  'dot',
  'none',
];

/** How a pivot view is drawn when it is shown as a chart. */
export interface ChartDisplay {
  /** Default `'horizontal'`: categories are names, read best in a column. */
  orientation?: GraphOrientation;
  /** Bars, or a box plot. Default `'bars'`. */
  plot?: ChartPlot;
  /** The value bars grow from. Default 0. */
  baseline?: number;
  /** Keep the baseline in the middle of the value axis. */
  symmetric?: boolean;
  /** Print each bar's value past its end. Default true. */
  labels?: boolean;
  /** Shade a category and read out its values on hover. Default true. */
  hover?: boolean;
  /** Column id → how that measure is drawn. Unlisted ones follow `markOf`. */
  marks?: Record<string, ChartMark>;
  /**
   * Bars in the order to draw them within a category, by member label (the
   * column fields' members, joined with ` · ` when there are several).
   * Unlisted ones follow, in the order the pivot gives them.
   */
  barOrder?: string[];
  /** Pixels. Default: sized to the bars. */
  height?: number;
  /**
   * What a bar's colour says. Default: `nested` for two or more column
   * fields whose innermost has at most `MAX_SHADES` members, else `series`.
   */
  colors?: ChartColors;
  /**
   * Give each measured field its own panel, side by side, sharing the
   * categories on the left. Default true; it only applies when bars measure
   * more than one field — `ir` and `cycles` — and false draws them all
   * against one axis.
   */
  split?: boolean;
  /**
   * Put side-by-side panels on one value scale when they measure in the same
   * unit, so equal values draw at equal lengths across them. Default true.
   */
  sharedScale?: boolean;
}

/** Aggregations that describe a spread rather than a centre. */
const RANGE_AGGS = new Set(['min', 'max']);
/** The quartiles: a box plot's box, a bar chart's range. */
const BOX_AGGS = new Set(['p25', 'p75']);
const MEDIAN_AGGS = new Set(['median', 'p50']);

/**
 * How the measure at `index` in `view.columns` is drawn: what the display
 * says, else a default read off the measure.
 *
 * The first measure of each field is that field's bar — it is the one the
 * view leads with, and a second field measured after it (`cycles` after
 * `ir`) is a second quantity, which gets bars, and a panel, of its own.
 * After that, a measure of spread (`min`, `max`) joins the whisker, the
 * quartiles the box and a median its line, which is the reading the
 * aggregation itself suggests, and anything else is a marker on the bar.
 */
export function markOf(
  view: ViewSpec,
  chart: ChartDisplay | undefined,
  index: number,
): ChartMark {
  const column = view.columns[index];
  if (!column) return 'none';
  const set = chart?.marks?.[column.id];
  if (set) return set;
  const field = (c: ColumnDef) => c.source ?? c.id;
  const firstOfField =
    view.columns.findIndex((c) => field(c) === field(column)) === index;
  if (firstOfField) return 'bar';
  const agg = column.agg ?? '';
  if (RANGE_AGGS.has(agg)) return 'range';
  if (BOX_AGGS.has(agg)) return 'box';
  if (MEDIAN_AGGS.has(agg)) return 'median';
  return 'dot';
}

/**
 * A value's label beside its bar's: `cycles min` next to the `cycles` bar is
 * just `min`. The readout lists a bar's values after its own, so the shared
 * name says nothing a second time — five times, for a box plot's numbers.
 */
export function shortLabel(label: string, bar: string): string {
  const prefix = `${bar} `;
  return label.startsWith(prefix) && label.length > prefix.length
    ? label.slice(prefix.length)
    : label;
}

/**
 * What a mark comes to under `plot`. A bar chart has no box to draw, so its
 * edges widen the whisker and a median is marked like any other value.
 */
function drawnAs(mark: ChartMark, plot: ChartPlot): ChartMark {
  if (plot === 'boxes') return mark;
  return mark === 'box' ? 'range' : mark === 'median' ? 'dot' : mark;
}

/** One of the side-by-side charts a view is split into, per measured field. */
export interface PivotPanel {
  /** The field its bars measure; empty when the view is not split. */
  key: string;
  /** What its bars measure, as a heading; empty when not split. */
  title: string;
  graph: GraphData;
}

export interface PivotGraph {
  /**
   * The first panel's chart: the whole chart, unless it is split. Null when
   * there is nothing that can be drawn; `problems` says why.
   */
  graph: GraphData | null;
  /** Every panel, left to right. Empty when there is nothing to draw. */
  panels: PivotPanel[];
  /** Why there is no chart. Shown in place of one. */
  problems: string[];
  /** Things drawn, but probably not as meant. Shown under the chart. */
  notes: string[];
}

/** Joins the levels of a multi-level row or member path into one label. */
export const PATH_SEPARATOR = ' · ';

interface Measure {
  /** Index into `result.leaves`. */
  leaf: number;
  /** The field it aggregates, which decides its panel. */
  source: string;
  label: string;
  mark: ChartMark;
}

/** One bar position within a category: a column-axis member path. */
interface Member {
  key: string;
  /** The path's levels, outermost first. */
  parts: string[];
  measures: Measure[];
}

function fallbackMeta(name: string): ColumnMeta {
  return { dataName: name, displayName: name, type: 'float', category: 'data' };
}

export function graphFromView(
  result: ViewResult,
  view: ViewSpec,
  chart: ChartDisplay = {},
): PivotGraph {
  const problems: string[] = [];
  const notes: string[] = [];
  const none = (why: string): PivotGraph => ({
    graph: null,
    panels: [],
    problems: [...problems, why],
    notes,
  });

  if (result.mode !== 'pivot' || (view.pivotRows ?? []).length === 0) {
    return none(
      'A chart needs a field under Categories: each of its values gets a row of bars.',
    );
  }
  if ((view.columnAxis ?? 'pivotColumns') !== 'pivotColumns') {
    return none(
      'A chart draws its values across the bars, so `columnAxis` must be `pivotColumns`.',
    );
  }

  // --- leaves → members × measures ------------------------------------------

  const depth = (view.pivotColumns ?? []).length;
  const members: Member[] = [];
  const byKey = new Map<string, Member>();
  result.leaves.forEach((leaf, i) => {
    const id = leaf.column.def?.id ?? leaf.column.id;
    const index = view.columns.findIndex((c) => c.id === id);
    const mark = drawnAs(
      index >= 0 ? markOf(view, chart, index) : (chart.marks?.[id] ?? 'none'),
      chart.plot ?? 'bars',
    );
    const parts = leaf.colPath.slice(0, depth);
    const key = parts.join(PATH_SEPARATOR);
    let member = byKey.get(key);
    if (!member) {
      member = { key, parts, measures: [] };
      byKey.set(key, member);
      members.push(member);
    }
    const def = index >= 0 ? view.columns[index] : undefined;
    const source = def?.source ?? def?.id ?? id;
    member.measures.push({ leaf: i, source, label: leaf.column.label, mark });
  });

  if (!members.some((m) => m.measures.some((x) => x.mark === 'bar'))) {
    return none('No value is drawn as a bar: set one of the values to Bar.');
  }
  if (
    members.some(
      (m) => m.measures.filter((x) => x.mark === 'range').length === 1,
    )
  ) {
    notes.push(
      'A range needs two values, such as min and max; with one it draws nothing.',
    );
  }
  if (
    members.some((m) => m.measures.filter((x) => x.mark === 'box').length === 1)
  ) {
    notes.push(
      'A box needs two values, such as p25 and p75; with one it draws nothing.',
    );
  }

  // --- panels: one per measured field, when there are several ---------------

  // A bar measure's field decides its panel: `ir` and `cycles` are different
  // quantities, and two of them on one axis would be read against each other
  // bar by bar. A range or dot goes with the bars of its own field, or the
  // first panel when no bar measures that field.
  const barSources: string[] = [];
  for (const m of members) {
    for (const x of m.measures) {
      if (x.mark === 'bar' && !barSources.includes(x.source)) {
        barSources.push(x.source);
      }
    }
  }
  const split = (chart.split ?? true) && barSources.length > 1;
  const panelOf = (x: Measure) =>
    !split ? 0 : Math.max(0, barSources.indexOf(x.source));
  const count = split ? barSources.length : 1;

  // Each level labelled the way the table labels it, then joined for the
  // readout and for a vertical chart, which has no room for columns.
  const paths = result.rows.map((row) =>
    row.path.map(
      (v, level) => result.rowMemberFormats[level]?.(v) ?? String(v),
    ),
  );
  const categories = paths.map((p) => p.join(PATH_SEPARATOR));
  const rowField = view.pivotRows![0]!.field;
  const xMeta =
    result.frame.columnByName.get(rowField)?.meta ?? fallbackMeta(rowField);

  const valueAt = (row: number, leaf: number): number | null => {
    const n = asNumber(result.rows[row]!.cells[leaf]?.value);
    if (n === null) return null;
    return n * (result.leaves[leaf]!.displayFactor ?? 1);
  };

  const panels: PivotPanel[] = [];
  for (let p = 0; p < count; p++) {
    const own = members.map((m) => ({
      ...m,
      measures: m.measures.filter((x) => panelOf(x) === p),
    }));
    const graph = buildPanel(own);
    if (graph && split) {
      graph.measure = own
        .flatMap((m) => m.measures)
        .find((x) => x.mark === 'bar')?.label;
    }
    if (graph) {
      panels.push({
        key: split ? barSources[p]! : '',
        title: split ? graph.yMeta.displayName : '',
        graph,
      });
    }
  }

  // One scale for panels that measure in one unit, so a bar is as long in
  // one panel as an equal bar in the next. Each panel's own extent would put
  // a 1.1 at a different length in each, which is exactly the comparison
  // the reader is making across them.
  const units = new Set(panels.map((x) => unitLabels(x.graph.yMeta).full));
  if (panels.length > 1 && units.size === 1 && chart.sharedScale !== false) {
    const lo = Math.min(...panels.map((x) => x.graph.yExtent[0]));
    const hi = Math.max(...panels.map((x) => x.graph.yExtent[1]));
    for (const x of panels) x.graph.yExtent = [lo, hi];
  }

  return {
    graph: panels[0]?.graph ?? null,
    panels,
    problems,
    // Each panel paints on its own, so the same note can arrive twice.
    notes: [...new Set(notes)],
  };

  /** One panel's chart, from the members' measures that belong to it. */
  function buildPanel(members: Member[]): GraphData | null {
    if (!members.some((m) => m.measures.some((x) => x.mark === 'bar'))) {
      return null;
    }

    interface Draft {
      key: string;
      label: string;
      member: Member;
      bar: Measure;
    }
    const drafts: Draft[] = [];
    for (const member of members) {
      const bars = member.measures.filter((x) => x.mark === 'bar');
      for (const bar of bars) {
        // Name the measure only when the member alone would not tell two bars
        // apart, or when there is no member at all.
        const label =
          depth === 0
            ? bar.label
            : bars.length > 1
              ? `${member.key}${PATH_SEPARATOR}${bar.label}`
              : member.key;
        drafts.push({ key: label, label, member, bar });
      }
    }

    // Colour follows the engine's order, which is the axis's own sort; drawing
    // follows `barOrder`. The same split as `Series.slot` and `Series.index`.
    const rank = new Map((chart.barOrder ?? []).map((key, i) => [key, i]));
    const unlisted = rank.size;
    const ordered = drafts
      .map((draft, slot) => ({ draft, slot }))
      .sort(
        (a, b) =>
          (rank.get(a.draft.member.key) ?? unlisted) -
          (rank.get(b.draft.member.key) ?? unlisted),
      );

    const paints = paint(
      ordered.map((o) => o.draft),
      drafts,
      depth,
      chart.colors,
      notes,
    );

    // --- points ----------------------------------------------------------------

    let min = Infinity;
    let max = -Infinity;
    const see = (v: number | null) => {
      if (v === null) return;
      if (v < min) min = v;
      if (v > max) max = v;
    };

    const series: Series[] = ordered.map(({ draft, slot }, index) => {
      const others = draft.member.measures.filter((x) => x.mark !== 'bar');
      const ranged = others.filter((x) => x.mark === 'range');
      const boxed = others.filter((x) => x.mark === 'box');
      const median = others.find((x) => x.mark === 'median');
      const leaf = result.leaves[draft.bar.leaf]!;
      const points: GraphPoint[] = result.rows.map((_row, r) => {
        const y = valueAt(r, draft.bar.leaf);
        see(y);
        const extras: PointExtra[] = others.map((x) => ({
          label: shortLabel(x.label, draft.bar.label),
          value: valueAt(r, x.leaf),
          as: x.mark === 'bar' ? 'none' : x.mark,
        }));
        /** The lowest and highest of some measures, if two are present. */
        const span = (of: Measure[]): [number, number] | undefined => {
          const values = of
            .map((x) => valueAt(r, x.leaf))
            .filter((v): v is number => v !== null);
          if (values.length < 2) return undefined;
          see(Math.min(...values));
          see(Math.max(...values));
          return [Math.min(...values), Math.max(...values)];
        };
        const range = span(ranged);
        const box = span(boxed);
        const mid = median ? valueAt(r, median.leaf) : null;
        see(mid);
        for (const e of extras) if (e.as === 'dot') see(e.value);
        return {
          x: r,
          y,
          raw: categories[r]!,
          ...(range ? { range } : {}),
          ...(box ? { box } : {}),
          ...(mid !== null ? { median: mid } : {}),
          ...(extras.length > 0 ? { extras } : {}),
        };
      });
      return {
        key: draft.key,
        label: draft.label,
        meta: leaf.column.meta ?? fallbackMeta(draft.label),
        index,
        slot,
        points,
        ...paints[index],
      };
    });

    const firstBar = result.leaves[ordered[0]!.draft.bar.leaf]!;
    const yMeta = firstBar.column.meta ?? fallbackMeta(firstBar.column.label);

    return {
      series,
      xKind: 'band',
      xs: categories.map((_c, i) => i),
      categories,
      ...(paths.some((p) => p.length > 1) ? { categoryPaths: paths } : {}),
      categorySlots: categories.map((_c, i) => i),
      xMeta,
      yMeta,
      yFactor: 1,
      yExtent: min <= max ? [min, max] : [0, 1],
      frame: result.frame,
    };
  }
}

/** What `paint` decides for one series. */
type Paint = Pick<Series, 'color' | 'group'>;

const hue = (slot: number) =>
  slot < SERIES_SLOTS ? `var(--pv-series-${slot})` : 'var(--pv-muted)';

/**
 * The colour of each series in draw order, under the requested scheme — or
 * none, leaving the palette slot, when the scheme does not fit the bars.
 *
 * `engine` is the same series in the pivot's own order, which is what a hue
 * follows: like a palette slot, it belongs to the group and must not change
 * when the bars are reordered. A shade follows the draw order, since the
 * order is what it depicts.
 */
function paint(
  drawn: readonly { member: Member }[],
  engine: readonly { member: Member }[],
  depth: number,
  requested: ChartColors | undefined,
  notes: string[],
): Paint[] {
  const plain = drawn.map((): Paint => ({}));
  const inner = (d: { member: Member }) => d.member.parts.at(-1) ?? '';
  const outer = (d: { member: Member }) =>
    d.member.parts.slice(0, -1).join(PATH_SEPARATOR);
  const steps = [...new Set(drawn.map(inner))];

  const scheme =
    requested ??
    (depth >= 2 && steps.length <= MAX_SHADES ? 'nested' : 'series');
  if (scheme === 'series') return plain;

  // A member drawn as two bars would get one shade for both.
  const keys = drawn.map((d) => d.member.key);
  if (new Set(keys).size !== keys.length) {
    notes.push(
      'Shades need one bar per member; with several values drawn as bars, each bar keeps its own colour.',
    );
    return plain;
  }

  if (scheme === 'shades') {
    if (drawn.length > MAX_SHADES) {
      notes.push(
        `Shades are told apart up to ${MAX_SHADES} bars; with ${drawn.length}, each keeps its own colour.`,
      );
      return plain;
    }
    return drawn.map((_d, i) => ({ color: shade(hue(0), i, drawn.length) }));
  }

  if (depth < 2) {
    notes.push(
      'Nested colours need two fields under Bars: the first picks the colour, the second its shade.',
    );
    return plain;
  }
  if (steps.length > MAX_SHADES) {
    notes.push(
      `Shades are told apart up to ${MAX_SHADES} steps; with ${steps.length}, each bar keeps its own colour.`,
    );
    return plain;
  }
  const groups = [...new Set(engine.map(outer))];
  return drawn.map((d) => ({
    color: shade(
      hue(groups.indexOf(outer(d))),
      steps.indexOf(inner(d)),
      steps.length,
    ),
    group: { label: outer(d), shade: inner(d) },
  }));
}
