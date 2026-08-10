/**
 * Turning a tick's number into the text beside it.
 *
 * The reusable part is real: `deduceFormat` already knows a price wants two
 * decimals and a percentage one, `resolveFormat` already caches its
 * `Intl.NumberFormat`s, and `unitLabels` already knows whether a unit leads the
 * digits or trails them. What none of them knows is that an axis is a *set* of
 * numbers rather than one, which changes two decisions:
 *
 * - **Precision comes from the tick step, not from the column.** A column's
 *   deduced precision describes single values. An axis wants exactly enough
 *   digits to tell neighbouring ticks apart: on a step of 20, `10.00` says
 *   nothing `10` does not. This is also why `scaledColumnFormat` is the wrong
 *   tool despite looking like the right one — its `significantDigits: 3` would
 *   render a $k axis as `10.0k, 20.0k, 30.0k`.
 * - **A rescaled axis abandons the column's precision entirely.** Two decimals
 *   was a statement about dollars; the axis is now labelled in thousands of
 *   them, and those cents are not on screen.
 */
import { unitLabels } from '../data/meta';
import type { ColumnMeta, UnitLabels } from '../data/meta';
import type { DataFrame } from '../data/types';
import { deduceFormat } from '../format/deduce';
import { resolveFormat } from '../format/format';
import { affixOf, attachUnit } from '../format/label';
import { Format } from '../format/builtins';
import type { FormatSpec } from '../pivot/spec';
import type { ResolvedColumn } from '../format/context';
import { resolveTimeZone } from '../data/temporal';
import type { TimeUnit } from './time';

/**
 * Formats that answer with a name rather than a number, so a tick step has no
 * opinion about them: an axis over `month` wants `Mar`, not two decimals.
 */
const NAMING_FORMATS = new Set<string>([Format.Weekday, Format.Month]);

/**
 * Attach a unit to a formatted number, where the metadata says it goes.
 *
 * Thin, deliberately. The placement rules are the table's — `DataTable` has
 * done this since before there were charts — so a chart cannot invent its own
 * `$-199.75` or `k$300` where the table writes `-$199.75` and `$300k`.
 */
export function withUnit(body: string, labels: UnitLabels): string {
  return attachUnit(body, affixOf(labels));
}

/** `Balance ($k)`, or just `Balance` for a column with no unit to report. */
export function axisTitle(
  meta: ColumnMeta | undefined,
  locale: string | undefined,
): string {
  if (!meta) return '';
  const full = unitLabels(meta, locale).full;
  return full ? `${meta.displayName} (${full})` : meta.displayName;
}

/**
 * The format spec for one axis's ticks.
 *
 * `rescaled` says whether a ladder moved the decimal point — see the header for
 * why that discards the column's own precision.
 */
export function tickSpec(
  meta: ColumnMeta | undefined,
  rescaled: boolean,
  decimals: number,
  locale: string | undefined,
): FormatSpec {
  const deduced = deduceFormat(meta, locale);
  // A format that turns a number into a *name* is not about precision at all,
  // and the step has nothing to say about it: an axis over `month` still wants
  // `Mar`, not `3`. Everything else defers to the step.
  if (
    !rescaled &&
    deduced &&
    'fnName' in deduced &&
    NAMING_FORMATS.has(deduced.fnName)
  ) {
    return { ...deduced, options: { ...deduced.options, locale } };
  }
  return { fnName: Format.Number, options: { decimals, locale } };
}

/**
 * A number → text function for an axis.
 *
 * Built once per axis and reused for every tick: `resolveFormat` constructs an
 * `Intl.NumberFormat`, which is far too expensive to do per label. The `CellCtx`
 * it needs is synthesised the same way `memberFormat` does it in the engine —
 * a formatter is written against cells, and an axis tick is close enough to one
 * that inventing a second interface would only let the two drift.
 */
export function tickFormatter(
  meta: ColumnMeta | undefined,
  frame: DataFrame,
  spec: FormatSpec,
): (value: number) => string {
  const fn = resolveFormat(spec);
  const column: ResolvedColumn = {
    id: meta?.dataName ?? '',
    label: meta?.displayName ?? '',
    align: 'right',
    meta,
  };
  return (value: number) =>
    fn({ value, inputs: {}, rowPath: [], colPath: [], column, frame });
}

/**
 * Date parts to show at each tick resolution.
 *
 * Local to the chart rather than registered as a public `datetime` format.
 * Growing the format registry is a standing commitment to a name and an options
 * shape; worth making once a second caller wants one, not for the first.
 */
const TICK_DATE: Record<TimeUnit, Intl.DateTimeFormatOptions> = {
  millisecond: {
    minute: 'numeric',
    second: 'numeric',
    fractionalSecondDigits: 3,
  },
  second: { hour: 'numeric', minute: 'numeric', second: 'numeric' },
  minute: { hour: 'numeric', minute: 'numeric' },
  hour: { hour: 'numeric', minute: 'numeric' },
  day: { month: 'short', day: 'numeric' },
  week: { month: 'short', day: 'numeric' },
  month: { month: 'short', year: 'numeric' },
  year: { year: 'numeric' },
};

/** The coarser label a tick gets when it opens a new day, month, or year. */
const ROLLOVER: Partial<Record<TimeUnit, Intl.DateTimeFormatOptions>> = {
  millisecond: { hour: 'numeric', minute: 'numeric' },
  second: { hour: 'numeric', minute: 'numeric' },
  minute: { month: 'short', day: 'numeric' },
  hour: { month: 'short', day: 'numeric' },
  day: { month: 'short', day: 'numeric', year: 'numeric' },
  week: { month: 'short', day: 'numeric', year: 'numeric' },
  month: { year: 'numeric' },
};

/**
 * Parts a scrubber readout needs to name one point, at the axis's resolution.
 *
 * Distinct from a tick's: a tick is one of a labelled row and can lean on its
 * neighbours, while a readout stands alone and has to say which instant it is.
 * On an hourly axis every point shares a date, so the heading needs the hour.
 */
const READOUT_DATE: Record<TimeUnit, Intl.DateTimeFormatOptions> = {
  millisecond: {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    fractionalSecondDigits: 3,
  },
  second: {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  },
  minute: {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  },
  hour: { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' },
  day: { year: 'numeric', month: 'short', day: 'numeric' },
  week: { year: 'numeric', month: 'short', day: 'numeric' },
  month: { year: 'numeric', month: 'short' },
  year: { year: 'numeric' },
};

/**
 * `Intl.DateTimeFormat` is expensive to construct and these depend on nothing
 * but their three arguments — yet the memos holding them are keyed on the tick
 * set, which changes on every width change. Without a cache, dragging a
 * responsive chart builds three of them per animation frame forever. Same
 * shape as `format.ts`'s `nameCache` and `temporal.ts`'s `partsCache`.
 */
const dateCache = new Map<string, Intl.DateTimeFormat>();

function dateFormat(
  key: string,
  options: Intl.DateTimeFormatOptions,
  locale: string | undefined,
  timeZone: string | undefined,
): Intl.DateTimeFormat {
  const id = `${key}|${locale ?? ''}|${timeZone ?? ''}`;
  let fmt = dateCache.get(id);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: resolveTimeZone(timeZone),
    });
    dateCache.set(id, fmt);
  }
  return fmt;
}

/** A one-line name for an instant, at the axis's own resolution. */
export function timeReadoutFormat(
  unit: TimeUnit,
  locale: string | undefined,
  timeZone: string | undefined,
): (ms: number) => string {
  const fmt = dateFormat(`r:${unit}`, READOUT_DATE[unit], locale, timeZone);
  return (ms) => fmt.format(new Date(ms));
}

export interface TimeTickFormat {
  /** The label for a tick at `ms`. */
  label: (ms: number) => string;
  /** The label for a tick that opens a coarser period than the one before it. */
  rollover: (ms: number) => string;
}

/**
 * Date formatters for a time axis at a given resolution.
 *
 * The rollover pair exists because an hourly axis reading `06:00 · 12:00 ·
 * 18:00 · 00:00 · 06:00` gives no way to tell which midnight is which. Marking
 * the tick that starts a new day with the day's name costs one label and
 * removes the ambiguity.
 */
export function timeTickFormat(
  unit: TimeUnit,
  locale: string | undefined,
  timeZone: string | undefined,
): TimeTickFormat {
  const main = dateFormat(`t:${unit}`, TICK_DATE[unit], locale, timeZone);
  const coarse = dateFormat(
    `c:${unit}`,
    ROLLOVER[unit] ?? TICK_DATE[unit],
    locale,
    timeZone,
  );
  return {
    label: (ms) => main.format(new Date(ms)),
    rollover: (ms) => coarse.format(new Date(ms)),
  };
}
