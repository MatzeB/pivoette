/**
 * From a frame and four field names to plottable series.
 *
 * This is the chart's counterpart to `pivot/engine.ts`, and deliberately not
 * the same thing. The engine produces a table: categorical rows crossed with
 * leaf columns, every axis a grouping axis. A chart's x is usually *continuous*
 * — an instant, a measurement — and forcing it through a grouping axis would
 * mean re-deriving the number from a formatted member label. So charts map
 * fields directly and reuse the parts of the data layer that are about the
 * data rather than about the table: aggregations, unit metadata, scale ladders,
 * and temporal decoding.
 *
 * Everything here is pure and React-free, which is where most of the chart's
 * behaviour is tested.
 */
import { requireColumn } from '../data/frame';
import { decodeTime, isTimestamp } from '../data/temporal';
import { unitLabels } from '../data/meta';
import type { ColumnMeta } from '../data/meta';
import type { CellValue, DataFrame } from '../data/types';
import { getAggregation } from '../pivot/aggregations';
import type { Aggregation } from '../pivot/aggregations';
import { chooseStep, defaultLadder, metaForStep } from '../format/ladders';
import { asNumber, compareValues, isNumericType } from '../util';

export interface GraphFields {
  /** Field holding each point's position along x. */
  x: string;
  /** The measure — or several, one series each. */
  y: string | string[];
  /**
   * Field whose distinct values split `y` into one series each. Mutually
   * exclusive with an array of several `y` fields.
   */
  series?: string;
  /** Reduces the rows falling in each (x, series) group. Default `'sum'`. */
  agg?: string;
  /**
   * How the categorical dimension is ordered — the series, and a band x axis.
   * Default `'name'`.
   *
   * `'value'` puts the largest first, by each entry's total. Signed, not by
   * magnitude: on a net-worth chart that reads assets down to debts, which is
   * the order a reader expects, rather than filing a large debt next to a
   * large holding.
   *
   * Ordering never moves a colour — see `Series.slot`.
   */
  order?: 'name' | 'value';
}

export type XKind = 'time' | 'linear' | 'band';

export interface GraphPoint {
  /** Position along the x scale: epoch millis, the number, or a band index. */
  x: number;
  /** Value in display units — `yFactor` is already applied. Null is a hole. */
  y: number | null;
  /** The x value as it came out of the frame, for readouts and labels. */
  raw: CellValue;
}

export interface Series {
  /** Stable identity: the measure's field name, or the series value as text. */
  key: string;
  /** Legend text. */
  label: string;
  /** This series' own metadata, at the axis's chosen ladder step. */
  meta: ColumnMeta;
  /** Where it sits in the drawn order — what `order` decides. */
  index: number;
  /**
   * Palette slot. Assigned from the *name* order, never from `index`.
   *
   * Colour identifies the entity, so it cannot depend on how this particular
   * chart happens to be sorted: two charts of the same accounts, one ranked by
   * balance and one by contribution, must still agree about which one is blue.
   * That is also what makes a filter safe — dropping a series never repaints
   * the survivors.
   */
  slot: number;
  /** One entry per x in the shared domain, ascending. */
  points: GraphPoint[];
}

export interface GraphData {
  series: Series[];
  xKind: XKind;
  /** Every x, ascending — the shared index every series is aligned to. */
  xs: number[];
  /** Band labels, index-aligned with `xs`. Empty unless `xKind` is `'band'`. */
  categories: string[];
  /**
   * Palette slot per band category, index-aligned with `categories`. The same
   * name-order rule as `Series.slot`, and for the same reason: a bar keeps its
   * colour when the axis is re-sorted.
   */
  categorySlots: number[];
  xMeta: ColumnMeta;
  /** Metadata for the shared value axis, at the chosen ladder step. */
  yMeta: ColumnMeta;
  /** Stored → display multiplier. 1 when nothing was rescaled. */
  yFactor: number;
  /** Extent of the plotted values, in display units. Niceing is the scale's
   * business, not this function's. */
  yExtent: [number, number];
  /** Escape hatch to the source, and what a `FormatFn`'s context needs. */
  frame: DataFrame;
}

/**
 * A group holding nothing but nulls has no value.
 *
 * `sum` answers `0` for an empty array, which is correct arithmetic and wrong
 * charting: it would draw a line through the baseline for an account that does
 * not exist yet, rather than leaving a gap. `mean` and the percentiles already
 * answer null, so this only changes the summing reducers — and `count` of
 * nothing becoming null rather than 0 is the more honest answer for a chart.
 */
function reduceGroup(agg: Aggregation, values: CellValue[]): CellValue {
  const real = values.some((v) => v !== null && v !== undefined);
  return real ? agg.reduce(values) : null;
}

/** How a column's values become positions along x. */
function xKindOf(frame: DataFrame, field: string): XKind {
  const column = requireColumn(frame, field);
  if (isTimestamp(column.meta) || column.meta.encoding) return 'time';
  return isNumericType(column.type) ? 'linear' : 'band';
}

/** Index of the entry in the ascending `xs` nearest `target`; -1 if empty. */
export function nearestIndex(xs: readonly number[], target: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  if (lo === xs.length) return xs.length - 1;
  // A tie goes to the lower index, so a sweep left and right agree.
  return target - xs[lo - 1]! <= xs[lo]! - target ? lo - 1 : lo;
}

export function buildGraphData(
  frame: DataFrame,
  fields: GraphFields,
  opts?: { ladder?: string },
): GraphData {
  const yFields = Array.isArray(fields.y) ? fields.y : [fields.y];
  if (yFields.length === 0) {
    throw new Error('A chart needs at least one `y` field.');
  }
  if (yFields.length > 1 && fields.series) {
    throw new Error(
      'Give either several `y` fields or a `series` field, not both: each ' +
        'already produces one series per entry.',
    );
  }

  const xColumn = requireColumn(frame, fields.x);
  const xKind = xKindOf(frame, fields.x);
  const agg = getAggregation(fields.agg ?? 'sum');
  const seriesColumn = fields.series
    ? requireColumn(frame, fields.series)
    : undefined;
  // A single-element array is unambiguous next to `series`, so it is the
  // scalar case rather than a rejected one.
  const splitBySeries = !!seriesColumn && yFields.length === 1;

  // --- positions along x ----------------------------------------------------

  const xRaw: CellValue[] = [];
  const xAt: (number | null)[] = [];
  for (let r = 0; r < frame.length; r++) {
    const value = xColumn.values[r]!;
    xRaw.push(value);
    if (xKind === 'time') xAt.push(decodeTime(value, xColumn.meta));
    else if (xKind === 'linear') xAt.push(asNumber(value));
    else xAt.push(value === null || value === undefined ? null : 0);
  }

  const categories: string[] = [];
  const xs: number[] = [];
  /** Position in `xs` for each source row; -1 for a row with no position. */
  const slotOf = new Array<number>(frame.length).fill(-1);

  if (xKind === 'band') {
    const seen = new Map<string, CellValue>();
    for (let r = 0; r < frame.length; r++) {
      if (xAt[r] === null) continue;
      const key = String(xRaw[r]);
      if (!seen.has(key)) seen.set(key, xRaw[r]!);
    }
    // Sorted, not first-seen: these rows are aggregated, so row order is an
    // artefact of the source rather than anything the reader should see.
    const keys = [...seen.keys()].sort((a, b) => compareValues(a, b));
    const slot = new Map<string, number>();
    keys.forEach((key, i) => {
      categories.push(key);
      xs.push(i);
      slot.set(key, i);
    });
    for (let r = 0; r < frame.length; r++) {
      if (xAt[r] === null) continue;
      slotOf[r] = slot.get(String(xRaw[r]))!;
    }
  } else {
    const distinct = new Set<number>();
    for (let r = 0; r < frame.length; r++) {
      const v = xAt[r]!;
      if (v !== null) distinct.add(v);
    }
    xs.push(...[...distinct].sort((a, b) => a - b));
    const slot = new Map<number, number>();
    xs.forEach((v, i) => slot.set(v, i));
    for (let r = 0; r < frame.length; r++) {
      const v = xAt[r]!;
      // A row with no position cannot be drawn; placing it at zero would be
      // worse than leaving it out.
      if (v !== null) slotOf[r] = slot.get(v)!;
    }
  }

  /** The raw x behind each slot, for readouts and category labels. */
  const rawAt: CellValue[] = new Array<CellValue>(xs.length).fill(null);
  for (let r = 0; r < frame.length; r++) {
    const slot = slotOf[r]!;
    if (slot >= 0 && rawAt[slot] === null) rawAt[slot] = xRaw[r]!;
  }

  // --- grouping -------------------------------------------------------------

  /** Series key → its display label and the source metadata behind it. */
  const keys: { key: string; label: string; meta: ColumnMeta }[] = [];
  /** Series index → slot → the raw values falling in that cell. */
  const buckets: CellValue[][][] = [];
  const indexOfKey = new Map<string, number>();

  const openSeries = (key: string, label: string, meta: ColumnMeta) => {
    const at = indexOfKey.get(key);
    if (at !== undefined) return at;
    indexOfKey.set(key, keys.length);
    keys.push({ key, label, meta });
    buckets.push(Array.from({ length: xs.length }, (): CellValue[] => []));
    return keys.length - 1;
  };

  if (splitBySeries) {
    const yColumn = requireColumn(frame, yFields[0]!);
    // Distinct series values, in the order a reader would expect them.
    const members = new Map<string, CellValue>();
    for (let r = 0; r < frame.length; r++) {
      if (slotOf[r]! < 0) continue;
      const v = seriesColumn!.values[r]!;
      const key = String(v);
      if (!members.has(key)) members.set(key, v);
    }
    for (const key of [...members.keys()].sort((a, b) => compareValues(a, b))) {
      openSeries(key, key, yColumn.meta);
    }
    for (let r = 0; r < frame.length; r++) {
      const slot = slotOf[r]!;
      if (slot < 0) continue;
      const s = indexOfKey.get(String(seriesColumn!.values[r]!))!;
      buckets[s]![slot]!.push(yColumn.values[r]!);
    }
  } else {
    const columns = yFields.map((field) => requireColumn(frame, field));
    columns.forEach((column, i) => {
      openSeries(yFields[i]!, column.meta.displayName, column.meta);
    });
    for (let r = 0; r < frame.length; r++) {
      const slot = slotOf[r]!;
      if (slot < 0) continue;
      columns.forEach((column, s) => {
        buckets[s]![slot]!.push(column.values[r]!);
      });
    }
  }

  /** Series index → slot → the reduced value, still in stored units. */
  const reduced = buckets.map((slots) =>
    slots.map((values) => reduceGroup(agg, values)),
  );

  // --- one ladder step for the whole value axis -----------------------------

  const yMetas = yFields.map((f) => requireColumn(frame, f).meta);
  const first = yMetas[0]!;
  // They share an axis, so they share a unit — or none of them is rescaled.
  // Splitting the rung per series would put two different meanings of "1" on
  // one set of gridlines.
  const uniform = yMetas.every(
    (m) => unitLabels(m).full === unitLabels(first).full,
  );
  const pooled: CellValue[] = [];
  for (const slots of reduced)
    for (const v of slots) if (v !== null) pooled.push(v);
  // Chosen from the aggregated values, not the raw column: a sum over a
  // thousand rows sits decades away from any single one of them.
  const picked = uniform
    ? chooseStep(pooled, first, opts?.ladder ?? defaultLadder(first))
    : undefined;
  const yFactor = picked?.factor ?? 1;
  const yMeta = picked ? metaForStep(first, picked.step) : first;

  // --- ordering -------------------------------------------------------------

  /**
   * One entry of a categorical dimension, on its way through the sort.
   *
   * The palette slot travels *in* the record rather than being looked up
   * afterwards, so re-ordering carries the colour along the way reordering
   * rows carries their columns. There is no permutation to re-apply, and so no
   * way for the order and the colours to come apart.
   */
  interface Entry {
    /** Position before sorting, which is name order — hence the palette slot. */
    slot: number;
    /** What the sort ranks on. */
    total: number;
  }

  const byValue = (fields.order ?? 'name') === 'value';

  const totalOf = (values: (CellValue | null)[]) =>
    values.reduce<number>((acc, v) => acc + (asNumber(v) ?? 0), 0);

  /** Largest first, ties keeping the name order they arrived in. */
  const arrange = (entries: Entry[]): Entry[] =>
    byValue
      ? [...entries].sort((a, b) => b.total - a.total || a.slot - b.slot)
      : entries;

  const seriesEntries = arrange(
    keys.map((_k, slot) => ({ slot, total: totalOf(reduced[slot]!) })),
  );
  const bandEntries = arrange(
    xs.map((_x, slot) => ({
      slot,
      // A continuous axis is never re-ordered — its positions are numbers, not
      // categories — so only a band needs a real total here.
      total: xKind === 'band' ? totalOf(reduced.map((s) => s[slot]!)) : 0,
    })),
  );

  // --- assemble -------------------------------------------------------------

  let min = Infinity;
  let max = -Infinity;
  const series: Series[] = seriesEntries.map((entry, index) => {
    const k = keys[entry.slot]!;
    return {
      key: k.key,
      label: k.label,
      // Each series keeps its own display name for the legend while sharing
      // the axis's unit — safe because `uniform` established they agree.
      meta: picked ? metaForStep(k.meta, picked.step) : k.meta,
      index,
      slot: entry.slot,
      points: bandEntries.map((at, position) => {
        const stored = asNumber(reduced[entry.slot]![at.slot]);
        const y = stored === null ? null : stored * yFactor;
        if (y !== null) {
          if (y < min) min = y;
          if (y > max) max = y;
        }
        // A band's x *is* its drawn position, so it renumbers with the sort; a
        // continuous axis plots the number itself and keeps it.
        return {
          x: xKind === 'band' ? position : xs[at.slot]!,
          y,
          raw: rawAt[at.slot]!,
        };
      }),
    };
  });

  return {
    series,
    xKind,
    xs: bandEntries.map((e, i) => (xKind === 'band' ? i : xs[e.slot]!)),
    categories:
      xKind === 'band' ? bandEntries.map((e) => categories[e.slot]!) : [],
    categorySlots: bandEntries.map((e) => e.slot),
    xMeta: xColumn.meta,
    yMeta,
    yFactor,
    yExtent: min <= max ? [min, max] : [0, 1],
    frame,
  };
}
