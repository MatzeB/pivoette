/**
 * The frame a chart is composed inside.
 *
 * It owns the three things every mark needs and none of them can work out for
 * itself — what the data is, how big the plot is, and where a value lands — and
 * publishes them through context so the marks can be arbitrary children rather
 * than a configuration object. `<GraphBox>` draws nothing itself.
 *
 * Fields rather than a `ViewSpec`: see `series.ts` for why a chart maps columns
 * directly instead of going through the pivot engine.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { firstDayOfWeek, resolveTimeZone } from '../data/temporal';
import { fromDataset } from '../data/import';
import { unitLabels } from '../data/meta';
import type { DataFrame, DatasetJson } from '../data/types';
import { cls } from '../util';
import {
  GraphContext,
  LayersContext,
  PointerSetContext,
  PointerValueContext,
} from './context';
import type {
  GraphGeometry,
  GraphLayers,
  GraphOrientation,
  GraphPointer,
  GraphUnitPlacement,
} from './context';
import {
  bandScale,
  clean,
  linearScale,
  tickStep,
  DEFAULT_TICKS,
} from './scale';
import type { Scale } from './scale';
import { timeScale } from './time';
import { axisTitle, tickFormatter, tickSpec, withUnit } from './axis-format';
import { buildGraphData } from './series';
import type { GraphData, GraphFields } from './series';
import { SERIES_SLOTS } from './palette';
import { CHAR_W, categoryMargin } from './levels';
import styles from './Graph.module.css';

// Its own module so the pure chart code can read it without importing this
// component; re-exported here, where hosts have always found it.
export { SERIES_SLOTS };

/**
 * What a series past the last slot gets.
 *
 * Not slot 0 again. The palette's whole premise is that a colour identifies one
 * entity, and wrapping quietly hands the ninth series the first one's hue — two
 * identical swatches in the legend, which is the failure the fixed ordering
 * exists to prevent. Muted grey reads as "beyond the palette", which is the
 * truth: a chart with nine series needs "other", small multiples, or fewer
 * series, and none of those is a decision this function can make.
 */
const OVERFLOW_COLOR = 'var(--pv-muted)';

export interface GraphMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Where the box's data comes from: rows and the fields to plot from them, or a
 * `GraphData` built already — which is how a chart driven by a pivot view
 * hands over what the pivot engine computed (see `pivot-chart.ts`).
 */
export type GraphSource =
  | (GraphFields & {
      data: Record<string, unknown>[] | DatasetJson | DataFrame;
      graph?: undefined;
    })
  | {
      graph: GraphData;
      data?: undefined;
      x?: undefined;
      y?: undefined;
      series?: undefined;
      agg?: undefined;
      order?: undefined;
      seriesOrder?: undefined;
    };

export type GraphBoxProps = GraphSource & GraphBoxOptions;

export interface GraphBoxOptions {
  /** A chart has no intrinsic height, so this one is required. */
  height: number;
  /** Fixed width. Omitted, the box fills its container and measures itself. */
  width?: number;
  /**
   * Space for the axes, in pixels. Merged over the estimate, which is derived
   * from the tick text rather than measured — see the note on `estimateLeft`.
   */
  margin?: Partial<GraphMargin>;
  /** Scale ladder for the value axis; defaults to the measure's own. */
  ladder?: string;
  /** Ticks each axis aims for. Default 5. */
  ticks?: number;
  /** Start the value axis at zero even when the data does not reach it. */
  includeZero?: boolean;
  /**
   * Which way the value axis runs. Default `'vertical'`.
   *
   * `'horizontal'` puts the positions down the left, first at the top, and the
   * values along the bottom. An `<Axis side="left">` then names the
   * categories and `<Axis side="bottom">` carries the values: the side is
   * where the axis is drawn, and the orientation decides which scale it shows.
   */
  orientation?: GraphOrientation;
  /**
   * The value bars grow from, in display units. Default 0.
   *
   * For a measure whose neutral point is not zero: a ratio against a
   * reference, where 1.0 means "the same" and a bar should say how far each
   * result moved from it, in which direction. Giving one also keeps it on the
   * axis, as `includeZero` does for zero.
   */
  baseline?: number;
  /**
   * Make the value axis reach equally far either side of the baseline, so a
   * gain and a loss of the same size draw at the same length and the baseline
   * sits in the middle of the plot.
   */
  symmetric?: boolean;
  /**
   * Pixels kept clear past the data's ends along the value axis, for labels.
   * Default 0.
   *
   * The domain otherwise ends at the next round tick, which can be a hair past
   * the longest bar, and an outside `<PointLabel>` there runs off the plot.
   * Widening the domain rather than the margin keeps the axis honest about
   * where the room went: the gridlines carry on through it.
   */
  headroom?: number;
  /** Fraction of each band left as air. Ignored unless x is categorical. */
  bandPadding?: number;
  /**
   * Where the unit is stated: once on the axis title (default), on every value
   * the chart prints, or nowhere. One setting for the whole chart, so the axis,
   * the point labels, and the scrubber cannot each say it separately.
   */
  unitPlacement?: GraphUnitPlacement;
  locale?: string;
  timeZone?: string;
  /**
   * Palette, matching `DataTable`'s own prop. A chart renders outside the
   * table, so it cannot inherit one — pass the same value to both.
   */
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
  /** The marks, axes, and overlays. All of them read the context. */
  children?: ReactNode;
}

const DEFAULT_MARGIN: GraphMargin = {
  top: 12,
  right: 16,
  bottom: 28,
  left: 48,
};

/** A bottom margin with room for an axis title under the tick row. */
const TITLED_BOTTOM = 46;

// `CHAR_W` lives in `./levels`, which lays out the category columns too.

function estimateLeft(labels: string[], hasTitle: boolean): number {
  const widest = labels.reduce((m, l) => Math.max(m, l.length), 0);
  return Math.ceil(10 + widest * CHAR_W + (hasTitle ? 16 : 0));
}

function isFrame(data: GraphBoxProps['data']): data is DataFrame {
  return typeof data === 'object' && data !== null && 'columnByName' in data;
}

/**
 * Owns the hover state, and takes `children` as a prop so that owning it costs
 * nothing. When `setHover` fires this component re-renders, but `props.children`
 * is the identical element object `GraphBox` created, so React skips the entire
 * mark subtree and only the three `usePointer` consumers repaint.
 */
function PointerProvider({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState<GraphPointer['hover']>(null);
  const value = useMemo<GraphPointer>(() => ({ hover }), [hover]);
  return (
    <PointerSetContext.Provider value={setHover}>
      <PointerValueContext.Provider value={value}>
        {children}
      </PointerValueContext.Provider>
    </PointerSetContext.Provider>
  );
}

export function GraphBox({
  data,
  graph: given,
  x,
  y,
  series,
  agg,
  order,
  seriesOrder,
  height,
  width,
  margin,
  ladder,
  ticks = DEFAULT_TICKS,
  includeZero = false,
  orientation = 'vertical',
  baseline,
  symmetric = false,
  headroom = 0,
  bandPadding,
  unitPlacement = 'axis',
  locale,
  timeZone,
  theme = 'auto',
  className,
  children,
}: GraphBoxProps) {
  const frame = useMemo(
    () =>
      data === undefined ? null : isFrame(data) ? data : fromDataset(data),
    [data],
  );

  // `y` may be an array, and an array literal in the dep list would rebuild
  // the graph on every render. That is not merely wasteful: `metaForStep`
  // mints a fresh `ColumnMeta` each time and `unitLabels` memoises against
  // object identity, so the label cache would churn on every mouse move.
  const yKey = Array.isArray(y) ? y.join('\u0000') : y;
  // The same trap again for an inline `seriesOrder={['a', 'b']}`.
  const seriesOrderKey = seriesOrder?.join('\u0000');
  const built: GraphData | null = useMemo(
    () =>
      frame && x !== undefined && y !== undefined
        ? buildGraphData(
            frame,
            { x, y, series, agg, order, seriesOrder },
            { ladder },
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys stand in for y and seriesOrder
    [frame, x, yKey, series, agg, order, seriesOrderKey, ladder],
  );
  const graph = given ?? built;
  if (!graph) {
    throw new Error(
      '<GraphBox> needs either `data` with `x` and `y`, or `graph`.',
    );
  }

  // --- size -----------------------------------------------------------------

  const rootRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const responsive = width === undefined;
  // State rather than refs: a portal target has to trigger one more render
  // once it exists, or the legend would have nowhere to go on first paint.
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const [below, setBelow] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!responsive) return;
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setMeasured(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [responsive]);

  const outerWidth = width ?? measured ?? 0;

  // --- geometry -------------------------------------------------------------

  const geometry = useMemo<GraphGeometry | null>(() => {
    if (!(outerWidth > 0) || !(height > 0)) return null;

    const tz = resolveTimeZone(timeZone);
    const weekStart = firstDayOfWeek(locale);

    const horizontal = orientation === 'horizontal';
    const anchor = baseline ?? 0;
    const keep = includeZero || baseline !== undefined;

    // --- value domain, before it knows how long its axis is ------------------

    const [dataLo, dataHi] = graph.yExtent;
    let lo = keep ? Math.min(anchor, dataLo) : dataLo;
    let hi = keep ? Math.max(anchor, dataHi) : dataHi;
    if (symmetric) {
      const half = Math.max(hi - anchor, anchor - lo);
      lo = anchor - half;
      hi = anchor + half;
    }

    // The left margin depends on the tick labels, which depend on the value
    // scale, which depends on the left margin only through the *range* — so a
    // throwaway scale over the final domain gives the labels without a loop.
    //
    // Through the *same* formatter the axis paints with, so the two cannot
    // disagree: measuring the bare number reserved room for `1000` and then
    // painted `1,000.00` over the title, and skipping `unitPlacement` reserved
    // room for `160` and painted `$160k`.
    const rescaled = graph.yFactor !== 1;
    const labels = unitLabels(graph.yMeta, locale);
    const probe = linearScale({ domain: [lo, hi], range: [0, 1], ticks });
    const probeTicks = probe.ticks(ticks);
    const format = tickFormatter(
      graph.yMeta,
      graph.frame,
      tickSpec(graph.yMeta, rescaled, probeTicks.decimals, locale),
    );
    // Rebuilt below once the final domain is known; this one only measures.
    const probeText = (value: number) =>
      unitPlacement === 'value'
        ? withUnit(format(value), labels)
        : format(value);

    // Lying down, the left edge holds the category names instead of values,
    // and the value axis's title moves under its ticks — where `Axis` would
    // otherwise ask the host for `margin={{ bottom: 46 }}`.
    const leftText = horizontal
      ? graph.categories
      : probeTicks.ticks.map((t) => probeText(t.value));
    const leftTitled = !horizontal && !!labels.full;
    // Categories with several levels take a column each, like a table's
    // row index, rather than one joined label.
    const leftNeeded = horizontal
      ? categoryMargin(graph.categories, graph.categoryPaths)
      : estimateLeft(leftText, leftTitled);
    const auto: GraphMargin = {
      ...DEFAULT_MARGIN,
      left: Math.max(DEFAULT_MARGIN.left, leftNeeded),
      bottom:
        horizontal && axisTitle(graph.yMeta, locale)
          ? TITLED_BOTTOM
          : DEFAULT_MARGIN.bottom,
    };
    const m: GraphMargin = { ...auto, ...margin };

    const plot = {
      left: m.left,
      top: m.top,
      width: Math.max(0, outerWidth - m.left - m.right),
      height: Math.max(0, height - m.top - m.bottom),
    };

    // --- value domain, now that it does -------------------------------------

    const valueLength = horizontal ? plot.width : plot.height;
    if (headroom > 0 && valueLength > 2 * headroom) {
      // Widen by the fraction of the axis the room takes, so `headroom`
      // pixels are left at each end that has data running towards it. An end
      // that only reaches the baseline has no label to make room for.
      const pad = ((hi - lo) * headroom) / (valueLength - 2 * headroom);
      if (symmetric || !keep || dataLo < anchor) lo -= pad;
      if (symmetric || !keep || dataHi > anchor) hi += pad;
    }

    const valueRange: [number, number] = horizontal
      ? [plot.left, plot.left + plot.width]
      : // Reversed, because SVG y grows downwards and a value axis does not.
        [plot.top + plot.height, plot.top];
    let yScale: Scale;
    if (symmetric) {
      // Niced as a half-span, not as two ends: rounding each end out on its
      // own lands them on different ticks unless the baseline is a multiple
      // of the step, and the middle would no longer be the middle.
      const step = tickStep(hi - lo, ticks);
      // A twentieth of a step of slack: the label room is an estimate in
      // pixels, and being a hair over a tick should not cost a whole step
      // more axis, which on a narrow panel shrinks every bar by a third.
      const half = Math.ceil((hi - anchor) / step - 0.05) * step;
      yScale = linearScale({
        domain: [clean(anchor - half), clean(anchor + half)],
        range: valueRange,
        nice: false,
        ticks,
      });
    } else {
      yScale = linearScale({ domain: [lo, hi], range: valueRange, ticks });
    }

    const valueDecimals = yScale.ticks(ticks).decimals;
    const formatValue = (value: number, decimals = valueDecimals) => {
      const text = tickFormatter(
        graph.yMeta,
        graph.frame,
        tickSpec(graph.yMeta, rescaled, decimals, locale),
      )(value);
      return unitPlacement === 'value' ? withUnit(text, labels) : text;
    };

    // --- positions ----------------------------------------------------------

    // Down the left, first at the top: the order a list is read in.
    const xRange: [number, number] = horizontal
      ? [plot.top, plot.top + plot.height]
      : [plot.left, plot.left + plot.width];
    const xDomain: [number, number] = [
      graph.xs[0] ?? 0,
      graph.xs[graph.xs.length - 1] ?? 1,
    ];
    let xScale: Scale;
    if (graph.xKind === 'time') {
      xScale = timeScale({
        domain: xDomain,
        range: xRange,
        timeZone: tz,
        weekStart,
        // The domain is the data's own span: rounding it out to a calendar
        // boundary would strand the first and last points inside the plot
        // for no gain the gridlines do not already give.
        nice: false,
        ticks,
      });
    } else if (graph.xKind === 'band') {
      xScale = bandScale({
        count: graph.categories.length,
        range: xRange,
        padding: bandPadding,
      });
    } else {
      xScale = linearScale({
        domain: xDomain,
        range: xRange,
        nice: false,
        ticks,
      });
    }

    const [v0, v1] = valueRange;
    const place = horizontal
      ? (position: number, value: number) => ({
          cx: yScale.at(value),
          cy: xScale.at(position),
        })
      : (position: number, value: number) => ({
          cx: xScale.at(position),
          cy: yScale.at(value),
        });

    return {
      x: xScale,
      y: yScale,
      orientation,
      place,
      plot,
      data: graph,
      seriesColor: (series) =>
        series.color ??
        (series.slot < SERIES_SLOTS
          ? `var(--pv-series-${series.slot})`
          : OVERFLOW_COLOR),
      colorOf: (index) =>
        index < SERIES_SLOTS ? `var(--pv-series-${index})` : OVERFLOW_COLOR,
      unitPlacement,
      ticks,
      reference: anchor,
      // Clamped into the plot: a baseline that is off-screen still has to give
      // the marks a line to grow from, and all of them must pick the same one.
      baseline: Math.min(
        Math.max(yScale.at(anchor), Math.min(v0, v1)),
        Math.max(v0, v1),
      ),
      formatValue,
      valueDecimals,
      xTicks: xScale.ticks(ticks),
      locale,
      timeZone: tz,
    };
    // Four primitives, not the object: `Axis` tells hosts to pass
    // `margin={{ bottom: 46 }}` inline, and an inline literal in this list
    // would rebuild the geometry — and re-render every mark — on each render
    // of the parent. Same trap `yKey` defuses above.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the four below stand in for `margin`
  }, [
    graph,
    outerWidth,
    height,
    margin?.top,
    margin?.right,
    margin?.bottom,
    margin?.left,
    ticks,
    includeZero,
    orientation,
    baseline,
    symmetric,
    headroom,
    bandPadding,
    unitPlacement,
    locale,
    timeZone,
  ]);

  const layers = useMemo<GraphLayers>(
    () => ({ overlay, below }),
    [overlay, below],
  );

  // The root sizes to the plot plus whatever the `below` layer adds, so a
  // legend lengthens the box rather than sitting on top of the data.
  const style = { width: responsive ? '100%' : width };

  return (
    <div
      ref={rootRef}
      className={cls(styles.root, className)}
      data-theme={theme === 'auto' ? undefined : theme}
      style={style}
    >
      {/* A zero or NaN plot width turns every transform into Infinity, which
          some engines refuse to render at all. Until the first measurement
          lands, an empty box of the right height is the honest placeholder. */}
      {geometry ? (
        <GraphContext.Provider value={geometry}>
          <LayersContext.Provider value={layers}>
            <PointerProvider>
              <svg
                className={styles.svg}
                width={outerWidth}
                height={height}
                // User units are CSS pixels: no `viewBox` scaling, because
                // every mark spec here — a 2px line, an 8px marker, a 2px
                // surface ring — is in pixels and scaling would falsify all
                // of them at once.
                viewBox={`0 0 ${outerWidth} ${height}`}
                role="img"
              >
                {children}
              </svg>
              <div
                ref={setOverlay}
                className={styles.overlay}
                style={{ height }}
              />
              <div ref={setBelow} />
            </PointerProvider>
          </LayersContext.Provider>
        </GraphContext.Provider>
      ) : (
        <div style={{ height }} />
      )}
    </div>
  );
}
