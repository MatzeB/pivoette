/**
 * Temporal facts, read from `Intl` rather than tabled — the same approach as
 * `src/data/currency.ts`.
 *
 * Two things here are deliberately *not* guessed. A value is decoded only
 * according to its column's declared `encoding` (never sniffed, since epoch
 * seconds and epoch millis are indistinguishable by inspection), and the
 * calendar parts of an instant are read through a time zone, because which day
 * a commit falls on depends on where you are standing.
 */
import type { ColumnMeta } from './meta';

/** `'auto'` and absent both mean the runtime's zone — what `Intl` does for
 * `undefined`. Anything else passes through as an IANA name. */
export function resolveTimeZone(
  timeZone: string | undefined,
): string | undefined {
  return !timeZone || timeZone === 'auto' ? undefined : timeZone;
}

// --- week info --------------------------------------------------------------

const weekStart = new Map<string, number>();

/**
 * ISO day number (1 = Monday … 7 = Sunday) that begins the week in this locale:
 * 7 in en-US, 1 in de-DE, 6 in ar-EG. Falls back to Monday where the runtime
 * lacks `getWeekInfo`.
 */
export function firstDayOfWeek(locale?: string): number {
  const key = locale ?? '';
  const hit = weekStart.get(key);
  if (hit !== undefined) return hit;
  let day = 1;
  try {
    const info = new Intl.Locale(
      locale ?? new Intl.NumberFormat().resolvedOptions().locale,
    ) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    day = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay ?? 1;
  } catch {
    day = 1;
  }
  weekStart.set(key, day);
  return day;
}

// --- decoding ---------------------------------------------------------------

/** Epoch millis from an RFC3339 / ISO-8601 string. Null if unparseable. */
export function parseTime(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Epoch millis for a value, per its column's declared metadata. Text is decoded
 * by `encoding`; a number on a timestamp column is taken as epoch millis.
 *
 * Finer-grained numeric encodings (epoch seconds, nanos) belong here too — the
 * metadata can already express them as `unit: ['second'], scale: ['nano']` —
 * but are not implemented yet. Nothing is inferred from magnitude.
 */
export function decodeTime(
  value: unknown,
  meta: ColumnMeta | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (meta?.encoding === 'rfc3339') return parseTime(value);
  if (isTimestamp(meta)) return typeof value === 'number' ? value : null;
  return null;
}

/** True when a column's metadata says it holds instants. */
export function isTimestamp(meta: ColumnMeta | undefined): boolean {
  return !!meta?.kind?.includes('timestamp');
}

// --- calendar parts ---------------------------------------------------------

export interface TimeParts {
  year: number;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
  /** 0..23 */
  hour: number;
  /** 1 = Monday … 7 = Sunday. */
  isoWeekday: number;
}

/** en-US short weekday names, in ISO order, for mapping a part back to a number. */
const ISO_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormat(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let fmt = partsCache.get(key);
  if (!fmt) {
    // Fixed locale: these parts are read as numbers, not shown to anyone.
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    });
    partsCache.set(key, fmt);
  }
  return fmt;
}

/**
 * Wall-clock parts of an instant in a time zone. Goes through
 * `Intl.DateTimeFormat` rather than millisecond arithmetic so that offsets and
 * daylight saving are the platform's problem.
 */
export function timeParts(ms: number, timeZone?: string): TimeParts {
  const parts = partsFormat(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    isoWeekday: ISO_DAYS.indexOf(weekday) + 1,
  };
}

/** ISO-8601 week number (1..53) of an instant, in a time zone. */
export function isoWeek(ms: number, timeZone?: string): number {
  const { year, month, day, isoWeekday } = timeParts(ms, timeZone);
  // Shift to the Thursday of this ISO week: its calendar year owns the week.
  const thursday = Date.UTC(year, month - 1, day + (4 - isoWeekday));
  const jan1 = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return Math.floor((thursday - jan1) / 86_400_000 / 7) + 1;
}

// --- expression helpers -----------------------------------------------------

/**
 * The temporal functions a `compute` expression can call, bound to the view's
 * locale and time zone. Each accepts epoch millis (what a declared timestamp
 * column supplies) or a raw string, and returns null for null input.
 *
 * `weekday` is a *locale ordinal*: 0 is whatever day the locale starts its week
 * on, so the numbers sort into calendar order without any per-kind comparator.
 * `isoWeekday` is the stable alternative when the number itself must travel.
 */
export function temporalHelpers(
  locale?: string,
  timeZone?: string,
): Record<string, (v: unknown) => number | string | null> {
  const tz = resolveTimeZone(timeZone);
  const first = firstDayOfWeek(locale);
  const at = (v: unknown) => (typeof v === 'number' ? v : parseTime(v));
  const part = <T>(v: unknown, f: (p: TimeParts, ms: number) => T) => {
    const ms = at(v);
    return ms === null ? null : f(timeParts(ms, tz), ms);
  };
  return {
    parseTime: (v) => parseTime(v),
    year: (v) => part(v, (p) => p.year),
    quarter: (v) => part(v, (p) => Math.floor((p.month - 1) / 3) + 1),
    month: (v) => part(v, (p) => p.month),
    day: (v) => part(v, (p) => p.day),
    hour: (v) => part(v, (p) => p.hour),
    isoWeek: (v) => part(v, (_p, ms) => isoWeek(ms, tz)),
    isoWeekday: (v) => part(v, (p) => p.isoWeekday),
    weekday: (v) => part(v, (p) => (p.isoWeekday - first + 7) % 7),
    dateOnly: (v) =>
      part(
        v,
        (p) =>
          `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
      ),
  };
}

/** Map a locale weekday ordinal back to its ISO day number. */
export function ordinalToIsoDay(ordinal: number, locale?: string): number {
  return ((ordinal + firstDayOfWeek(locale) - 1) % 7) + 1;
}
