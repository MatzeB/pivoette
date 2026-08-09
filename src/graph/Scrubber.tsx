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
import { useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { unitLabels } from '../data/meta';
import { useGraph, useLayers, usePointer, useSetPointer } from './context';
import { tickFormatter, tickSpec, withUnit } from './axis-format';
import { timeReadoutFormat } from './axis-format';
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
  /** Vertical rule at the hovered position. Default true. */
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
  const { x, plot, data } = useGraph();
  const hover = useHovered();
  if (!hover) return null;
  const px = x.at(data.xs[hover.index]!);
  return (
    <line
      className={styles.rule}
      x1={px}
      x2={px}
      y1={plot.top}
      y2={plot.top + plot.height}
    />
  );
}

function ScrubDots() {
  const { x, y, data, colorOf } = useGraph();
  const hover = useHovered();
  if (!hover) return null;
  const px = x.at(data.xs[hover.index]!);
  return (
    <>
      {data.series.map((series) => {
        const point = series.points[hover.index];
        if (!point || point.y === null) return null;
        return (
          <circle
            key={series.key}
            className={styles.dot}
            cx={px}
            cy={y.at(point.y)}
            r={4}
            style={{ fill: colorOf(series.slot) }}
          />
        );
      })}
    </>
  );
}

function ScrubReadout({ render }: { render?: (hit: ScrubHit) => ReactNode }) {
  const graph = useGraph();
  const { overlay } = useLayers();
  const hover = useHovered();
  const { x, plot, data, locale, timeZone, unitPlacement } = graph;

  // Built once and reused, because each of these constructs an `Intl`
  // formatter — far too expensive to do on every pointer move.
  const formatters = useMemo(() => {
    const labels = unitLabels(data.yMeta, locale);
    const number = tickFormatter(
      data.yMeta,
      data.frame,
      tickSpec(data.yMeta, data.yFactor !== 1, 2, locale),
    );
    // At the axis's own resolution: hardcoding a day made every point of an
    // intraday chart read the same heading, which is the one thing a readout
    // exists to tell apart.
    const time =
      data.xKind === 'time'
        ? timeReadoutFormat(x.ticks().interval?.unit ?? 'day', locale, timeZone)
        : undefined;
    return { labels, number, time };
  }, [data, x, locale, timeZone]);

  const hit = useMemo<ScrubHit | null>(() => {
    if (!hover) return null;
    const value = data.xs[hover.index]!;
    const raw = data.series[0]?.points[hover.index]?.raw;
    const xLabel =
      data.xKind === 'time'
        ? formatters.time!(value)
        : data.xKind === 'band'
          ? (data.categories[hover.index] ?? '')
          : String(raw ?? value);
    return {
      index: hover.index,
      x: value,
      xLabel,
      entries: data.series.map((series) => {
        const y = series.points[hover.index]?.y ?? null;
        return {
          series,
          color: graph.colorOf(series.slot),
          y,
          // Bare unless the chart nominated values to carry the unit: with the
          // default placement the axis title beside the readout already says it.
          label:
            y === null
              ? ''
              : unitPlacement === 'value'
                ? withUnit(formatters.number(y), formatters.labels)
                : formatters.number(y),
        };
      }),
    };
  }, [hover, data, formatters, graph, unitPlacement]);

  if (!overlay || !hit) return null;

  // Flip to the other side of the rule near the right edge, so the readout
  // never leaves the plot.
  const px = x.at(hit.x);
  const flip = px > plot.left + plot.width * 0.6;

  return createPortal(
    <div
      className={styles.readout}
      // A live region, so arrow-key movement is spoken. This is the component
      // that actually knows the value, and it already re-renders per move.
      role="status"
      aria-live="polite"
      style={{
        // Always `left` plus a translate, never `right`. The overlay spans the
        // whole box, so a `right` measured from the plot's edge is short by the
        // right margin — which ate the gap and let the box touch the rule.
        left: flip ? px - GAP : px + GAP,
        top: plot.top,
        transform: flip ? 'translateX(-100%)' : undefined,
      }}
    >
      {render ? (
        render(hit)
      ) : (
        <>
          <div className={styles.readoutHead}>{hit.xLabel}</div>
          {hit.entries.map((entry) => (
            <div key={entry.series.key} className={styles.readoutRow}>
              <span
                className={styles.swatch}
                style={{ background: entry.color }}
              />
              {entry.series.label}
              <span className={styles.readoutValue}>{entry.label || '—'}</span>
            </div>
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
  const { x, plot, data } = useGraph();
  const setHover = useSetPointer();
  const ref = useRef<SVGRectElement>(null);
  const dragging = useRef(false);

  const locate = (clientX: number) => {
    const host = ref.current;
    if (!host) return;
    // User units are CSS pixels — no `viewBox` scaling — so this is a
    // subtraction rather than a `getScreenCTM` matrix.
    const px = clientX - host.getBoundingClientRect().left + plot.left;
    const index =
      x.kind === 'band'
        ? Math.min(
            Math.max(Math.round(x.invert(px)), 0),
            data.categories.length - 1,
          )
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
    locate(e.clientX);
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
      onPointerMove={(e) => locate(e.clientX)}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => {
        if (!dragging.current) setHover(null);
      }}
      onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          stepBy(1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          stepBy(-1);
        } else if (e.key === 'Escape') {
          setHover(null);
        }
      }}
    />
  );
}
