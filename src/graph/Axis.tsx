/**
 * The gridlines, ticks, and title for one edge of the plot.
 *
 * An axis is a child rather than a `GraphBox` prop because which edges a chart
 * wants, and in which order they paint, is the host's decision — and because a
 * host that wants a different axis should be able to write one against the same
 * context this uses.
 */
import { useMemo } from 'react';
import { timeParts } from '../data/temporal';
import { unitLabels } from '../data/meta';
import type { TimeParts } from '../data/temporal';
import { useGraph } from './context';
import {
  axisTitle,
  tickFormatter,
  tickSpec,
  timeTickFormat,
  withUnit,
} from './axis-format';
import type { TimeUnit } from './time';
import styles from './Graph.module.css';

export interface AxisProps {
  /** Which edge. `left` is the value axis; `bottom` is the x axis. */
  side: 'left' | 'bottom';
  /** Draw a hairline across the plot at each tick. */
  grid?: boolean;
  /** Show the field's name beside the axis. Default true for `left`. */
  label?: boolean;
  /** Ticks to aim for. Defaults to the box's own setting. */
  ticks?: number;
}

/**
 * The part of a date that, when it changes, earns a coarser label.
 *
 * An axis ticking within a day repeats `06:00 · 12:00 · 18:00` on every one of
 * them, so the tick that opens a new day says which day. The same applies a
 * level up for a monthly axis crossing into a new year.
 */
function rolloverOf(unit: TimeUnit): ((p: TimeParts) => number) | undefined {
  switch (unit) {
    case 'millisecond':
    case 'second':
    case 'minute':
    case 'hour':
      return (p) => p.day;
    case 'day':
    case 'week':
    case 'month':
      return (p) => p.year;
    default:
      return undefined;
  }
}

export function Axis({ side, grid = false, label, ticks: count }: AxisProps) {
  // `unitPlacement` comes from the box, not from here: two axes and several
  // marks are describing one value scale, and they have to agree about which
  // of them says what it is measured in.
  const {
    x,
    y,
    plot,
    data,
    locale,
    timeZone,
    unitPlacement,
    ticks,
    formatValue,
    xTicks,
  } = useGraph();
  const vertical = side === 'left';
  const scale = vertical ? y : x;
  const meta = vertical ? data.yMeta : data.xMeta;
  const showTitle = label ?? vertical;

  // The x set is generated once on the geometry, because `Scrubber` reads the
  // calendar interval off it too; only an axis asking for its own tick count
  // regenerates. The box's target is the fallback, so `<GraphBox ticks={12}>`
  // reaches the axis that draws them.
  const set = useMemo(
    () =>
      !vertical && count === undefined ? xTicks : scale.ticks(count ?? ticks),
    [vertical, scale, count, ticks, xTicks],
  );

  const labels = useMemo(() => unitLabels(meta, locale), [meta, locale]);

  /** Only the value axis is ever rescaled; x carries positions, not measures. */
  const rescaled = vertical && data.yFactor !== 1;

  const text = useMemo(() => {
    // Categorical: the labels are the categories, already strings.
    if (!vertical && data.xKind === 'band') {
      return (index: number) => data.categories[index] ?? '';
    }
    // Time: dates, with a coarser label wherever the period rolls over.
    if (!vertical && data.xKind === 'time' && set.interval) {
      const unit = set.interval.unit;
      const fmt = timeTickFormat(unit, locale, timeZone);
      const key = rolloverOf(unit);
      const values = set.ticks.map((t) => t.value);
      const coarse = new Set<number>();
      if (key) {
        let previous: number | undefined;
        for (const value of values) {
          const now = key(timeParts(value, timeZone));
          if (previous !== undefined && now !== previous) coarse.add(value);
          previous = now;
        }
      }
      return (_index: number, value: number) =>
        coarse.has(value) ? fmt.rollover(value) : fmt.label(value);
    }
    // The value axis goes through the box's shared formatter, so the room the
    // margin reserved for this text and the text itself cannot disagree. An x
    // axis has its own metadata and formats itself.
    if (vertical) {
      return (_i: number, value: number) => formatValue(value, set.decimals);
    }
    const format = tickFormatter(
      meta,
      data.frame,
      tickSpec(meta, rescaled, set.decimals, locale),
    );
    return (_index: number, value: number) =>
      unitPlacement === 'value'
        ? withUnit(format(value), labels)
        : format(value);
  }, [
    vertical,
    data,
    set,
    meta,
    rescaled,
    locale,
    timeZone,
    labels,
    unitPlacement,
    formatValue,
  ]);

  // The title carries the unit only when it is the one saying it.
  const title = !showTitle
    ? ''
    : unitPlacement === 'axis'
      ? axisTitle(meta, locale)
      : (meta?.displayName ?? '');

  const right = plot.left + plot.width;
  const bottom = plot.top + plot.height;

  return (
    <g aria-hidden="true">
      {grid &&
        set.ticks.map((t) => (
          <line
            key={t.value}
            className={styles.grid}
            x1={vertical ? plot.left : t.pos}
            x2={vertical ? right : t.pos}
            y1={vertical ? t.pos : plot.top}
            y2={vertical ? t.pos : bottom}
          />
        ))}

      <line
        className={styles.axisLine}
        x1={plot.left}
        x2={vertical ? plot.left : right}
        y1={vertical ? plot.top : bottom}
        y2={bottom}
      />

      {set.ticks.map((t, i) => (
        <text
          key={t.value}
          className={styles.tickText}
          x={vertical ? plot.left - 8 : t.pos}
          y={vertical ? t.pos : bottom + 16}
          textAnchor={vertical ? 'end' : 'middle'}
          dominantBaseline={vertical ? 'middle' : 'auto'}
        >
          {text(i, t.value)}
        </text>
      ))}

      {title &&
        (vertical ? (
          <text
            className={styles.axisTitle}
            textAnchor="middle"
            // Rotated up the left edge, which is the only place a value axis
            // has room for a name without stealing width from the plot.
            transform={`translate(11, ${plot.top + plot.height / 2}) rotate(-90)`}
          >
            {title}
          </text>
        ) : (
          // Below the tick row, so it needs a taller bottom margin than the
          // default: pass `margin={{ bottom: 46 }}` alongside `label`.
          <text
            className={styles.axisTitle}
            x={plot.left + plot.width / 2}
            y={bottom + 34}
            textAnchor="middle"
          >
            {title}
          </text>
        ))}
    </g>
  );
}
