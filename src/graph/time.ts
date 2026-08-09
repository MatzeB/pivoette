/**
 * Calendar arithmetic for a time axis.
 *
 * A linear axis ticks on multiples of a number. A time axis cannot: months are
 * not a fixed length, days are 23 or 25 hours twice a year, and "every 3 hours"
 * has to mean 3 hours of *wall clock* or the gridlines drift off the hour after
 * a daylight-saving boundary. So the rungs are calendar units rather than
 * magnitudes, and stepping goes through `Intl` — via `timeParts` and
 * `zoneOffset` — rather than through millisecond addition.
 *
 * `timeScale` lives here rather than in `./scale` because everything below
 * depends on `tickStep`, and importing the factory back the other way would
 * make the pair circular. The dependency runs one way: time knows about scales,
 * scales do not know about time (beyond a type-only import).
 */
import { timeParts, zoneOffset } from '../data/temporal';
import type { TimeParts } from '../data/temporal';
import { continuousScale, tickStep, DEFAULT_TICKS } from './scale';
import type { ContinuousScale } from './scale';

export type TimeUnit =
  | 'millisecond'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year';

export interface TimeInterval {
  unit: TimeUnit;
  /** Multiples of `unit` between ticks — 15 minutes, 3 months, 10 years. */
  every: number;
  /**
   * Nominal length, used only to *rank* rungs against a target spacing. A month
   * is 30.44 days here; the ticks this produces are exact calendar months.
   */
  approxMs: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The parts flooring may overwrite. `isoWeekday` is derived, never set. */
type PartField = 'month' | 'day' | 'hour' | 'minute' | 'second';

/** Fields of `TimeParts` finer than each unit, which flooring zeroes. */
const FINER: Record<Exclude<TimeUnit, 'week'>, PartField[]> = {
  year: ['month', 'day', 'hour', 'minute', 'second'],
  month: ['day', 'hour', 'minute', 'second'],
  day: ['hour', 'minute', 'second'],
  hour: ['minute', 'second'],
  minute: ['second'],
  second: [],
  millisecond: [],
};

/**
 * Wall-clock parts → the instant they name, in a zone.
 *
 * Two passes, because the offset depends on the instant we are trying to find.
 * The first guess uses the offset at the same wall time read as UTC, which is
 * wrong by an hour for a tick that sits on the far side of a daylight-saving
 * boundary from that guess; re-reading the offset at the candidate instant and
 * retrying resolves it. A third pass would never change anything: the second
 * offset is measured at an instant within the target's own offset regime.
 */
function fromWall(p: TimeParts, timeZone: string | undefined): number {
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const first = zoneOffset(wall, timeZone);
  const candidate = wall - first;
  const second = zoneOffset(candidate, timeZone);
  return second === first ? candidate : wall - second;
}

/** Start of the wall-clock `unit` containing this instant, in a zone. */
export function floorTime(
  ms: number,
  unit: TimeUnit,
  timeZone?: string,
  weekStart = 1,
): number {
  if (unit === 'millisecond') return ms;
  const p = { ...timeParts(ms, timeZone) };
  if (unit === 'week') {
    // Back up to the locale's first day, then floor that day.
    const back = (p.isoWeekday - weekStart + 7) % 7;
    p.day -= back;
    p.hour = 0;
    p.minute = 0;
    p.second = 0;
    return fromWall(p, timeZone);
  }
  for (const field of FINER[unit]) {
    // `month` and `day` are 1-based; the rest floor to zero.
    p[field] = field === 'month' || field === 'day' ? 1 : 0;
  }
  return fromWall(p, timeZone);
}

/**
 * The interval's own boundary at or before this instant.
 *
 * Flooring to the *unit* is not enough once a rung ticks every 12 hours or
 * every 3 months: 04:37 floors to 04:00, and stepping from there puts the
 * gridlines on 04:00 and 16:00 rather than on noon and midnight. So the unit's
 * own field is additionally snapped down to a multiple of `every`, within the
 * next coarser cycle.
 *
 * Days and weeks are left alone deliberately. A month is not a whole number of
 * either, so "every second day" has no cycle to snap to — the 31st would be
 * followed by the 1st two days later — and a week already only ticks singly.
 */
function floorToInterval(
  ms: number,
  interval: TimeInterval,
  timeZone: string | undefined,
  weekStart: number,
): number {
  const { unit, every } = interval;
  const base = floorTime(ms, unit, timeZone, weekStart);
  if (
    every <= 1 ||
    unit === 'day' ||
    unit === 'week' ||
    unit === 'millisecond'
  ) {
    return base;
  }
  const p = { ...timeParts(base, timeZone) };
  const down = (v: number) => Math.floor(v / every) * every;
  if (unit === 'second') p.second = down(p.second);
  else if (unit === 'minute') p.minute = down(p.minute);
  else if (unit === 'hour') p.hour = down(p.hour);
  else if (unit === 'month') p.month = down(p.month - 1) + 1;
  else p.year = down(p.year);
  return fromWall(p, timeZone);
}

/**
 * `n` calendar units later.
 *
 * Hour and finer is plain millisecond addition: an axis at that resolution is
 * plotting instants, and an hour is an hour even across a boundary. Day and
 * coarser goes through the calendar, so a 25-hour day is one step and the next
 * tick still lands at local midnight rather than drifting to 23:00.
 */
export function addTime(
  ms: number,
  unit: TimeUnit,
  n: number,
  timeZone?: string,
): number {
  switch (unit) {
    case 'millisecond':
      return ms + n;
    case 'second':
      return ms + n * SECOND;
    case 'minute':
      return ms + n * MINUTE;
    case 'hour':
      return ms + n * HOUR;
    default: {
      const p = { ...timeParts(ms, timeZone) };
      if (unit === 'day') p.day += n;
      else if (unit === 'week') p.day += n * 7;
      else if (unit === 'month') p.month += n;
      else p.year += n;
      return fromWall(p, timeZone);
    }
  }
}

/** Nominal length of a year, for ranking rungs. Generated ticks are exact. */
const YEAR_MS = 365.2425 * DAY;

/**
 * The rungs a time axis may tick on. Deliberately not every multiple: 7 minutes
 * or 4 hours divide the clock unevenly, and a gridline the reader cannot name
 * is worse than one slightly further from the target spacing.
 */
const LADDER: TimeInterval[] = [
  ...[1, 5, 10, 25, 50, 100, 250, 500].map((every) => ({
    unit: 'millisecond' as const,
    every,
    approxMs: every,
  })),
  ...[1, 5, 15, 30].map((every) => ({
    unit: 'second' as const,
    every,
    approxMs: every * SECOND,
  })),
  ...[1, 5, 15, 30].map((every) => ({
    unit: 'minute' as const,
    every,
    approxMs: every * MINUTE,
  })),
  ...[1, 3, 6, 12].map((every) => ({
    unit: 'hour' as const,
    every,
    approxMs: every * HOUR,
  })),
  ...[1, 2].map((every) => ({
    unit: 'day' as const,
    every,
    approxMs: every * DAY,
  })),
  { unit: 'week', every: 1, approxMs: 7 * DAY },
  ...[1, 3, 6].map((every) => ({
    unit: 'month' as const,
    every,
    approxMs: every * 30.44 * DAY,
  })),
  { unit: 'year', every: 1, approxMs: YEAR_MS },
];

/**
 * The rung whose spacing is geometrically nearest the target.
 *
 * Nearest in *ratio*, not in difference: at the day/week boundary an absolute
 * comparison would treat "3 days out" as equally bad for a 2-day rung and a
 * 1-week one, when proportionally it is much worse for the smaller.
 *
 * Above a year the ladder runs out and years step on the same 1/2/5 rule a
 * linear axis uses — there is no calendar reason to prefer any particular
 * multiple of a year, so the numeric answer is the right one.
 */
export function chooseInterval(
  span: number,
  count = DEFAULT_TICKS,
): TimeInterval {
  const target = Math.abs(span) / Math.max(count, 1);
  if (!Number.isFinite(target) || target <= 0) return LADDER[0]!;
  // Above a single year the ladder runs out and the step becomes numeric. The
  // rungs below have to reach that far unbroken, or a four-year span drops to
  // quarters — sixteen `Mon YYYY` labels on a 600px axis, which nothing
  // downstream thins.
  if (target >= YEAR_MS) {
    // In years, not in milliseconds: the 1/2/5 landing points have to be whole
    // years, and `tickStep` over millis would answer 6.34 of them.
    const every = Math.max(
      1,
      Math.round(tickStep(Math.abs(span) / YEAR_MS, count)),
    );
    return { unit: 'year', every, approxMs: every * YEAR_MS };
  }
  let best = LADDER[0]!;
  let bestScore = Infinity;
  for (const rung of LADDER) {
    const score = Math.abs(Math.log(rung.approxMs / target));
    if (score < bestScore) {
      best = rung;
      bestScore = score;
    }
  }
  return best;
}

/** Same ceiling, same reason, as the linear generator's. */
const MAX_TICKS = 500;

/**
 * Ticks on calendar boundaries between two instants.
 *
 * The walk starts at the floor of `lo` — which may be before it — and drops
 * whatever falls outside, so the first tick is always on a boundary rather than
 * on the data's own start.
 */
export function timeTicks(
  lo: number,
  hi: number,
  count = DEFAULT_TICKS,
  timeZone?: string,
  weekStart = 1,
): { ticks: number[]; interval: TimeInterval } {
  const interval = chooseInterval(hi - lo, count);
  const ticks: number[] = [];
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
    return { ticks, interval };
  }
  let t = floorToInterval(lo, interval, timeZone, weekStart);
  while (t < lo) t = addTime(t, interval.unit, interval.every, timeZone);
  while (t <= hi && ticks.length < MAX_TICKS) {
    ticks.push(t);
    const next = addTime(t, interval.unit, interval.every, timeZone);
    // A rung that cannot advance would spin forever; bail rather than hang.
    if (next <= t) break;
    t = next;
  }
  return { ticks, interval };
}

/**
 * Round a time domain out to the interval's own boundaries, so the axis begins
 * and ends on a gridline the reader can name.
 */
export function niceTimeDomain(
  domain: readonly [number, number],
  count = DEFAULT_TICKS,
  timeZone?: string,
  weekStart = 1,
): [number, number] {
  let [lo, hi] = domain;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) return [lo - HOUR, hi + HOUR];
  const interval = chooseInterval(hi - lo, count);
  const start = floorToInterval(lo, interval, timeZone, weekStart);
  let end = floorToInterval(hi, interval, timeZone, weekStart);
  if (end < hi) end = addTime(end, interval.unit, interval.every, timeZone);
  return [start, end];
}

export function timeScale(opts: {
  /** Epoch millis. */
  domain: readonly [number, number];
  range: readonly [number, number];
  timeZone?: string;
  /** ISO day the week starts on, from `firstDayOfWeek(locale)`. Default 1. */
  weekStart?: number;
  /** Round the domain out to calendar boundaries. Default true. */
  nice?: boolean;
  ticks?: number;
}): ContinuousScale {
  const count = opts.ticks ?? DEFAULT_TICKS;
  const weekStart = opts.weekStart ?? 1;
  const domain =
    opts.nice === false
      ? spreadTime(opts.domain)
      : niceTimeDomain(opts.domain, count, opts.timeZone, weekStart);
  return continuousScale('time', domain, opts.range, (lo, hi, n) => {
    const { ticks, interval } = timeTicks(lo, hi, n, opts.timeZone, weekStart);
    return {
      ticks: ticks.map((value) => ({ value, pos: 0 })),
      decimals: 0,
      interval,
    };
  });
}

/** The un-niced fallback: usable, without pretending to a calendar boundary. */
function spreadTime(domain: readonly [number, number]): [number, number] {
  let [lo, hi] = domain;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) return [lo - HOUR, hi + HOUR];
  return [lo, hi];
}
