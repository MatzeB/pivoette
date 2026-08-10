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
  GraphPointer,
  GraphUnitPlacement,
} from './context';
import { bandScale, linearScale } from './scale';
import type { Scale } from './scale';
import { timeScale } from './time';
import { tickFormatter, tickSpec } from './axis-format';
import { buildGraphData } from './series';
import type { GraphData, GraphFields } from './series';
import styles from './Graph.module.css';

/** How many categorical slots `theme.module.css` defines. */
export const SERIES_SLOTS = 8;

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

export interface GraphBoxProps extends GraphFields {
  data: Record<string, unknown>[] | DatasetJson | DataFrame;
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

/**
 * Roughly one character's width in the UI sans at tick size.
 *
 * Deliberately an estimate. The exact answer needs `getBBox`, which jsdom does
 * not implement, or a canvas `measureText`, which is not available under the
 * test environment either — so reaching for one would make every chart with a
 * left axis untestable here. A margin only has to be close, and `margin` is
 * there for the case where close is not close enough.
 */
const CHAR_W = 6.6;

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
  x,
  y,
  series,
  agg,
  order,
  height,
  width,
  margin,
  ladder,
  ticks = 5,
  includeZero = false,
  bandPadding,
  unitPlacement = 'axis',
  locale,
  timeZone,
  theme = 'auto',
  className,
  children,
}: GraphBoxProps) {
  const frame = useMemo(
    () => (isFrame(data) ? data : fromDataset(data)),
    [data],
  );

  // `y` may be an array, and an array literal in the dep list would rebuild
  // the graph on every render. That is not merely wasteful: `metaForStep`
  // mints a fresh `ColumnMeta` each time and `unitLabels` memoises against
  // object identity, so the label cache would churn on every mouse move.
  const yKey = Array.isArray(y) ? y.join('\u0000') : y;
  const graph: GraphData = useMemo(
    () => buildGraphData(frame, { x, y, series, agg, order }, { ladder }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yKey stands in for y
    [frame, x, yKey, series, agg, order, ladder],
  );

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

    const [dataLo, dataHi] = graph.yExtent;
    const lo = includeZero ? Math.min(0, dataLo) : dataLo;
    const hi = includeZero ? Math.max(0, dataHi) : dataHi;

    // The left margin depends on the tick labels, which depend on the value
    // scale, which depends on the left margin only through the *range* — so a
    // throwaway scale over the final domain gives the labels without a loop.
    //
    // Through `tickFormatter`, not `toFixed`: the axis draws grouped, localised
    // text, so measuring the bare number reserves room for `1000` and then
    // paints `1,000.00` over the axis title.
    const probe = linearScale({ domain: [lo, hi], range: [0, 1], ticks });
    const probeTicks = probe.ticks(ticks);
    const probeLabels = tickFormatter(
      graph.yMeta,
      graph.frame,
      tickSpec(graph.yMeta, graph.yFactor !== 1, probeTicks.decimals, locale),
    );
    const sample = probeTicks.ticks.map((t) => probeLabels(t.value));
    const auto: GraphMargin = {
      ...DEFAULT_MARGIN,
      left: Math.max(
        DEFAULT_MARGIN.left,
        estimateLeft(sample, !!unitLabels(graph.yMeta, locale).full),
      ),
    };
    const m: GraphMargin = { ...auto, ...margin };

    const plot = {
      left: m.left,
      top: m.top,
      width: Math.max(0, outerWidth - m.left - m.right),
      height: Math.max(0, height - m.top - m.bottom),
    };

    const xRange: [number, number] = [plot.left, plot.left + plot.width];
    let xScale: Scale;
    if (graph.xKind === 'time') {
      xScale = timeScale({
        domain: [graph.xs[0] ?? 0, graph.xs[graph.xs.length - 1] ?? 1],
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
        domain: [graph.xs[0] ?? 0, graph.xs[graph.xs.length - 1] ?? 1],
        range: xRange,
        nice: false,
        ticks,
      });
    }

    // Range reversed, because SVG y grows downwards and a value axis does not.
    const yScale = linearScale({
      domain: [lo, hi],
      range: [plot.top + plot.height, plot.top],
      ticks,
    });

    return {
      x: xScale,
      y: yScale,
      plot,
      data: graph,
      colorOf: (index) =>
        index < SERIES_SLOTS ? `var(--pv-series-${index})` : OVERFLOW_COLOR,
      unitPlacement,
      ticks,
      locale,
      timeZone: tz,
    };
  }, [
    graph,
    outerWidth,
    height,
    margin,
    ticks,
    includeZero,
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
