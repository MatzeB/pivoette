/**
 * Reading values off the chart by pointing at it.
 *
 * Split into four components on purpose. The hit rect *writes* the hover
 * through `useSetPointer`, which is a stable setter, so it never re-renders on
 * a move; the rule, the dots, and the readout *read* it. A sweep across the
 * plot therefore repaints three small leaves and nothing else — the lines, the
 * axes, and every per-point mark are untouched. See `context.ts` for why the
 * provider arrangement is what makes that true.
 *
 * The readout is HTML rather than SVG text: see `Graph.module.css`.
 */
import { Fragment, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useGraph, useLayers, usePointer, useSetPointer } from './context';
import { timeReadoutFormat } from './axis-format';
import { chooseInterval } from './time';
import { nearestIndex } from './series';
import type { Series } from './series';
import styles from './Graph.module.css';

/** Clearance between the rule and the readout, on whichever side it sits. */
const GAP = 12;

export interface ScrubEntry {
  series: Series;
  color: string;
  /** The value in display units, or null where this series has a hole. */
  y: number | null;
  /** The value as text, with its unit. Empty for a hole. */
  label: string;
  /** The point's extra values, named and formatted: `min 1.25`. */
  details: string[];
}

export interface ScrubHit {
  /** Index into `GraphData.xs`. */
  index: number;
  x: number;
  xLabel: string;
  entries: ScrubEntry[];
}

export interface ScrubberProps {
  /** Replace the readout, or `false` to suppress it. */
  readout?: ((hit: ScrubHit) => ReactNode) | false;
  /**
   * Mark the hovered position across the plot. Default true.
   *
   * A hairline on a continuous axis. On a band axis it shades the whole
   * band instead: a line through the middle of a group of bars would cut
   * the middle one in half, and the shading says "these bars are one
   * category", which is the question a hover over bars is asking. Put the
   * `<Scrubber>` before the bars so the shading paints behind them.
   */
  rule?: boolean;
  /** A dot on each series at the hovered position. Default true. */
  dots?: boolean;
}

export function Scrubber({ readout, rule = true, dots = true }: ScrubberProps) {
  return (
    <>
      {rule && <ScrubRule />}
      {dots && <ScrubDots />}
      {readout !== false && <ScrubReadout render={readout} />}
      <ScrubHitArea />
    </>
  );
}

/** Where the hovered index sits, or null when the pointer is away. */
function useHovered(): { index: number; px: number } | null {
  const { hover } = usePointer();
  const { data } = useGraph();
  if (!hover) return null;
  if (hover.index < 0 || hover.index >= data.xs.length) return null;
  return hover;
}

function ScrubRule() {
  const { x, plot, data, orientation } = useGraph();
  const hover = useHovered();
  if (!hover) return null;
  const at = x.at(data.xs[hover.index]!);
  const horizontal = orientation === 'horizontal';
  if (x.kind === 'band') {
    // The full step, padding included, so neighbouring bands' shading would
    // tile without a gap.
    const from = at - x.step() / 2;
    return horizontal ? (
      <rect
        className={styles.band}
        x={plot.left}
        y={from}
        width={plot.width}
        height={x.step()}
      />
    ) : (
      <rect
        className={styles.band}
        x={from}
        y={plot.top}
        width={x.step()}
        height={plot.height}
      />
    );
  }
  // Across the plot at the hovered position: a column in a vertical chart, a
  // row in a horizontal one.
  return horizontal ? (
    <line
      className={styles.rule}
      x1={plot.left}
      x2={plot.left + plot.width}
      y1={at}
      y2={at}
    />
  ) : (
    <line
      className={styles.rule}
      x1={at}
      x2={at}
      y1={plot.top}
      y2={plot.top + plot.height}
    />
  );
}

function ScrubDots() {
  const { data, seriesColor, place } = useGraph();
  const hover = useHovered();
  if (!hover) return null;
  const position = data.xs[hover.index]!;
  return (
    <>
      {data.series.map((series) => {
        const point = series.points[hover.index];
        if (!point || point.y === null) return null;
        const { cx, cy } = place(position, point.y);
        return (
          <circle
            key={series.key}
            className={styles.dot}
            cx={cx}
            cy={cy}
            r={4}
            style={{ fill: seriesColor(series) }}
          />
        );
      })}
    </>
  );
}

function ScrubReadout({ render }: { render?: (hit: ScrubHit) => ReactNode }) {
  const { overlay } = useLayers();
  const hover = useHovered();
  const {
    x,
    plot,
    data,
    locale,
    timeZone,
    seriesColor,
    formatValue,
    valueDecimals,
    orientation,
  } = useGraph();

  // Built once and reused, because each of these constructs an `Intl`
  // formatter — far too expensive to do on every pointer move.
  /**
   * At the resolution of the *points*, not of the ticks.
   *
   * Hardcoding a day made every point of an intraday chart read the same
   * heading, which is the one thing a readout exists to tell apart. But the
   * axis's tick interval is the wrong correction: a decade of monthly balances
   * ticks every two years, and "2023" does not identify a point either. How
   * close the points sit is what decides how precisely one has to be named.
   */
  const timeText = useMemo(() => {
    if (data.xKind !== 'time') return undefined;
    let gap = Infinity;
    for (let i = 1; i < data.xs.length; i++) {
      gap = Math.min(gap, data.xs[i]! - data.xs[i - 1]!);
    }
    const unit = Number.isFinite(gap) ? chooseInterval(gap, 1).unit : 'day';
    return timeReadoutFormat(unit, locale, timeZone);
  }, [data.xKind, data.xs, locale, timeZone]);

  const hit = useMemo<ScrubHit | null>(() => {
    if (!hover) return null;
    const value = data.xs[hover.index]!;
    const raw = data.series[0]?.points[hover.index]?.raw;
    const xLabel =
      data.xKind === 'time'
        ? timeText!(value)
        : data.xKind === 'band'
          ? (data.categories[hover.index] ?? '')
          : String(raw ?? value);
    return {
      index: hover.index,
      x: value,
      xLabel,
      entries: data.series.map((series) => {
        const point = series.points[hover.index];
        const y = point?.y ?? null;
        const digits = valueDecimals + 1;
        return {
          series,
          color: seriesColor(series),
          y,
          // The box's formatter, so a value reads the same here as it does on
          // the axis — including whether it carries the unit at all.
          // One digit past the axis step — the same rule a `<PointLabel>`
          // follows, so the two never name one point differently.
          label: y === null ? '' : formatValue(y, digits),
          details: (point?.extras ?? [])
            .filter((e) => e.value !== null)
            .map((e) => `${e.label} ${formatValue(e.value!, digits)}`),
        };
      }),
    };
  }, [hover, data, timeText, seriesColor, formatValue, valueDecimals]);

  if (!overlay || !hit) return null;

  // Flip to the other side of the rule near the far edge, so the readout
  // never leaves the plot. Lying down, the rule is a row, so the readout sits
  // below or above it, against the right edge where the bars are shortest.
  const at = x.at(hit.x);
  const horizontal = orientation === 'horizontal';
  const flip = horizontal
    ? at > plot.top + plot.height * 0.6
    : at > plot.left + plot.width * 0.6;
  // Clear of the whole band, not just its centre: measured from the centre,
  // a readout beside a group of bars covers half of the very bars it names.
  const reach = x.kind === 'band' ? x.step() / 2 : 0;
  const position = horizontal
    ? {
        left: plot.left + plot.width,
        top: flip ? at - reach - GAP : at + reach + GAP,
        transform: flip ? 'translate(-100%, -100%)' : 'translateX(-100%)',
      }
    : {
        // Always `left` plus a translate, never `right`. The overlay spans
        // the whole box, so a `right` measured from the plot's edge is short
        // by the right margin — which ate the gap and let the box touch the
        // rule.
        left: flip ? at - reach - GAP : at + reach + GAP,
        top: plot.top,
        transform: flip ? 'translateX(-100%)' : undefined,
      };

  return createPortal(
    <div
      className={styles.readout}
      // A live region, so arrow-key movement is spoken. This is the component
      // that actually knows the value, and it already re-renders per move.
      role="status"
      aria-live="polite"
      style={position}
    >
      {render ? (
        render(hit)
      ) : (
        <>
          <div className={styles.readoutHead}>{hit.xLabel}</div>
          {hit.entries.map((entry) => (
            <Fragment key={entry.series.key}>
              <div className={styles.readoutRow}>
                <span
                  className={styles.swatch}
                  style={{ background: entry.color }}
                />
                {entry.series.label}
                <span className={styles.readoutValue}>
                  {entry.label || '—'}
                </span>
              </div>
              {/* Under the row it qualifies, indented past the swatch. */}
              {entry.details.length > 0 && (
                <div className={styles.readoutDetail}>
                  {entry.details.join(' · ')}
                </div>
              )}
            </Fragment>
          ))}
        </>
      )}
    </div>,
    overlay,
  );
}

/**
 * The one element in the chart that listens for the pointer.
 *
 * It reads the geometry but never the hover, so a sweep does not re-render it.
 * `setHover` keeps the previous object when the index has not changed, which is
 * the throttle: a thousand moves across a hundred-point chart produce a hundred
 * state changes, and React bails out on the rest.
 */
function ScrubHitArea() {
  const { x, plot, data, orientation } = useGraph();
  const horizontal = orientation === 'horizontal';
  const setHover = useSetPointer();
  const ref = useRef<SVGRectElement>(null);
  const dragging = useRef(false);

  /** Where the pointer is along the position axis, in user units. */
  const locate = (e: { clientX: number; clientY: number }) => {
    const host = ref.current;
    if (!host) return;
    // User units are CSS pixels — no `viewBox` scaling — so this is a
    // subtraction rather than a `getScreenCTM` matrix.
    const box = host.getBoundingClientRect();
    const px = horizontal
      ? e.clientY - box.top + plot.top
      : e.clientX - box.left + plot.left;
    const index =
      x.kind === 'band'
        ? Math.min(Math.max(Math.round(x.invert(px)), 0), data.xs.length - 1)
        : nearestIndex(data.xs, x.invert(px));
    if (index < 0) return;
    setHover((prev) => (prev && prev.index === index ? prev : { index, px }));
  };

  const stepBy = (delta: number) => {
    setHover((prev) => {
      // From nothing, the first press lands on the end it is stepping *from*,
      // so Right reaches the first point rather than skipping it.
      const next = prev
        ? prev.index + delta
        : delta > 0
          ? 0
          : data.xs.length - 1;
      const index = Math.min(Math.max(next, 0), data.xs.length - 1);
      return { index, px: x.at(data.xs[index] ?? 0) };
    });
  };

  const onDown = (e: ReactPointerEvent<SVGRectElement>) => {
    dragging.current = true;
    // Optional: jsdom has no pointer capture, and a browser that lacks it
    // still scrubs — it just stops when the pointer leaves the plot.
    ref.current?.setPointerCapture?.(e.pointerId);
    // Touch has no hover, so the press itself has to place the scrubber.
    locate(e);
  };

  const onUp = (e: ReactPointerEvent<SVGRectElement>) => {
    dragging.current = false;
    ref.current?.releasePointerCapture?.(e.pointerId);
  };

  return (
    <rect
      ref={ref}
      className={styles.hit}
      x={plot.left}
      y={plot.top}
      width={plot.width}
      height={plot.height}
      // Reachable, and readable, without a pointer at all — which also gives
      // the tests a path that needs no synthetic pointer events.
      tabIndex={0}
      // Not `role="slider"`: that promises `aria-valuenow`, and reading the
      // hover here would subscribe the hit rect to every pointer move — the
      // one thing this component is arranged to avoid. The readout carries the
      // value instead, as a live region, which is what actually gets spoken.
      aria-label="Scrub the chart with the arrow keys"
      onPointerMove={(e) => locate(e)}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => {
        if (!dragging.current) setHover(null);
      }}
      onBlur={() => setHover(null)}
      // Lying down, a drag along the bands is vertical, so it is the
      // horizontal swipe that has to be left to the page.
      style={horizontal ? { touchAction: 'pan-x' } : undefined}
      onKeyDown={(e) => {
        // Along the bands, whichever way they run. Down a horizontal chart
        // the first category is at the top, so Down is forward.
        if (e.key === (horizontal ? 'ArrowDown' : 'ArrowRight')) {
          e.preventDefault();
          stepBy(1);
        } else if (e.key === (horizontal ? 'ArrowUp' : 'ArrowLeft')) {
          e.preventDefault();
          stepBy(-1);
        } else if (e.key === 'Escape') {
          setHover(null);
        }
      }}
    />
  );
}
