/**
 * Domain → pixel mapping, the one job the data layer had no answer for.
 *
 * `format/ladders.ts` already chooses *which magnitude* to show a number in —
 * µs rather than ns — and `data/meta.ts` labels it. Neither knows anything
 * about geometry. A chart needs the third thing: where on a 320-pixel axis the
 * number 4.34 goes, and which round numbers deserve a gridline.
 *
 * The simplification that makes one interface cover three kinds of axis is that
 * `series.ts` always hands over a `number`: epoch millis for a time axis, the
 * value itself for a linear one, and the *band index* for a categorical one. So
 * every scale is a map between two numbers and only band adds geometry on top.
 *
 * Scales are frozen. A `nice()` that mutated its own domain would make `at()`
 * answer differently depending on when it was called, which is exactly the kind
 * of thing the rest of this codebase avoids — so niceing is an option at
 * construction, backed by the pure `niceDomain`.
 *
 * `timeScale` lives in `./time` rather than here, because the calendar
 * machinery it needs depends on `tickStep` from this module and a cycle between
 * the two would be worse than the split.
 */
import type { TimeInterval } from './time';

export type ScaleKind = 'linear' | 'time' | 'band';

/** The default number of ticks an axis aims for. Not a promise: the 1/2/5 rule
 * decides the step, and the step decides how many actually fit. */
export const DEFAULT_TICKS = 5;

export interface ScaleTick {
  /** Domain value: epoch millis, the number itself, or a band index. */
  value: number;
  /** Where it lands along the range, in pixels. */
  pos: number;
}

export interface TickSet {
  ticks: ScaleTick[];
  /**
   * Fraction digits the step needs, so the axis can print exactly enough to
   * tell neighbouring ticks apart and no more. Zero for time and band.
   */
  decimals: number;
  /** Time scales only: the calendar interval chosen, so the axis can pick a
   * matching date format. */
  interval?: TimeInterval;
}

interface ScaleBase {
  readonly kind: ScaleKind;
  /**
   * Pixel extent. A value axis passes `[height, 0]` — inverting an axis is a
   * reversed range, not a flag, so nothing downstream has to know.
   */
  readonly range: readonly [number, number];
  at(value: number): number;
  /** Pixel → domain. A band returns a *fractional* index; round it to snap. */
  invert(px: number): number;
  ticks(count?: number): TickSet;
}

export interface ContinuousScale extends ScaleBase {
  readonly kind: 'linear' | 'time';
  readonly domain: readonly [number, number];
}

export interface BandScale extends ScaleBase {
  readonly kind: 'band';
  /**
   * How many bands the range is divided into — the domain is `0 … count-1`.
   *
   * A count rather than the labels: a scale is domain-to-pixel geometry, and
   * what each band is *called* is a fact about the data. `GraphData.categories`
   * holds those, and every consumer reads them from there.
   */
  readonly count: number;
  /** Width of one band with the padding removed. Zero for a point scale. */
  bandwidth(): number;
  /** Centre-to-centre distance between bands. */
  step(): number;
  /** Left (or top) edge of a band — where a bar starts. */
  start(index: number): number;
}

export type Scale = ContinuousScale | BandScale;

// --- numeric primitives -----------------------------------------------------

/**
 * Strip binary-float noise without caring about magnitude: `0.1 * 3` is
 * `0.30000000000000004`, which prints fine through `Intl` but poisons every
 * equality test and any attempt to count its decimals. Fifteen significant
 * digits is one below the ~15.95 a double actually carries, so this rounds off
 * the representation error and nothing else.
 */
function clean(value: number): number {
  return Number(value.toPrecision(15));
}

/** √50, √10, √2 — the geometric midpoints between 1, 2, 5 and 10. */
const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);

/**
 * The 1/2/5 × 10ᵏ step nearest `span / count`.
 *
 * The thresholds are geometric rather than arithmetic because the choice is
 * between *ratios*: a rough step of 3 is equally badly served by 2 and by 5,
 * and √10 ≈ 3.16 is where that tips. Rounding on 3.5 instead would quietly
 * favour the smaller multiplier and produce more ticks than asked for.
 */
export function tickStep(span: number, count = DEFAULT_TICKS): number {
  if (!Number.isFinite(span) || span <= 0 || count < 1) return 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const mult = norm >= E10 ? 10 : norm >= E5 ? 5 : norm >= E2 ? 2 : 1;
  return clean(mult * magnitude);
}

/** Fraction digits a step needs: `0.02` needs two, `200` needs none. */
export function tickDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.max(0, -Math.floor(Math.log10(step)));
}

/**
 * A usable domain from whatever the data produced. Real columns hand over all
 * three of these: a single repeated value, a reversed pair, and — for a column
 * that is entirely null — nothing finite at all.
 */
function spread(domain: readonly [number, number]): [number, number] {
  let [lo, hi] = domain;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    // A flat series still deserves an axis; centre it in one.
    if (lo === 0) return [-1, 1];
    const pad = Math.abs(lo) / 2;
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}

/** Round a domain outwards to whole tick steps, so the ends carry gridlines. */
export function niceDomain(
  domain: readonly [number, number],
  count = DEFAULT_TICKS,
): [number, number] {
  const [lo, hi] = spread(domain);
  const step = tickStep(hi - lo, count);
  return [
    clean(Math.floor(lo / step) * step),
    clean(Math.ceil(hi / step) * step),
  ];
}

/**
 * A hard ceiling on generated ticks. Not defensiveness for its own sake: a NaN
 * that survives into a domain makes the loop's exit condition never true, and
 * an infinite loop inside a test run hangs the suite rather than failing it.
 */
const MAX_TICKS = 200;

/** Every multiple of `step` inside `[lo, hi]`, inclusive. */
function linearTicks(lo: number, hi: number, step: number): number[] {
  const first = Math.ceil(lo / step);
  const last = Math.floor(hi / step);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
  const out: number[] = [];
  for (let i = first; i <= last && out.length < MAX_TICKS; i++) {
    out.push(clean(i * step));
  }
  return out;
}

// --- factories --------------------------------------------------------------

/**
 * Build the shared continuous body. `timeScale` reuses it with its own tick
 * generator, which is the only thing that differs between the two.
 */
export function continuousScale(
  kind: 'linear' | 'time',
  domain: readonly [number, number],
  range: readonly [number, number],
  tickFn: (lo: number, hi: number, count: number) => TickSet,
): ContinuousScale {
  const [lo, hi] = domain;
  const [r0, r1] = range;
  const dSpan = hi - lo;
  const rSpan = r1 - r0;
  const scale: ContinuousScale = {
    kind,
    domain: [lo, hi],
    range: [r0, r1],
    at: (value) => (dSpan === 0 ? r0 : r0 + ((value - lo) / dSpan) * rSpan),
    invert: (px) => (rSpan === 0 ? lo : lo + ((px - r0) / rSpan) * dSpan),
    ticks: (count = DEFAULT_TICKS) => {
      const set = tickFn(lo, hi, count);
      return {
        ...set,
        ticks: set.ticks.map((t) => ({ ...t, pos: scale.at(t.value) })),
      };
    },
  };
  return Object.freeze(scale);
}

export function linearScale(opts: {
  domain: readonly [number, number];
  range: readonly [number, number];
  /** Round the domain out to whole tick steps. Default true. */
  nice?: boolean;
  /** Ticks to aim for — also what `nice` rounds against. Default 5. */
  ticks?: number;
}): ContinuousScale {
  const count = opts.ticks ?? DEFAULT_TICKS;
  const domain =
    opts.nice === false ? spread(opts.domain) : niceDomain(opts.domain, count);
  return continuousScale('linear', domain, opts.range, (lo, hi, n) => {
    const step = tickStep(hi - lo, n);
    return {
      ticks: linearTicks(lo, hi, step).map((value) => ({ value, pos: 0 })),
      decimals: tickDecimals(step),
    };
  });
}

export function bandScale(opts: {
  /** Number of bands to divide the range into. */
  count: number;
  range: readonly [number, number];
  /** Fraction of each step left as air between bands. Default 0.2. */
  padding?: number;
  /** Zero-width bands centred on the step, for line and point marks. */
  point?: boolean;
}): BandScale {
  const [r0, r1] = opts.range;
  const n = Math.max(0, Math.floor(opts.count));
  const padding = opts.point ? 1 : (opts.padding ?? 0.2);
  const step = n === 0 ? 0 : (r1 - r0) / n;
  const inner = step * (1 - padding);
  const start = (index: number) => r0 + index * step + (step - inner) / 2;

  const scale: BandScale = {
    kind: 'band',
    count: n,
    range: [r0, r1],
    at: (value) => start(value) + inner / 2,
    // The half-step is the band's own centre offset: pixel r0 sits at the left
    // edge of band 0, whose *centre* is index 0.
    invert: (px) => (step === 0 ? 0 : (px - r0) / step - 0.5),
    bandwidth: () => inner,
    step: () => step,
    start,
    ticks: () => ({
      ticks: Array.from({ length: n }, (_v, i) => ({
        value: i,
        pos: start(i) + inner / 2,
      })),
      decimals: 0,
    }),
  };
  return Object.freeze(scale);
}
