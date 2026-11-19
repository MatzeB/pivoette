/**
 * The marks a per-point child can be.
 *
 * Each is a handful of lines, and that is the point: they demonstrate the
 * contract — read `useDatum()` for where you are, `useSeries()` for who you
 * are — so a host writing its own can copy one and change the shape.
 */
import { useDatum, useGraph, useSeries } from './context';
import type { GraphPoint, Series } from './series';
import type { Scale } from './scale';
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
   * line. `'outside'` puts it past the *data end*, away from the baseline —
   * what a bar wants, since a negative bar's cap is below the baseline and a
   * label above it would land inside the fill. On a horizontal chart that is
   * to the right of a bar that grew right and to the left of one that grew
   * left.
   */
  side?: 'above' | 'outside';
  /**
   * Clearance between the point and the label, in pixels. Default 10, or 6
   * beside a horizontal bar, where the text's own height is not in the gap.
   */
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
 * The pixel a point's ink reaches along the value axis, past the tip when a
 * whisker sticks out beyond it, so an outside label clears both.
 *
 * `lower` says which way is outwards in pixels: a bar growing left, or up the
 * page, has its far end at the smaller coordinate.
 */
function outerEnd(
  point: GraphPoint,
  tip: number,
  lower: boolean,
  y: Scale,
): number {
  const ends = [tip, ...(point.range ?? []), ...(point.box ?? [])].map(
    (v, i) => (i === 0 ? v : y.at(v)),
  );
  return lower ? Math.min(...ends) : Math.max(...ends);
}

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
  gap,
  format,
}: PointLabelProps) {
  const { point, index, cx, cy } = useDatum();
  const { series } = useSeries();
  const { y, plot, baseline, formatValue, valueDecimals, orientation } =
    useGraph();

  const picked = pickedIndex(series, at);
  if (picked !== -1 && picked !== index) return null;
  if (at === 'all' && point.y === null) return null;

  // The box's own formatter: it already knows the precision and where the unit
  // goes, and composing one here built an `Intl.NumberFormat` per labelled
  // point on every resize — and disagreed with the axis about decimals.
  const text =
    format?.(point.y) ??
    (point.y === null ? '' : formatValue(point.y, valueDecimals + 1));

  if (!text) return null;

  if (side === 'outside' && orientation === 'horizontal') {
    // Past the tip along the row, on whichever side the bar grew towards,
    // and centred on the bar's thickness.
    const left = cx < baseline;
    const clear = gap ?? 6;
    const end = outerEnd(point, cx, left, y);
    return (
      <text
        className={styles.pointLabel}
        x={left ? end - clear : end + clear}
        y={cy}
        textAnchor={left ? 'end' : 'start'}
        dominantBaseline="middle"
      >
        {text}
      </text>
    );
  }
  const clear = gap ?? 10;

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
  const below = side === 'outside' && cy > baseline;
  const end = side === 'outside' ? outerEnd(point, cy, !below, y) : cy;

  return (
    <text
      className={styles.pointLabel}
      x={cx}
      y={below ? end + clear : end - clear}
      textAnchor={anchor}
      // `hanging` measures from the top of the glyphs, so the gap below a mark
      // is the same visual distance as the gap above one.
      dominantBaseline={below ? 'hanging' : undefined}
    >
      {text}
    </text>
  );
}

export interface ReferenceLineProps {
  /** Where, in display units. Default: the box's `baseline`, or 0. */
  value?: number;
  /**
   * Text at the line's far end: the top of a vertical chart's rule, or the
   * right of a horizontal one. Omitted, the line carries no label.
   */
  label?: string;
}

/**
 * A rule across the plot at one value: the "no change" line a ratio chart
 * measures everything against.
 *
 * Paint it after the bars, so it runs over their roots; a bar grows from the
 * baseline, and the line is what says where that was. In ink rather than the
 * gridline colour, since it means something the gridlines do not.
 */
export function ReferenceLine({ value, label }: ReferenceLineProps) {
  const { y, plot, reference, orientation } = useGraph();
  const at = y.at(value ?? reference);
  const horizontal = orientation === 'horizontal';
  const lo = horizontal ? plot.left : plot.top;
  const hi = horizontal ? plot.left + plot.width : plot.top + plot.height;
  // Off the plot is off the chart: a rule pinned to the edge would claim a
  // value the axis does not show.
  if (!(at >= lo - 0.5 && at <= hi + 0.5)) return null;
  const right = plot.left + plot.width;
  const bottom = plot.top + plot.height;
  return (
    <g aria-hidden="true">
      <line
        className={styles.reference}
        x1={horizontal ? at : plot.left}
        x2={horizontal ? at : right}
        y1={horizontal ? plot.top : at}
        y2={horizontal ? bottom : at}
      />
      {label && (
        <text
          className={styles.referenceLabel}
          x={horizontal ? at : right}
          y={horizontal ? plot.top - 2 : at - 4}
          textAnchor={horizontal ? 'middle' : 'end'}
        >
          {label}
        </text>
      )}
    </g>
  );
}

export interface WhiskerProps {
  /** Length of the end caps, across the bar. Default 8. */
  cap?: number;
}

/**
 * A line across a point's `range`, low to high, with a cap at each end: the
 * spread a bar's value came from — a min-to-max, or an interquartile range.
 *
 * Drawn over the bar in ink, not in the series colour: it has to stay visible
 * where it crosses its own fill, and the bar under it already says whose it is.
 */
export function Whisker({ cap = 8 }: WhiskerProps) {
  const { point, cx, cy } = useDatum();
  const { y, orientation } = useGraph();
  if (!point.range) return null;
  const lo = y.at(point.range[0]);
  const hi = y.at(point.range[1]);
  // A range of one value — min and max of a single benchmark — has no
  // spread to show, and its caps would read as a stray tick on the bar.
  if (Math.abs(hi - lo) < 1) return null;
  const half = cap / 2;
  if (orientation === 'horizontal') {
    return (
      <g className={styles.whisker}>
        <line x1={lo} x2={hi} y1={cy} y2={cy} />
        <line x1={lo} x2={lo} y1={cy - half} y2={cy + half} />
        <line x1={hi} x2={hi} y1={cy - half} y2={cy + half} />
      </g>
    );
  }
  return (
    <g className={styles.whisker}>
      <line x1={cx} x2={cx} y1={lo} y2={hi} />
      <line x1={cx - half} x2={cx + half} y1={lo} y2={lo} />
      <line x1={cx - half} x2={cx + half} y1={hi} y2={hi} />
    </g>
  );
}

export interface BoxProps {
  /** Thickness across the band. Default: the bar's own, or 12. */
  thickness?: number;
}

/**
 * A box plot's box: a point's `box`, low to high, filled in the series
 * colour, with its `median` as a line across it. Paint it after the
 * `<Whisker>`, so the whisker shows only where it runs out past the box.
 *
 * The median line is drawn in the surface colour with an ink core, so it
 * reads on a pale fill and a full one alike.
 */
export function Box({ thickness }: BoxProps) {
  const { point, cx, cy, thickness: own } = useDatum();
  const { color } = useSeries();
  const { y, orientation } = useGraph();
  if (!point.box) return null;
  const across = thickness ?? own ?? 12;
  const a = y.at(point.box[0]);
  const b = y.at(point.box[1]);
  const lo = Math.min(a, b);
  const len = Math.max(Math.abs(b - a), 1);
  const m = point.median === undefined ? null : y.at(point.median);
  const half = across / 2;
  const horizontal = orientation === 'horizontal';
  return (
    <g>
      <rect
        className={styles.box}
        x={horizontal ? lo : cx - half}
        y={horizontal ? cy - half : lo}
        width={horizontal ? len : across}
        height={horizontal ? across : len}
        rx={2}
        style={{ fill: color }}
      />
      {m !== null && (
        <line
          className={styles.median}
          x1={horizontal ? m : cx - half}
          x2={horizontal ? m : cx + half}
          y1={horizontal ? cy - half : m}
          y2={horizontal ? cy + half : m}
        />
      )}
    </g>
  );
}

export interface MarkerProps {
  size?: number;
  /**
   * Mark the point's own value too — what a box plot does with the value a
   * bar chart would draw as the bar, such as a geomean.
   */
  own?: boolean;
}

/**
 * A marker for each of a point's extra values drawn as dots — a median on a
 * mean's bar — on the bar's centre line.
 *
 * A diamond rather than a circle, so it does not read as the `<Dot>` that marks
 * a point's own value; ringed in the surface colour, like a dot, to stay
 * visible on the fill.
 */
export function Marker({ size = 5, own = false }: MarkerProps) {
  const { point, cx, cy } = useDatum();
  const { series } = useSeries();
  const { y, orientation } = useGraph();
  const dots = [
    ...(own && point.y !== null
      ? [{ label: series.label, value: point.y }]
      : []),
    ...(point.extras ?? []).filter((e) => e.as === 'dot' && e.value !== null),
  ];
  if (!dots.length) return null;
  return (
    <>
      {dots.map((extra) => {
        const at = y.at(extra.value!);
        const [mx, my] = orientation === 'horizontal' ? [at, cy] : [cx, at];
        return (
          <path
            key={extra.label}
            className={styles.marker}
            d={`M${mx},${my - size}L${mx + size},${my}L${mx},${my + size}L${mx - size},${my}Z`}
          >
            <title>{extra.label}</title>
          </path>
        );
      })}
    </>
  );
}
