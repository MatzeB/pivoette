/**
 * The marks a per-point child can be.
 *
 * Each is a handful of lines, and that is the point: they demonstrate the
 * contract — read `useDatum()` for where you are, `useSeries()` for who you
 * are — so a host writing its own can copy one and change the shape.
 */
import { useDatum, useGraph, useSeries } from './context';
import { tickFormatter, tickSpec, withUnit } from './axis-format';
import { unitLabels } from '../data/meta';
import type { Series } from './series';
import styles from './Graph.module.css';

export interface DotProps {
  /** Radius. The mark spec's floor is 4, giving an 8px target. */
  r?: number;
}

/**
 * A dot on one point, ringed in the surface colour.
 *
 * The ring is not decoration: without it a dot vanishes where it crosses its
 * own line or another series'. Drawing a border in the series colour instead
 * would add ink that is not data.
 */
export function Dot({ r = 4 }: DotProps) {
  const { cx, cy } = useDatum();
  const { color } = useSeries();
  return (
    <circle
      className={styles.dot}
      cx={cx}
      cy={cy}
      r={r}
      style={{ fill: color }}
    />
  );
}

export interface PointLabelProps {
  /**
   * Which points get a label. Default `'last'`.
   *
   * `'all'` is for a handful of marks — a bar per category, where the number
   * is the point of the chart and there is room for every one. It is the wrong
   * answer for a dense series: a value beside each of a hundred line points is
   * the surest way to get none of them read, and the axis, the legend, and the
   * scrubber are there to carry the rest.
   */
  at?: 'last' | 'first' | 'min' | 'max' | 'all';
  /**
   * Which way the label sits from its point. Default `'above'`, which suits a
   * line. `'outside'` puts it past the *data end*, away from the axis zero —
   * what a bar wants, since a negative bar's cap is below the baseline and a
   * label above it would land inside the fill.
   */
  side?: 'above' | 'outside';
  /** Clearance between the point and the label, in pixels. */
  gap?: number;
  /** Override the text. Given the display value, which may be null. */
  format?: (value: number | null) => string;
}

/**
 * The one index `at` selects within a series, or -1 for `'all'`.
 *
 * Cached against the series object, because `PointLabel` is mounted once per
 * point and the answer is a property of the series: rescanning per datum made
 * `<PointLabel at="last">` over a 500-point series quadratic, and it re-ran on
 * every resize and theme flip. The cache is a `WeakMap`, and `buildGraphData`
 * mints new series objects whenever the data changes, so it cannot go stale.
 */
const pickedCache = new WeakMap<Series, Map<string, number>>();

function pickedIndex(
  series: Series,
  at: NonNullable<PointLabelProps['at']>,
): number {
  if (at === 'all') return -1;
  let perAt = pickedCache.get(series);
  if (!perAt) pickedCache.set(series, (perAt = new Map()));
  const hit = perAt.get(at);
  if (hit !== undefined) return hit;

  let best = -1;
  series.points.forEach((p, i) => {
    if (p.y === null) return;
    if (best === -1) {
      best = i;
      return;
    }
    const other = series.points[best]!.y!;
    if (at === 'last') best = i;
    else if (at === 'min' && p.y < other) best = i;
    else if (at === 'max' && p.y > other) best = i;
  });
  perAt.set(at, best);
  return best;
}

/**
 * Roughly how far a label reaches from its anchor, in pixels.
 *
 * Only used to decide *which side* of the point to write on, so an estimate is
 * enough — and it is all that is available, since `getBBox` does not exist
 * under the test environment (see the margin note in `GraphBox.tsx`).
 */
const LABEL_REACH = 44;

/**
 * A value printed beside one point of its series.
 *
 * In ink, never in the series colour: three of the light-mode slots are below
 * the contrast a reader needs from text, and identity comes from the coloured
 * mark next to the label rather than from the label itself.
 */
export function PointLabel({
  at = 'last',
  side = 'above',
  gap = 10,
  format,
}: PointLabelProps) {
  const { point, index, cx, cy } = useDatum();
  const { series } = useSeries();
  const { data, locale, plot, unitPlacement, y } = useGraph();

  const picked = pickedIndex(series, at);
  if (picked !== -1 && picked !== index) return null;
  if (at === 'all' && point.y === null) return null;

  const number =
    point.y === null
      ? ''
      : tickFormatter(
          series.meta,
          data.frame,
          tickSpec(series.meta, data.yFactor !== 1, 1, locale),
        )(point.y);
  // Silent about the unit unless the chart has nominated values to carry it —
  // by default the axis title already said `$k` once.
  const text =
    format?.(point.y) ??
    (unitPlacement === 'value'
      ? withUnit(number, unitLabels(series.meta, locale))
      : number);

  if (!text) return null;

  // Turn back towards the plot near an edge. A label at the end of a line is
  // exactly where a centred anchor overflows the frame, and a clipped number
  // is worse than no number — the mark spec's one hard rule about labels.
  const anchor =
    cx + LABEL_REACH / 2 > plot.left + plot.width
      ? 'end'
      : cx - LABEL_REACH / 2 < plot.left
        ? 'start'
        : 'middle';

  // A mark that grew downwards from the baseline carries its label below, so
  // the number always sits past the data end rather than on top of the fill.
  const below = side === 'outside' && cy > y.at(0);

  return (
    <text
      className={styles.pointLabel}
      x={cx}
      y={below ? cy + gap : cy - gap}
      textAnchor={anchor}
      // `hanging` measures from the top of the glyphs, so the gap below a mark
      // is the same visual distance as the gap above one.
      dominantBaseline={below ? 'hanging' : undefined}
    >
      {text}
    </text>
  );
}
